import json
import websocket
import threading
from kafka import KafkaProducer

from data_pipeline import config
from data_pipeline.logger_config import get_logger

logger = get_logger(__name__)

class BinanceProducer:
    """
    Binance WebSocket producer for a single trading symbol.
    
    Design principles:
    - Single responsibility: Each instance handles one symbol
    - Scalable: Uses partition key (symbol) in Kafka for easy distribution across consumers
    - Extensible: Easy to run multiple instances for different symbols in parallel
    """
    
    def __init__(self, symbol: str):
        """
        Initialize producer for a specific trading symbol.
        
        Args:
            symbol: Trading pair symbol (e.g., 'btcusdt', 'ethusdt')
                   Will be converted to lowercase
        """
        self.symbol = symbol.lower()
        self.ws = None
        
        logger.info(f"Initializing Binance producer for: {self.symbol.upper()}")
        
        # Kafka producer with partition key support
        self.producer = KafkaProducer(
            bootstrap_servers=[config.KAFKA_SERVER],
            value_serializer=lambda v: json.dumps(v).encode('utf-8'),
            acks='all',
            retries=3
        )
        
        logger.info(f"Kafka producer initialized for {self.symbol.upper()}")

    def on_message(self, ws, message):
        """
        Handle incoming WebSocket message from Binance.
        
        Each raw trade is sent to Kafka with partition key = symbol
        This ensures:
        - All trades for a symbol go to same partition
        - Easy to scale by assigning partitions to different consumer threads
        """
        try:
            raw_message = json.loads(message)
            
            # Ignore subscription confirmation messages
            if 'result' in raw_message:
                return
            
            data = raw_message.get('data')
            if not data:
                return
            
            # Extract and normalize trade data from Binance
            clean_record = {
                "trade_id": data['t'],
                "timestamp": data['T'],  # milliseconds
                "price": float(data['p']),
                "volume": float(data['q']),
                "is_buyer_maker": data['m']  # True if buy, False if sell
            }
            
            # Send to Kafka with symbol as partition key
            # This ensures all trades for a symbol go to the same partition
            self.producer.send(
                config.TOPIC_RAW_TRADES,
                value=clean_record,
                key=self.symbol.encode()
            )
            
            action = "SELL" if clean_record["is_buyer_maker"] else "BUY"
            logger.debug(
                f"Sent to Kafka: {self.symbol.upper()} | {action} | "
                f"Price: {clean_record['price']:,.2f} | Volume: {clean_record['volume']:,.4f}"
            )
            
        except Exception as e:
            logger.error(f"Error processing Binance message for {self.symbol.upper()}: {e}")

    def on_open(self, ws):
        """Callback when WebSocket connection is successfully opened."""
        logger.info(f"Connected to Binance WebSocket for {self.symbol.upper()}")
        
        # Subscribe to trades for this symbol
        subscribe_payload = {
            "method": "SUBSCRIBE",
            "params": [f"{self.symbol}@trade"],
            "id": 1,
        }
        ws.send(json.dumps(subscribe_payload))
        logger.info(f"Subscribed to {self.symbol.upper()}@trade. Streaming to {config.TOPIC_RAW_TRADES}")

    def on_close(self, ws, close_status_code, close_msg):
        """Handle connection closed."""
        logger.info(f"Disconnected from Binance ({self.symbol.upper()}). Closing producer...")
        self.producer.close()

    def on_error(self, ws, error):
        """Handle WebSocket error."""
        logger.error(f"WebSocket error ({self.symbol.upper()}): {error}")

    def run(self):
        """Start WebSocket connection and begin streaming trade data to Kafka."""
        try:
            self.ws = websocket.WebSocketApp(
                config.BINANCE_SOCKET_URL,
                on_open=self.on_open,
                on_message=self.on_message,
                on_error=self.on_error,
                on_close=self.on_close
            )
            self.ws.run_forever()
        except Exception as e:
            logger.error(f"Fatal error in producer ({self.symbol.upper()}): {e}")
            self.producer.close()
            raise

    def shutdown(self):
        """Gracefully shutdown the producer."""
        logger.info(f"Shutting down producer for {self.symbol.upper()}")
        if self.ws:
            self.ws.close()
        self.producer.close()


class BinanceProducerManager:
    """
    Manages multiple Binance producers for different symbols.
    
    Design: Each symbol runs in a separate thread
    Future scaling: Can be distributed across multiple processes/machines
    """
    
    def __init__(self, symbols=None):
        """
        Initialize producers for multiple symbols.
        
        Args:
            symbols: List of symbols to produce (default: from config)
        """
        self.symbols = symbols or config.TRADING_SYMBOLS
        self.producers = {}
        self.threads = {}
        
        logger.info(f"Initializing Binance Producer Manager for symbols: {', '.join(s.upper() for s in self.symbols)}")

    def start(self):
        """Start all producers in separate threads."""
        for symbol in self.symbols:
            try:
                producer = BinanceProducer(symbol)
                self.producers[symbol] = producer
                
                # Run each producer in a separate thread
                thread = threading.Thread(
                    target=producer.run,
                    name=f"BinanceProducer-{symbol.upper()}",
                    daemon=False
                )
                thread.start()
                self.threads[symbol] = thread
                
                logger.info(f"Started producer thread for {symbol.upper()}")
                
            except Exception as e:
                logger.error(f"Failed to start producer for {symbol.upper()}: {e}")

    def shutdown(self):
        """Gracefully shutdown all producers."""
        logger.info("Shutting down Binance Producer Manager")
        for symbol, producer in self.producers.items():
            try:
                producer.shutdown()
            except Exception as e:
                logger.error(f"Error shutting down producer for {symbol.upper()}: {e}")
        
        # Wait for all threads to finish
        for symbol, thread in self.threads.items():
            thread.join(timeout=5)
            logger.info(f"Producer thread for {symbol.upper()} finished")


# ==========================================
# PROGRAM STARTUP
# ==========================================
if __name__ == "__main__":
    # Option 1: Run specific symbols (can be overridden)
    # manager = BinanceProducerManager(symbols=['btcusdt', 'ethusdt'])
    
    # Option 2: Run symbols from config (recommended)
    manager = BinanceProducerManager()
    
    try:
        manager.start()
        # Keep main thread alive
        for thread in manager.threads.values():
            thread.join()
    except KeyboardInterrupt:
        logger.info("Received shutdown signal")
        manager.shutdown()