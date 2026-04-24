import json
import websocket
from kafka import KafkaProducer

from data_pipeline import config

class BinanceProducer:
    def __init__(self, symbol="btcusdt"):
        """Khởi tạo producer với cặp coin mặc định là BTC/USDT"""
        self.symbol = symbol.lower()
        print(f"⚙️ Khởi tạo producer cho cặp {self.symbol.upper()}...")
        
        self.producer = KafkaProducer(
            bootstrap_servers=[config.KAFKA_SERVER],
            value_serializer=lambda v: json.dumps(v).encode('utf-8')
        )

    def on_message(self, ws, message):
        """Xử lý khi có tin nhắn từ Binance rót về"""
        raw_message = json.loads(message)
        
        if 'result' in raw_message:
            return

        data = raw_message.get('data')
        if data:
            clean_record = {
                "trade_id": data['t'],
                "timestamp": data['T'],
                "price": float(data['p']),
                "volume": float(data['q']),
                "is_sell_pressure": data['m']
            }
            
            self.producer.send(config.TOPIC_RAW_TRADES, value=clean_record)
            
            action = "🔴 BÁN" if clean_record["is_sell_pressure"] else "🟢 MUA"
            print(f" - Đã đẩy vào Kafka: {action} | Giá: {clean_record['price']:,.2f}")

    def on_open(self, ws):
        """Kích hoạt khi mở kết nối thành công"""
        print(f" - Đã kết nối Binance. Bắt đầu bơm {self.symbol.upper()} vào topic: {config.TOPIC_RAW_TRADES}...")
        
        subscribe_payload = {
            "method": "SUBSCRIBE",
            "params": [f"{self.symbol}@trade"],
            "id": 1,
        }
        ws.send(json.dumps(subscribe_payload))

    def on_close(self, ws, close_status_code, close_msg):
        """Xử lý khi đóng kết nối"""
        print(f" - Đã ngắt kết nối với Binance ({self.symbol.upper()}). Đóng Kafka Producer.")
        self.producer.close()

    def on_error(self, ws, error):
        """Xử lý khi có lỗi mạng"""
        print(f" - Lỗi WebSocket: {error}")

    def run(self):
        """Khởi chạy WebSocket và bắt đầu nhận dữ liệu"""
        ws = websocket.WebSocketApp(
            config.BINANCE_SOCKET_URL,
            on_open=self.on_open,
            on_message=self.on_message,
            on_error=self.on_error,
            on_close=self.on_close
        )
        ws.run_forever()

# ==========================================
# KHỞI CHẠY CHƯƠNG TRÌNH
# ==========================================
if __name__ == "__main__":
    app = BinanceProducer(symbol="btcusdt")
    app.run()