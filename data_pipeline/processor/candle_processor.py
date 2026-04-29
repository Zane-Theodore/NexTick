import json
from datetime import datetime
import psycopg2
from kafka import KafkaConsumer, KafkaProducer
import threading
import datetime as dt
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
        self.lock = threading.Lock()
        self.running = True
        self.first_trade_price_of_minute = None
        
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

    def _validate_trade(self, trade):
        """Validate dữ liệu trade từ Kafka"""
        try:
            if not trade or not isinstance(trade, dict):
                return False
            
            required_fields = ['timestamp', 'price', 'volume']
            for field in required_fields:
                if field not in trade:
                    return False
            
            price = trade.get('price')
            volume = trade.get('volume')
            
            if not isinstance(price, (int, float)) or not isinstance(volume, (int, float)):
                return False
            
            if price <= 0 or volume < 0:
                print(f" - ⚠️  Lỗi: Trade có giá không hợp lệ: price={price}, volume={volume}")
                return False
            
            if price != price or volume != volume:
                return False
                
            return True
        except Exception as e:
            print(f" - ⚠️  Lỗi validate trade: {e}")
            return False

    def calculate_ohlc(self):
        """Trích xuất giá trị Open, High, Low, Close, Volume"""
        if not self.trades_buffer:
            print(f" - ⚠️  Lỗi: trades_buffer rỗng khi tính OHLC")
            return None
            
        prices = [t['price'] for t in self.trades_buffer]
        volumes = [t['volume'] for t in self.trades_buffer]
        
        if not prices or not volumes:
            print(f" - ⚠️  Lỗi: Không có dữ liệu giá hoặc volume")
            return None
        
        open_price = prices[0]
        high_price = max(prices)
        low_price = min(prices)
        close_price = prices[-1]
        total_volume = sum(volumes)
        
        if open_price <= 0 or high_price <= 0 or low_price <= 0 or close_price <= 0:
            print(f" - ⚠️  Lỗi: Giá tính toán không hợp lệ: O={open_price}, H={high_price}, L={low_price}, C={close_price}")
            return None
        
        return {
            'symbol': self.symbol.upper(),
            'timestamp': self.current_minute,
            'open': open_price,
            'high': high_price,
            'low': low_price,
            'close': close_price,
            'volume': total_volume
        }

    def save_to_db(self, candle):
        """Lưu trữ vào Database"""
        query = f"INSERT INTO {self.table_name} VALUES (%s, %s, %s, %s, %s, %s)"
        self.cursor.execute(
            query,
            (candle['timestamp'], candle['open'], candle['high'], 
             candle['low'], candle['close'], candle['volume'])
        )

    def broadcast_to_kline_stream(self, candle_data, is_final=True):
        """
        Unified method to broadcast all candles (both completed and updating) to single Kafka topic.
        This is the Single Source of Truth for candle stream.
        
        Args:
            candle_data: Candle dictionary with OHLCV data
            is_final: Boolean flag - True for completed candles, False for in-progress candles
        """
        kafka_candle = candle_data.copy()
        kafka_candle['is_final'] = is_final
        kafka_candle['timestamp'] = kafka_candle['timestamp'].isoformat()
        
        status = "FINAL" if is_final else "UPDATING"
        print(f" - Gửi kline {status} | {self.symbol.upper()} | "
              f"O: {candle_data['open']:,.2f} | H: {candle_data['high']:,.2f} | "
              f"L: {candle_data['low']:,.2f} | C: {candle_data['close']:,.2f} | "
              f"V: {candle_data['volume']:,.0f}")
        
        self.producer.send(config.TOPIC_KLINE_STREAM, value=kafka_candle)

    def broadcast_to_kafka(self, candle):
        """Legacy method - delegates to unified kline stream broadcaster"""
        self.broadcast_to_kline_stream(candle, is_final=True)

    def broadcast_updating_candle(self, candle_data):
        """Legacy method - delegates to unified kline stream broadcaster"""
        self.broadcast_to_kline_stream(candle_data, is_final=False)

    def _emit_500ms_update(self):
        """Emit candle.updating mỗi 500ms từ trades_buffer"""
        if not self.running:
            return
            
        with self.lock:
            if self.trades_buffer and self.current_minute is not None and self.first_trade_price_of_minute is not None:
                prices = [t['price'] for t in self.trades_buffer]
                volumes = [t['volume'] for t in self.trades_buffer]
                
                if not prices or not volumes:
                    print(f" - ⚠️  Lỗi: Không có dữ liệu giá hoặc volume để emit update")
                    return
                
                updating_candle = {
                    'symbol': self.symbol.upper(),
                    'timestamp': self.current_minute,
                    'open': self.first_trade_price_of_minute,
                    'high': max(prices),
                    'low': min(prices),
                    'close': prices[-1],
                    'volume': sum(volumes)
                }

                if (updating_candle['open'] <= 0 or updating_candle['high'] <= 0 or 
                    updating_candle['low'] <= 0 or updating_candle['close'] <= 0):
                    print(f" - ⚠️  SKIP: Nến có giá không hợp lệ - O:{updating_candle['open']}, H:{updating_candle['high']}, L:{updating_candle['low']}, C:{updating_candle['close']}")
                    print(f"   Trades: {len(self.trades_buffer)}, first_price: {self.first_trade_price_of_minute}")
                    return
                
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
        
        if candle is None:
            print(f" - ⚠️  SKIP: Không xử lý nến có dữ liệu không hợp lệ")
            return
        
        self.save_to_db(candle)
        
        # Broadcast final candle through unified kline stream
        self.broadcast_to_kline_stream(candle, is_final=True)
        
        print(f" - Đã lưu & phát sóng nến {self.symbol.upper()} lúc {candle['timestamp'].strftime('%H:%M')} | "
              f"O: {candle['open']:,.2f} | H: {candle['high']:,.2f} | "
              f"L: {candle['low']:,.2f} | C: {candle['close']:,.2f} | "
              f"Trades: {len(self.trades_buffer)}")

    def run(self):
        """Hàm chính chạy vòng lặp vô tận để xử lý dữ liệu trade thành nến 1 phút"""
        try:
            for message in self.consumer:
                try:
                    trade = message.value
                    
                    if not self._validate_trade(trade):
                        print(f" - ⚠️  SKIP: Trade không hợp lệ: {trade}")
                        continue
                    
                    trade_time = datetime.fromtimestamp(trade['timestamp'] / 1000.0)
                    trade_minute = trade_time.replace(second=0, microsecond=0)

                    if self.current_minute is None:
                        self.current_minute = trade_minute
                        self.first_trade_price_of_minute = trade['price']
                        self.trades_buffer = [trade]
                        self._schedule_next_update()
                        continue

                    if trade_minute > self.current_minute:
                        
                        minute_diff = int((trade_minute - self.current_minute).total_seconds() / 60)
                        
                        if self.trades_buffer:
                            self.process_candle()
                            last_close_price = self.trades_buffer[-1]['price']
                        else:
                            last_close_price = self.first_trade_price_of_minute

                        if last_close_price <= 0:
                            print(f" - ⚠️  SKIP: Không thể tạo flat candles với giá không hợp lệ: {last_close_price}")
                        elif minute_diff > 1:
                            print(f" - ⚠️ Phát hiện lỡ {minute_diff - 1} phút. Đang tự động điền nến phẳng...")
                            
                            for i in range(1, minute_diff):
                                missing_minute = self.current_minute + dt.timedelta(minutes=i)
                                flat_candle = {
                                    'symbol': self.symbol.upper(),
                                    'timestamp': missing_minute,
                                    'open': last_close_price,
                                    'high': last_close_price,
                                    'low': last_close_price,
                                    'close': last_close_price,
                                    'volume': 0.0
                                }
                                self.save_to_db(flat_candle)
                                
                                # Broadcast flat candle through unified kline stream
                                self.broadcast_to_kline_stream(flat_candle, is_final=True)
                                print(f" - Đã tự động điền nến phẳng cho phút {missing_minute.strftime('%H:%M')}")

                        with self.lock:
                            self.current_minute = trade_minute
                            self.first_trade_price_of_minute = trade['price']
                            self.trades_buffer = [trade]
                            
                    else:
                        with self.lock:
                            self.trades_buffer.append(trade)
                
                except Exception as e:
                    print(f" - ⚠️  Lỗi xử lý trade: {e}")
                    continue
                    
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