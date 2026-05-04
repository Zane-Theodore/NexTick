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
    Kiến trúc Rollup: Chỉ giữ data thô trong 2 phút để giải phóng RAM tối đa.
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
        """Dọn rác RAM cực kỳ quyết liệt: Chỉ giữ lại 2 phút gần nhất"""
        if not self.trades_buffer: return
        latest_trade_time = self.trades_buffer[-1]['datetime']
        cutoff_time = latest_trade_time - timedelta(minutes=2) 
        self.trades_buffer = [t for t in self.trades_buffer if t['datetime'] >= cutoff_time]

    def cleanup(self):
        self.running = False
        if self.update_timer:
            self.update_timer.cancel()


class CandleProcessor:
    def __init__(self, symbol: str = "btcusdt"):
        self.symbol = symbol.lower()
        self.table_name = "market_candles"
        
        logger.info(f"Initializing PURE 1M processor for {self.symbol.upper()} using psycopg2 (Synchronous).")
        
        # --- CẤU HÌNH KẾT NỐI ĐỒNG BỘ (Bypass WAL delay) ---
        try:
            self.db_conn = psycopg2.connect(
                host=config.QUESTDB_HOST,
                port=8812,
                database="qdb",
                user="admin",
                password="quest"
            )
            self.db_conn.autocommit = True  # ÉP CHỐT SỔ NGAY LẬP TỨC
            self.db_cursor = self.db_conn.cursor()
            logger.info("Connected to QuestDB via PostgreSQL wire protocol.")

            # =================================================================
            # TỰ ĐỘNG TẠO BẢNG CHỐNG HỐ ĐEN (BYPASS WAL) NẾU CHƯA CÓ
            # =================================================================
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
            logger.error(f"Failed to connect to QuestDB: {e}")
            raise
        
        self.consumer = KafkaConsumer(
            config.TOPIC_RAW_TRADES,
            bootstrap_servers=[config.KAFKA_SERVER],
            auto_offset_reset='latest',
            enable_auto_commit=False, 
            value_deserializer=lambda x: json.loads(x.decode('utf-8')),
            group_id=f'candle-processor-{symbol}-v7' # Tăng version để dọn sạch rác Kafka
        )
        
        self.producer = KafkaProducer(
            bootstrap_servers=[config.KAFKA_SERVER],
            value_serializer=lambda v: json.dumps(v).encode('utf-8')
        )
        
        self.interval_manager = BaseCandleManager(self.symbol)
        self.interval_manager.broadcast_callback = self.broadcast_candle
        self.running = True

    def save_to_db(self, candle: dict):
        """Ghi đồng bộ trực tiếp xuống DB. F5 là có ngay không cần đợi WAL!"""
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
            # Database đã có dữ liệu 100%, giờ mới cho phép Kafka đi tiếp
            self.consumer.commit()
            logger.info(f"[DB INSERT] Synchronously committed 1m candle for {candle['timestamp'].strftime('%H:%M:%S')}")
            
        except Exception as e:
            logger.error(f"[DB INSERT ERROR] Failed to save candle: {e}")

    def broadcast_candle(self, candle: dict, is_final: bool = False):
        kafka_candle = candle.copy()
        kafka_candle['is_final'] = is_final
        kafka_candle['timestamp'] = kafka_candle['timestamp'].isoformat()
        
        if is_final:
            # Code sẽ đứng đợi ở đây cho đến khi DB báo lưu thành công
            self.save_to_db(candle)
            
        self.producer.send(config.TOPIC_KLINE_STREAM, value=kafka_candle)

    def run(self):
        logger.info(f"Starting processor for {self.symbol.upper()}")
        try:
            while self.running:
                raw_messages = self.consumer.poll(timeout_ms=1000)
                
                for topic_partition, messages in raw_messages.items():
                    for message in messages:
                        trade = message.value
                        
                        try:
                            # --- 🛡️ BỘ LỌC RÁC KAFKA ---
                            if not all(k in trade for k in ('timestamp', 'price', 'volume')):
                                continue
                                
                            if float(trade['price']) <= 0 or float(trade['volume']) <= 0:
                                logger.warning(f"🚨 CHẶN DATA RÁC: Giá/Volume <= 0: {trade}")
                                continue
                                
                            # Cố định múi giờ UTC để khớp với nến của Binance
                            trade_time = datetime.fromtimestamp(trade['timestamp'] / 1000.0, tz=timezone.utc)
                            
                            if trade_time.year < 2020:
                                logger.warning(f"🚨 CHẶN DATA 1970: {trade}")
                                continue
                            # ------------------------
                            
                            with self.interval_manager.lock:
                                trade_with_time = trade.copy()
                                trade_with_time['datetime'] = trade_time
                                self.interval_manager.trades_buffer.append(trade_with_time)
                                
                                # Khởi tạo phút đầu tiên
                                if not self.interval_manager.current_minute:
                                    self.interval_manager.current_minute = self.interval_manager.truncate_to_minute(trade_time)
                                    self.interval_manager.first_trade_price = trade['price']
                                    self.interval_manager.schedule_next_update()
                                    continue
                                
                                trade_minute = self.interval_manager.truncate_to_minute(trade_time)
                                
                                # Nếu bước sang phút mới -> Chốt nến 1m cũ
                                if trade_minute > self.interval_manager.current_minute:
                                    last_candle = self.interval_manager.calculate_ohlcv()
                                    
                                    if last_candle:
                                        self.broadcast_candle(last_candle, is_final=True)
                                        
                                    # Chuyển kim đồng hồ sang phút mới
                                    self.interval_manager.current_minute = trade_minute
                                    self.interval_manager.first_trade_price = trade['price']
                                        
                                self.interval_manager.trade_count_since_cleanup += 1
                                if self.interval_manager.trade_count_since_cleanup > 1000:
                                    self.interval_manager.cleanup_old_trades()
                                    self.interval_manager.trade_count_since_cleanup = 0
                                    
                        except Exception as e:
                            logger.error(f"Error processing individual trade: {e}")
                            
        except KeyboardInterrupt:
            logger.info("Shutdown signal received")
        finally:
            self.shutdown()

    def shutdown(self):
        self.running = False
        self.interval_manager.cleanup()
        self.consumer.close()
        self.producer.close()
        
        # Đóng kết nối DB gọn gàng
        if hasattr(self, 'db_cursor'):
            self.db_cursor.close()
        if hasattr(self, 'db_conn'):
            self.db_conn.close()
            
        logger.info(f"Processor for {self.symbol.upper()} shut down successfully")

if __name__ == "__main__":
    app = CandleProcessor(symbol="btcusdt")
    app.run()