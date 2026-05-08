import json
import websocket
import threading
import signal
import sys
import time
from kafka import KafkaProducer

from data_pipeline import config
from data_pipeline.logger_config import get_logger

logger = get_logger(__name__)


def retry_with_backoff(operation, max_retries=4, base_delay=0.5, max_delay=10.0, operation_name='operation'):
    attempt = 0
    while attempt < max_retries:
        try:
            return operation()
        except Exception as error:
            attempt += 1
            if attempt >= max_retries:
                logger.error(f"{operation_name} failed after {attempt} attempts.", exc_info=True)
                raise
            delay = min(base_delay * (2 ** (attempt - 1)), max_delay)
            logger.warning(f"{operation_name} failed on attempt {attempt}. Retrying in {delay:.1f}s...", exc_info=True)
            time.sleep(delay)


class BinanceProducer:
    """Binance WebSocket producer for a single trading symbol."""

    def __init__(self, symbol: str):
        self.symbol = symbol.lower()
        self.ws = None
        self.is_running = True
        logger.info(f"Initializing Binance producer for: {self.symbol.upper()}")
        self.producer = KafkaProducer(
            bootstrap_servers=[config.KAFKA_SERVER],
            value_serializer=lambda v: json.dumps(v).encode('utf-8'),
            acks='all',
            retries=5,
            linger_ms=5,
            request_timeout_ms=30000,
        )
        
        logger.info(f"Kafka producer initialized for {self.symbol.upper()}")

    def _send_to_kafka(self, record: dict):
        def _send():
            future = self.producer.send(
                config.TOPIC_RAW_TRADES,
                value=record,
                key=self.symbol.encode()
            )
            result = future.get(timeout=15)
            logger.debug(
                f"Kafka ack received for {self.symbol.upper()}: partition={result.partition}, offset={result.offset}"
            )
            return result

        retry_with_backoff(_send, operation_name=f'Kafka publish for {self.symbol.upper()}')

    def on_message(self, ws, message):
        """Handle incoming Binance WebSocket message."""
        try:
            raw_message = json.loads(message)
            if 'result' in raw_message:
                return
            data = raw_message.get('data')
            if not data:
                logger.warning(f"Binance message missing data payload for {self.symbol.upper()}")
                return

            clean_record = {
                "trade_id": data['t'],
                "timestamp": data['T'],
                "price": float(data['p']),
                "volume": float(data['q']),
                "is_buyer_maker": data['m']
            }

            if clean_record['price'] <= 0 or clean_record['volume'] <= 0:
                logger.warning(f"Dropped invalid trade record for {self.symbol.upper()}: {clean_record}")
                return

            self._send_to_kafka(clean_record)
            action = "SELL" if clean_record["is_buyer_maker"] else "BUY"
            logger.debug(
                f"Sent to Kafka: {self.symbol.upper()} | {action} | "
                f"Price: {clean_record['price']:,.2f} | Volume: {clean_record['volume']:,.4f}"
            )

        except ValueError as e:
            logger.warning(f"Invalid Binance payload for {self.symbol.upper()}: {e}", exc_info=True)
        except Exception as e:
            logger.error(f"Error processing Binance message for {self.symbol.upper()}: {e}", exc_info=True)

    def on_open(self, ws):
        """Handle WebSocket open event."""
        logger.info(f"Connected to Binance WebSocket for {self.symbol.upper()}")
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
        """Handle WebSocket error and log with traceback."""
        logger.error(f"WebSocket error ({self.symbol.upper()}): {error}", exc_info=True)

    def run(self):
        """Start WebSocket connection and begin streaming trade data to Kafka."""
        while self.is_running:
            try:
                self.ws = websocket.WebSocketApp(
                    config.BINANCE_SOCKET_URL,
                    on_open=self.on_open,
                    on_message=self.on_message,
                    on_error=self.on_error,
                    on_close=self.on_close
                )
                logger.info(f"Connecting Binance WebSocket for {self.symbol.upper()}...")
                self.ws.run_forever()
                if self.is_running:
                    logger.warning(f"WebSocket connection for {self.symbol.upper()} closed unexpectedly. Reconnecting in 5 seconds...")
                    time.sleep(5)
            except Exception as e:
                logger.error(f"Fatal error in producer ({self.symbol.upper()}): {e}", exc_info=True)
                time.sleep(5)

        self.shutdown()

    def shutdown(self):
        """Gracefully shutdown the producer."""
        logger.info(f"Shutting down producer for {self.symbol.upper()}")
        self.is_running = False
        if self.ws:
            self.ws.close()
        try:
            self.producer.flush(timeout=10)
        except Exception as exc:
            logger.warning(f"Failed to flush Kafka producer for {self.symbol.upper()}: {exc}", exc_info=True)
        finally:
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
        self.is_running = False
        
        logger.info(f"Initializing Binance Producer Manager for symbols: {', '.join(s.upper() for s in self.symbols)}")

    def start(self):
        """Start all producers in separate threads."""
        self.is_running = True
        
        for symbol in self.symbols:
            try:
                producer = BinanceProducer(symbol)
                self.producers[symbol] = producer
                thread = threading.Thread(
                    target=producer.run,
                    name=f"BinanceProducer-{symbol.upper()}",
                    daemon=False
                )
                thread.start()
                self.threads[symbol] = thread
                
                logger.info(f"Started producer thread for {symbol.upper()}")
                
            except Exception as e:
                logger.error(f"Failed to start producer for {symbol.upper()}: {e}", exc_info=True)

    def shutdown(self):
        """Gracefully shutdown all producers."""
        if not self.is_running:
            return
            
        self.is_running = False
        logger.info("Shutting down Binance Producer Manager...")
        
        # Signal all producers to close
        for symbol, producer in self.producers.items():
            try:
                logger.info(f"Closing producer for {symbol.upper()}...")
                producer.shutdown()
            except Exception as e:
                logger.error(f"Error shutting down producer for {symbol.upper()}: {e}", exc_info=True)
        
        # Wait for all threads to finish with timeout
        logger.info("Waiting for all producer threads to finish...")
        for symbol, thread in self.threads.items():
            thread.join(timeout=5)
            if thread.is_alive():
                logger.warning(f"Producer thread for {symbol.upper()} did not finish within timeout")
            else:
                logger.info(f"Producer thread for {symbol.upper()} finished gracefully")
        
        logger.info("Binance Producer Manager shut down successfully")


# ==========================================
# PROGRAM STARTUP
# ==========================================
if __name__ == "__main__":
    manager = BinanceProducerManager()
    
    def signal_handler(sig, frame):
        """Handle SIGINT and SIGTERM signals."""
        logger.info(f"Received signal {sig}. Initiating graceful shutdown...")
        manager.shutdown()
        sys.exit(0)
    
    # Register signal handlers
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    try:
        logger.info("Starting Binance Producer Manager...")
        manager.start()
        while manager.is_running:
            if any(not thread.is_alive() for thread in manager.threads.values()):
                logger.error("A producer thread has died. Shutting down...")
                manager.shutdown()
                sys.exit(1)
            threading.Event().wait(1)
    except Exception as e:
        logger.error(f"Fatal error in main: {e}", exc_info=True)
        manager.shutdown()
        sys.exit(1)