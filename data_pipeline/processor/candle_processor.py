import json
from datetime import datetime
import psycopg2
from kafka import KafkaConsumer, KafkaProducer
import threading
import time

from data_pipeline import config

class CandleProcessor:
    def __init__(self, symbol="btcusdt"):
        """Khởi tạo Processor"""
        self.symbol = symbol.lower()
        self.table_name = f"{self.symbol}_1m_candles"
        
        print(f" - Khởi tạo Trạm xử lý nến cho cặp {self.symbol.upper()}...")
        
        self.consumer = KafkaConsumer(
            config.TOPIC_RAW_TRADES,
            bootstrap_servers=[config.KAFKA_SERVER],
            auto_offset_reset='latest',
            value_deserializer=lambda x: json.loads(x.decode('utf-8'))
        )
        
        self.producer = KafkaProducer(
            bootstrap_servers=[config.KAFKA_SERVER],
            value_serializer=lambda v: json.dumps(v).encode('utf-8')
        )
        
        self._connect_db()
        self._setup_database()
        
        self.current_minute = None
        self.trades_buffer = []
        self.update_timer = None
        self.lock = threading.Lock()  # Lock để thread safety
        self.running = True  # Flag để menghentikan timer
        self.first_trade_price_of_minute = None  # Lưu giá trade đầu tiên của phút
        
        print(f" - Khởi tạo thành công! Bắt đầu lắng nghe dữ liệu từ '{config.TOPIC_RAW_TRADES}'...")

    def _connect_db(self):
        """Hàm nội bộ kết nối QuestDB"""
        try:
            self.db_conn = psycopg2.connect(
                host=config.QUESTDB_HOST,
                port=config.QUESTDB_PORT,
                user=config.QUESTDB_USER,
                password=config.QUESTDB_PASSWORD,
                database=config.QUESTDB_DATABASE
            )
            self.db_conn.autocommit = True
            self.cursor = self.db_conn.cursor()
            print(" - Đã kết nối thành công với QuestDB!")
        except Exception as e:
            print(f" - Lỗi kết nối QuestDB: {e}")
            exit()

    def _setup_database(self):
        """Khởi tạo bảng tối ưu cho Time-series nếu chưa có"""
        query = f"""
        CREATE TABLE IF NOT EXISTS {self.table_name} (
            timestamp TIMESTAMP,
            open DOUBLE,
            high DOUBLE,
            low DOUBLE,
            close DOUBLE,
            volume DOUBLE
        ) timestamp(timestamp) PARTITION BY DAY;
        """
        self.cursor.execute(query)

    def calculate_ohlc(self):
        """Trích xuất giá trị Open, High, Low, Close, Volume"""
        prices = [t['price'] for t in self.trades_buffer]
        volumes = [t['volume'] for t in self.trades_buffer]
        
        return {
            'symbol': self.symbol.upper(),
            'timestamp': self.current_minute,
            'open': prices[0],
            'high': max(prices),
            'low': min(prices),
            'close': prices[-1],
            'volume': sum(volumes)
        }

    def save_to_db(self, candle):
        """Lưu trữ vào Database"""
        query = f"INSERT INTO {self.table_name} VALUES (%s, %s, %s, %s, %s, %s)"
        self.cursor.execute(
            query,
            (candle['timestamp'], candle['open'], candle['high'], 
             candle['low'], candle['close'], candle['volume'])
        )

    def broadcast_to_kafka(self, candle):
        """Đẩy dữ liệu nến lên trạm Kafka cho NestJS"""
        kafka_candle = candle.copy()

        kafka_candle['timestamp'] = kafka_candle['timestamp'].isoformat()
        self.producer.send(config.TOPIC_PROCESSED_CANDLES, value=kafka_candle)

    def broadcast_updating_candle(self, candle_data):
        """Đẩy dữ liệu nến tạm thời (updating) lên Kafka"""
        kafka_updating = candle_data.copy()
        kafka_updating['is_final'] = False
        kafka_updating['timestamp'] = kafka_updating['timestamp'].isoformat()
        
        print(f" -  Gửi candle.updating {self.symbol.upper()} | "
              f"O: {candle_data['open']:,.2f} | H: {candle_data['high']:,.2f} | "
              f"L: {candle_data['low']:,.2f} | C: {candle_data['close']:,.2f} | "
              f"V: {candle_data['volume']:,.0f} | Trades: {len(self.trades_buffer)}")
        
        self.producer.send(config.TOPIC_UPDATING_CANDLES, value=kafka_updating)

    def _emit_500ms_update(self):
        """Emit candle.updating mỗi 500ms từ trades_buffer"""
        if not self.running:
            return
            
        with self.lock:
            if self.trades_buffer and self.current_minute is not None and self.first_trade_price_of_minute is not None:
                prices = [t['price'] for t in self.trades_buffer]
                volumes = [t['volume'] for t in self.trades_buffer]
                
                updating_candle = {
                    'symbol': self.symbol.upper(),
                    'timestamp': self.current_minute,
                    'open': self.first_trade_price_of_minute,
                    'high': max(prices),
                    'low': min(prices),
                    'close': prices[-1],
                    'volume': sum(volumes)
                }
                
                if updating_candle['open'] == 0 or updating_candle['high'] == 0 or updating_candle['low'] == 0 or updating_candle['close'] == 0:
                    print(f" - ⚠️  WARNING: Zero price detected! Candle: {updating_candle}")
                    print(f"   Trades buffer size: {len(self.trades_buffer)}, first_trade_price: {self.first_trade_price_of_minute}")
                
                self.broadcast_updating_candle(updating_candle)
            elif not self.trades_buffer:
                print(f" - ⚠️  trades_buffer is empty at {self.current_minute}")

        if self.running:
            self.update_timer = threading.Timer(0.5, self._emit_500ms_update)
            self.update_timer.daemon = True
            self.update_timer.start()

    def _schedule_next_update(self):
        """Lên lịch emit candle.updating tiếp theo"""
        if self.running and not self.update_timer:
            self.update_timer = threading.Timer(0.5, self._emit_500ms_update)
            self.update_timer.daemon = True
            self.update_timer.start()

    def process_candle(self):
        """Quy trình nguyên tử: Đúc -> Lưu -> Phát dữ liệu nến"""
        candle = self.calculate_ohlc()
        self.save_to_db(candle)
        
        candle_final = candle.copy()
        candle_final['is_final'] = True
        self.broadcast_to_kafka(candle_final)
        
        print(f" - Đã lưu & phát sóng nến {self.symbol.upper()} lúc {candle['timestamp'].strftime('%H:%M')} | "
              f"O: {candle['open']:,.2f} | H: {candle['high']:,.2f} | "
              f"L: {candle['low']:,.2f} | C: {candle['close']:,.2f} | "
              f"Trades: {len(self.trades_buffer)}")

    def run(self):
        """Hàm chính chạy vòng lặp vô tận để xử lý dữ liệu trade thành nến 1 phút"""
        try:
            for message in self.consumer:
                trade = message.value
                
                trade_time = datetime.fromtimestamp(trade['timestamp'] / 1000.0)
                trade_minute = trade_time.replace(second=0, microsecond=0)

                if self.current_minute is None:
                    self.current_minute = trade_minute
                    self.first_trade_price_of_minute = trade['price']
                    self.trades_buffer = [trade]
                    self._schedule_next_update()

                if trade_minute > self.current_minute:
                    if self.trades_buffer:
                        self.process_candle()

                    self.current_minute = trade_minute
                    self.first_trade_price_of_minute = trade['price']
                    self.trades_buffer = [trade]
                else:
                    self.trades_buffer.append(trade)
                    
        except KeyboardInterrupt:
            print("\n - Nhận lệnh dừng. Đang đóng hệ thống ...")
        finally:
            self.shutdown()

    def shutdown(self):
        """Giải phóng tài nguyên khi dừng chương trình"""
        self.running = False
        if self.update_timer:
            self.update_timer.cancel()
        
        self.consumer.close()
        self.producer.close()
        if hasattr(self, 'cursor'):
            self.cursor.close()
        if hasattr(self, 'db_conn'):
            self.db_conn.close()
        print(" - Đã giải phóng toàn bộ tài nguyên.")

# ==========================================
# KHỞI CHẠY CHƯƠNG TRÌNH
# ==========================================
if __name__ == "__main__":
    app = CandleProcessor(symbol="btcusdt")
    app.run()