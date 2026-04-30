import json
import websocket
from kafka import KafkaProducer

from data_pipeline import config
from data_pipeline.logger_config import get_logger

logger = get_logger(__name__)

class BinanceProducer:
    def __init__(self, symbol="btcusdt"):
        """Initialize producer with default trading pair"""
        self.symbol = symbol.lower()
        logger.info(f"Initializing producer for trading pair: {self.symbol.upper()}")
        
        self.producer = KafkaProducer(
            bootstrap_servers=[config.KAFKA_SERVER],
            value_serializer=lambda v: json.dumps(v).encode('utf-8')
        )

    def on_message(self, ws, message):
        """Handle incoming message from Binance"""
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
            
            action = "SELL" if clean_record["is_sell_pressure"] else "BUY"
            logger.debug(f"Pushed to Kafka: {action} | Price: {clean_record['price']:,.2f}")

    def on_open(self, ws):
        """Callback when WebSocket connection is successfully opened"""
        logger.info(f"Connected to Binance. Starting to push {self.symbol.upper()} data to topic: {config.TOPIC_RAW_TRADES}")
        
        subscribe_payload = {
            "method": "SUBSCRIBE",
            "params": [f"{self.symbol}@trade"],
            "id": 1,
        }
        ws.send(json.dumps(subscribe_payload))

    def on_close(self, ws, close_status_code, close_msg):
        """Handle connection closed"""
        logger.info(f"Disconnected from Binance ({self.symbol.upper()}). Closing Kafka Producer")
        self.producer.close()

    def on_error(self, ws, error):
        """Handle network error"""
        logger.error(f"WebSocket error: {error}")

    def run(self):
        """Start WebSocket and begin receiving data"""
        ws = websocket.WebSocketApp(
            config.BINANCE_SOCKET_URL,
            on_open=self.on_open,
            on_message=self.on_message,
            on_error=self.on_error,
            on_close=self.on_close
        )
        ws.run_forever()

# ==========================================
# PROGRAM STARTUP
# ==========================================
if __name__ == "__main__":
    app = BinanceProducer(symbol="btcusdt")
    app.run()