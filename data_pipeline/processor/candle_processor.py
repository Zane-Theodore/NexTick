import json
import threading
from datetime import datetime, timedelta, timezone

import psycopg2
from kafka import KafkaConsumer, KafkaProducer

from data_pipeline import config
from data_pipeline.logger_config import get_logger

logger = get_logger(__name__)

class BaseCandleManager:
    """
    Manages strictly 1m candle generation.
    
    Uses rollup architecture: Only keeps raw data for 2 minutes to maximize RAM efficiency.
    Automatically cleans up old trades periodically to prevent memory buildup.
    """
    def __init__(self, symbol: str):
        self.symbol = symbol.lower()
        self.interval = '1m'
        self.current_minute = None
        self.trades_buffer = []
        self.lock = threading.Lock()
        self.update_timer = None
        self.running = True
        self.first_trade_price = 0.0
        self.broadcast_callback = None
        self.trade_count_since_cleanup = 0
        logger.info(f"Initialized BaseCandleManager for {self.symbol.upper()} (1m only)")

    def truncate_to_minute(self, timestamp: datetime) -> datetime:
        """Truncate timestamp to minute boundary.
        
        Args:
            timestamp: DateTime to truncate
            
        Returns:
            DateTime with seconds and microseconds set to 0
        """
        return timestamp.replace(second=0, microsecond=0)

    def calculate_ohlcv(self) -> dict:
        """Calculate OHLCV (Open, High, Low, Close, Volume) for current minute.
        
        Processes all trades in the current minute window to compute candle data.
        Returns None if no trades are available for the current minute.
        
        Returns:
            Dictionary with OHLCV data or None if no trades in current minute
        """
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
        """Schedule next update timer to broadcast intermediate candles.
        
        Sets up a timer to periodically emit updating candles to connected clients.
        Only creates timer if not already running.
        """
        if self.running and not self.update_timer:
            self.update_timer = threading.Timer(
                config.CANDLE_UPDATE_INTERVAL_MS / 1000.0,
                self._emit_updating_candles
            )
            self.update_timer.daemon = True
            self.update_timer.start()

    def _emit_updating_candles(self):
        """Emit intermediate candle updates to connected clients.
        
        Called periodically by timer to broadcast partial candle data
        before minute finalization. Reschedules itself for continuous updates.
        """
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
        """Clean up old trades from buffer to conserve memory.
        
        Only keeps trades from the most recent 2 minutes.
        """
        if not self.trades_buffer: return
        latest_trade_time = self.trades_buffer[-1]['datetime']
        cutoff_time = latest_trade_time - timedelta(minutes=2) 
        self.trades_buffer = [t for t in self.trades_buffer if t['datetime'] >= cutoff_time]

    def cleanup(self):
        """Cleanup resources on shutdown.
        
        Stops the manager and cancels any pending timers.
        """
        if self.update_timer:
            self.update_timer.cancel()


class CandleProcessor:
    """Process raw trades into 1-minute candles.
    
    Consumes raw trade data from Kafka, generates 1m candles, and persists to QuestDB.
    Uses synchronous database writes with BYPASS WAL for immediate persistence.
    Broadcasts candles to frontend via Kafka as they're generated.
    """
    def __init__(self, symbol: str = "btcusdt"):
        self.symbol = symbol.lower()
        self.table_name = "market_candles"
        
        logger.info(f"Initializing PURE 1M processor for {self.symbol.upper()} using psycopg2 (Synchronous).")
        
        # Configure synchronous database connection (bypass WAL delay)
        try:
            self.db_conn = psycopg2.connect(
                host=config.QUESTDB_HOST,
                port=8812,
                database="qdb",
                user="admin",
                password="quest"
            )
            self.db_conn.autocommit = True  # Force immediate commit without WAL delay
            self.db_cursor = self.db_conn.cursor()
            logger.info("Connected to QuestDB via PostgreSQL wire protocol.")

            # Auto-create market_candles table with BYPASS WAL if not exists
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
        
        self.consumer = KafkaConsumer(
            config.TOPIC_RAW_TRADES,
            bootstrap_servers=[config.KAFKA_SERVER],
            auto_offset_reset='latest',
            enable_auto_commit=False, 
            value_deserializer=lambda x: json.loads(x.decode('utf-8')),
            group_id=f'candle-processor-{symbol}'
        )
        
        self.producer = KafkaProducer(
            bootstrap_servers=[config.KAFKA_SERVER],
            value_serializer=lambda v: json.dumps(v).encode('utf-8')
        )
        
        self.interval_manager = BaseCandleManager(self.symbol)
        self.interval_manager.broadcast_callback = self.broadcast_candle
        self.running = True

    def save_to_db(self, candle: dict):
        """Synchronously save candle data to QuestDB.
        
        Commits candle to database with BYPASS WAL strategy for immediate persistence.
        Updates Kafka consumer offset after successful database commit.
        """
        try:
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
            # Database has persisted data, now safely commit Kafka offset
            self.consumer.commit()
            logger.info(f"[DB INSERT] Synchronously persisted 1m candle for {candle['timestamp'].strftime('%H:%M:%S')}")
            
        except Exception as e:
            logger.error(f"[DB INSERT ERROR] Failed to save candle: {e}", exc_info=True)

    def broadcast_candle(self, candle: dict, is_final: bool = False):
        """Broadcast candle to frontend via Kafka.
        
        For final candles, synchronously persists to database before sending.
        For intermediate candles, sends updates without persistence.
        
        Args:
            candle: Candle OHLCV data to broadcast
            is_final: If True, persist to DB before broadcasting
        """
        kafka_candle = candle.copy()
        kafka_candle['is_final'] = is_final
        kafka_candle['timestamp'] = kafka_candle['timestamp'].isoformat()
        
        if is_final:
            # Process waits here until database confirms successful save
            self.save_to_db(candle)
            
        self.producer.send(config.TOPIC_KLINE_STREAM, value=kafka_candle)

    def run(self):
        """Start processing trades and generating candles.
        
        Main processing loop that:
        1. Consumes raw trades from Kafka
        2. Validates and buffers trades by minute
        3. Generates and broadcasts candles when minute boundaries are crossed
        4. Persists final candles to database
        
        Runs until interrupted or error occurs.
        """
        logger.info(f"Starting processor for {self.symbol.upper()}")
        try:
            while self.running:
                raw_messages = self.consumer.poll(timeout_ms=1000)
                
                for topic_partition, messages in raw_messages.items():
                    for message in messages:
                        trade = message.value
                        
                        try:
                            # Validate required fields from raw trade data
                            if not all(k in trade for k in ('timestamp', 'price', 'volume')):
                                continue
                                
                            if float(trade['price']) <= 0 or float(trade['volume']) <= 0:
                                logger.warning(f"Rejected invalid trade data - price or volume <= 0: {trade}")
                                continue
                                
                            # Parse timestamp and fix timezone to UTC to match Binance candles
                            trade_time = datetime.fromtimestamp(trade['timestamp'] / 1000.0, tz=timezone.utc)
                            
                            if trade_time.year < 2020:
                                logger.warning(f"Rejected trade with invalid year (before 2020): {trade}")
                                continue
                            
                            with self.interval_manager.lock:
                                trade_with_time = trade.copy()
                                trade_with_time['datetime'] = trade_time
                                self.interval_manager.trades_buffer.append(trade_with_time)
                                
                                # Initialize the first minute if not yet set
                                if not self.interval_manager.current_minute:
                                    self.interval_manager.current_minute = self.interval_manager.truncate_to_minute(trade_time)
                                    self.interval_manager.first_trade_price = trade['price']
                                    self.interval_manager.schedule_next_update()
                                    continue
                                
                                trade_minute = self.interval_manager.truncate_to_minute(trade_time)
                                
                                # Move to next minute: finalize current 1m candle and advance clock
                                if trade_minute > self.interval_manager.current_minute:
                                    last_candle = self.interval_manager.calculate_ohlcv()
                                    
                                    if last_candle:
                                        self.broadcast_candle(last_candle, is_final=True)
                                        
                                    # Advance to new minute and reset first_trade_price
                                    self.interval_manager.current_minute = trade_minute
                                    self.interval_manager.first_trade_price = trade['price']
                                self.interval_manager.trade_count_since_cleanup += 1
                                if self.interval_manager.trade_count_since_cleanup > 1000:
                                    self.interval_manager.cleanup_old_trades()
                                    self.interval_manager.trade_count_since_cleanup = 0
                                    
                        except Exception as e:
                            logger.error(f"Error processing individual trade: {e}", exc_info=True)
                            
        except KeyboardInterrupt:
            logger.info("Shutdown signal received")
        except Exception as e:
            logger.error(f"Unexpected error in processor: {e}", exc_info=True)
        finally:
            self.shutdown()

    def shutdown(self):
        """Gracefully shutdown processor.
        
        Closes all connections: consumer, producer, database.
        Ensures no resource leaks.
        """
        self.interval_manager.cleanup()
        self.consumer.close()
        self.producer.close()
        
        # Gracefully close database connection
        if hasattr(self, 'db_cursor'):
            self.db_cursor.close()
        if hasattr(self, 'db_conn'):
            self.db_conn.close()
            
        logger.info(f"Processor for {self.symbol.upper()} shut down successfully")

if __name__ == "__main__":
    app = CandleProcessor(symbol="btcusdt")
    app.run()