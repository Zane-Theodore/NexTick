import json
import signal
import threading
import time
import sys
from datetime import datetime, timedelta, timezone

import psycopg2
from kafka import KafkaConsumer, KafkaProducer
from kafka.errors import NoBrokersAvailable

from data_pipeline import config
from data_pipeline.logger_config import get_logger

logger = get_logger(__name__)


def retry_with_backoff(operation, max_retries=60, base_delay=1.0, max_delay=10.0, operation_name='operation'):
    attempt = 0
    while attempt < max_retries:
        try:
            return operation()
        except NoBrokersAvailable:
            attempt += 1
            delay = min(base_delay * (2 ** (attempt - 1)), max_delay)
            logger.warning(f"{operation_name} failed (Kafka not ready). Retrying in {delay:.1f}s... ({attempt}/{max_retries})")
            time.sleep(delay)
        except Exception as error:
            attempt += 1
            if attempt >= max_retries:
                logger.error(f"{operation_name} failed after {attempt} attempts.", exc_info=True)
                raise
            delay = min(base_delay * (2 ** (attempt - 1)), max_delay)
            logger.warning(f"{operation_name} failed on attempt {attempt}: {error}. Retrying in {delay:.1f}s...")
            time.sleep(delay)


class BaseCandleManager:
    def __init__(self, symbol: str):
        self.symbol = symbol.lower()
        self.interval = '1m'
        self.current_minute = None
        self.trades_buffer = []
        self.lock = threading.Lock()
        self.update_timer = None
        self.running = True
        self.broadcast_callback = None
        self.trade_count_since_cleanup = 0
        logger.info(f"Initialized BaseCandleManager for {self.symbol.upper()}")

    def truncate_to_minute(self, timestamp: datetime) -> datetime:
        return timestamp.replace(second=0, microsecond=0)

    def calculate_ohlcv(self) -> dict:
        if not self.trades_buffer or not self.current_minute: 
            return None
        
        interval_end = self.current_minute + timedelta(minutes=1)
        trades_in_minute = [t for t in self.trades_buffer if self.current_minute <= t['datetime'] < interval_end]
        
        if not trades_in_minute: 
            return None
        
        prices = [t['price'] for t in trades_in_minute]
        volumes = [t['volume'] for t in trades_in_minute]
        
        return {
            'symbol': self.symbol.upper(),
            'interval': self.interval,
            'timestamp': self.current_minute,
            'open': float(prices[0]),
            'high': float(max(prices)),
            'low': float(min(prices)),
            'close': float(prices[-1]),
            'volume': float(sum(volumes))
        }

    def schedule_next_update(self):
        if self.running and not self.update_timer:
            self.update_timer = threading.Timer(
                config.CANDLE_UPDATE_INTERVAL_MS / 1000.0,
                self._emit_updating_candles
            )
            self.update_timer.daemon = True
            self.update_timer.start()

    def _emit_updating_candles(self):
        if not self.running: return
        with self.lock:
            if self.current_minute and self.trades_buffer:
                candle = self.calculate_ohlcv()
                if candle and self.broadcast_callback:
                    self.broadcast_callback(candle, is_final=False)
                    
        if self.running:
            self.update_timer = threading.Timer(
                config.CANDLE_UPDATE_INTERVAL_MS / 1000.0,
                self._emit_updating_candles
            )
            self.update_timer.daemon = True
            self.update_timer.start()

    def cleanup_old_trades(self):
        if not self.trades_buffer: return
        latest_trade_time = self.trades_buffer[-1]['datetime']
        cutoff_time = latest_trade_time - timedelta(minutes=2) 
        self.trades_buffer = [t for t in self.trades_buffer if t['datetime'] >= cutoff_time]

    def cleanup(self):
        if self.update_timer:
            self.update_timer.cancel()


class CandleProcessor:
    def __init__(self):
        self.table_name = "market_candles"
        self.managers = {} 
        
        logger.info("Initializing MULTI-SYMBOL 1M processor using psycopg2 (Synchronous).")
        
        try:
            self.db_conn = psycopg2.connect(
                host=config.QUESTDB_HOST,
                port=8812,
                database="qdb",
                user="admin",
                password="quest"
            )
            self.db_conn.autocommit = True
            self.db_cursor = self.db_conn.cursor()
            logger.info("Connected to QuestDB via PostgreSQL wire protocol.")

            self.db_cursor.execute(
                f"""
                CREATE TABLE IF NOT EXISTS {self.table_name} (
                    symbol SYMBOL,
                    interval SYMBOL,
                    timestamp TIMESTAMP,
                    open DOUBLE,
                    high DOUBLE,
                    low DOUBLE,
                    close DOUBLE,
                    volume DOUBLE
                ) TIMESTAMP(timestamp) PARTITION BY MONTH BYPASS WAL;
                """
            )
            logger.info(f"Verified/Created table {self.table_name} with BYPASS WAL strategy.")
        except Exception as e:
            logger.error(f"Failed to connect to QuestDB: {e}", exc_info=True)
            raise
        
        def _create_consumer():
            return KafkaConsumer(
                config.TOPIC_RAW_TRADES,
                bootstrap_servers=[config.KAFKA_SERVER],
                api_version=(3, 4, 0),
                auto_offset_reset='latest',
                enable_auto_commit=False,
                consumer_timeout_ms=1000,
                value_deserializer=lambda x: json.loads(x.decode('utf-8')),
                group_id='candle-processor-group'
            )
        
        self.consumer = retry_with_backoff(_create_consumer, operation_name='Kafka consumer creation')
        
        def _create_producer():
            return KafkaProducer(
                bootstrap_servers=[config.KAFKA_SERVER],
                api_version=(3, 4, 0),
                value_serializer=lambda v: json.dumps(v).encode('utf-8'),
                retries=5,
                linger_ms=5,
                request_timeout_ms=30000,
            )
        
        self.producer = retry_with_backoff(_create_producer, operation_name='Kafka producer creation')
        self.running = True

    def save_to_db(self, candle: dict) -> bool:
        def _insert():
            db_timestamp_str = candle['timestamp'].strftime('%Y-%m-%d %H:%M:%S')
            self.db_cursor.execute(
                f"""
                INSERT INTO {self.table_name} (symbol, interval, timestamp, open, high, low, close, volume)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    candle['symbol'],
                    candle['interval'],
                    db_timestamp_str,
                    candle['open'],
                    candle['high'],
                    candle['low'],
                    candle['close'],
                    candle['volume']
                )
            )
            self.consumer.commit()

        try:
            retry_with_backoff(_insert, max_retries=3, operation_name='QuestDB insert')
            logger.info(f"[DB INSERT] Persisted 1m candle for {candle['symbol']} at {candle['timestamp'].strftime('%H:%M:%S')}")
            return True
        except Exception:
            logger.error(f"[DB INSERT ERROR] Failed to save candle after retries: {candle}")
            return False

    def _send_to_topic(self, topic: str, value: dict):
        def _send():
            future = self.producer.send(topic, value=value, key=value['symbol'].encode('utf-8'))
            result = future.get(timeout=15)
            return result

        retry_with_backoff(_send, max_retries=4, base_delay=0.5, operation_name=f'Kafka publish to {topic}')

    def broadcast_candle(self, candle: dict, is_final: bool = False):
        kafka_candle = candle.copy()
        kafka_candle['is_final'] = is_final
        kafka_candle['timestamp'] = kafka_candle['timestamp'].isoformat()

        if is_final:
            if not self.save_to_db(candle):
                logger.warning(f"Skipping final candle publish for {candle['symbol']} because DB persistence failed.")
                return

        try:
            self._send_to_topic(config.TOPIC_KLINE_STREAM, kafka_candle)
        except Exception:
            logger.error(f"Failed to publish candle update for {candle['symbol']} to Kafka.", exc_info=True)

    def run(self):
        logger.info("Starting MULTI-SYMBOL processor loop...")
        try:
            while self.running:
                raw_messages = self.consumer.poll(timeout_ms=1000)
                
                for topic_partition, messages in raw_messages.items():
                    for message in messages:
                        raw_trade = message.value
                        
                        try:
                            trade = raw_trade.get('data', raw_trade)
                            symbol = trade.get('s') or trade.get('symbol')
                            
                            if not symbol:
                                logger.debug(f"[DROP] Thiếu Symbol: {raw_trade}")
                                continue
                                
                            if not all(k in trade for k in ('timestamp', 'price', 'volume')):
                                logger.debug(f"[DROP] Thiếu price/volume: {raw_trade}")
                                continue
                            
                            symbol = symbol.lower()
                            price = float(trade['price'])
                            volume = float(trade['volume'])
                            
                            if price <= 0 or volume <= 0:
                                continue
                                
                            trade_time = datetime.fromtimestamp(trade['timestamp'] / 1000.0, tz=timezone.utc)
                            if trade_time.year < 2020:
                                continue
                                
                            if symbol not in self.managers:
                                logger.info(f"Phát hiện luồng dữ liệu mới: {symbol.upper()}. Đang khởi tạo CandleManager...")
                                self.managers[symbol] = BaseCandleManager(symbol)
                                self.managers[symbol].broadcast_callback = self.broadcast_candle
                                
                            manager = self.managers[symbol]
                            
                            with manager.lock:
                                trade_with_time = trade.copy()
                                trade_with_time['datetime'] = trade_time
                                manager.trades_buffer.append(trade_with_time)
                                
                                if manager.current_minute is None:
                                    manager.current_minute = manager.truncate_to_minute(trade_time)
                                    manager.schedule_next_update()
                                    continue
                                    
                                trade_minute = manager.truncate_to_minute(trade_time)
                                if trade_minute > manager.current_minute:
                                    last_candle = manager.calculate_ohlcv()
                                    if last_candle:
                                        self.broadcast_candle(last_candle, is_final=True)
                                    manager.current_minute = trade_minute
                                    
                                manager.trade_count_since_cleanup += 1
                                if manager.trade_count_since_cleanup > 1000:
                                    manager.cleanup_old_trades()
                                    manager.trade_count_since_cleanup = 0
                                    
                        except Exception as e:
                            logger.error(f"Error processing individual trade: {e}", exc_info=True)
                            
        except KeyboardInterrupt:
            logger.info("Shutdown signal received")
        except Exception as e:
            logger.error(f"Unexpected error in processor: {e}", exc_info=True)
        finally:
            self.shutdown()

    def shutdown(self):
        self.running = False
        
        for manager in self.managers.values():
            manager.cleanup()

        try:
            self.consumer.close()
        except Exception as exc:
            logger.warning(f"Failed to close Kafka consumer cleanly: {exc}", exc_info=True)

        try:
            self.producer.flush(timeout=10)
            self.producer.close()
        except Exception as exc:
            logger.warning(f"Failed to flush/close Kafka producer cleanly: {exc}", exc_info=True)
        
        try:
            if hasattr(self, 'db_cursor'):
                self.db_cursor.close()
            if hasattr(self, 'db_conn'):
                self.db_conn.close()
        except Exception as exc:
            logger.warning(f"Failed to close QuestDB connection cleanly: {exc}", exc_info=True)
            
        logger.info("Processor shut down successfully")

if __name__ == "__main__":
    app = CandleProcessor()

    def _handle_signal(sig, frame):
        logger.info(f"Received signal {sig}. Initiating graceful shutdown...")
        app.shutdown()
        sys.exit(0)

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    app.run()