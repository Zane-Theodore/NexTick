import json
import websocket
import signal
import sys
import time
from kafka import KafkaProducer
from kafka.errors import NoBrokersAvailable

from data_pipeline import config
from data_pipeline.logger_config import get_logger

logger = get_logger(__name__)


def retry_with_backoff(operation, max_retries=60, base_delay=1.0, max_delay=10.0, operation_name='operation'):
    """Execute an operation with exponential backoff retry logic.
    
    Args:
        operation: Callable to execute.
        max_retries: Maximum number of retry attempts.
        base_delay: Initial delay in seconds between retries.
        max_delay: Maximum delay in seconds between retries.
        operation_name: Descriptive name for logging.
        
    Returns:
        Result of the operation.
        
    Raises:
        Exception: If all retries are exhausted.
    """
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


class BinanceCombinedProducer:
    """Binance WebSocket producer for multiple trading symbols via Combined Stream.
    
    Connects to Binance WebSocket, consumes trade data for multiple symbols,
    and publishes raw trade records to Kafka for downstream processing.
    """

    def __init__(self, symbols: list):
        """Initialize Binance Combined Producer.
        
        Args:
            symbols: List of trading symbols to track (e.g., ['BTCUSDT', 'ETHUSDT']).
        """
        self.symbols = [s.lower() for s in symbols]
        self.ws = None
        self.is_running = True
        self.reconnect_attempt = 0
        self.max_reconnect_attempts = 10
        self.base_reconnect_delay = 5
        
        streams = "/".join([f"{sym}@trade" for sym in self.symbols])
        self.ws_url = f"wss://stream.binance.com:9443/stream?streams={streams}"
        
        logger.info(f"Initializing Binance Combined Producer for: {', '.join(s.upper() for s in self.symbols)}")
        
        def _create_producer():
            return KafkaProducer(
                bootstrap_servers=[config.KAFKA_SERVER],
                api_version=(3, 4, 0),
                value_serializer=lambda v: json.dumps(v).encode('utf-8'),
                acks='all',
                retries=5,
                linger_ms=5,
                request_timeout_ms=30000,
            )
        
        self.producer = retry_with_backoff(_create_producer, operation_name='Kafka producer creation')
        logger.info("Kafka producer initialized successfully.")

    def _send_to_kafka(self, record: dict):
        """Publish a trade record to Kafka.
        
        Args:
            record: Trade record to publish.
        """
        def _send():
            future = self.producer.send(
                config.TOPIC_RAW_TRADES,
                value=record,
                key=record['symbol'].encode('utf-8')
            )
            result = future.get(timeout=15)
            return result

        retry_with_backoff(_send, max_retries=3, operation_name=f"Kafka publish for {record['symbol']}")

    def on_message(self, ws, message):
        """Handle incoming Binance WebSocket trade message.
        
        Args:
            ws: WebSocket connection object.
            message: Raw message from WebSocket.
        """
        try:
            raw_message = json.loads(message)
            
            if 'data' not in raw_message:
                return 
                
            data = raw_message['data']
            symbol = data['s'].upper()

            clean_record = {
                "symbol": symbol,
                "trade_id": data['t'],
                "timestamp": data['T'],
                "price": float(data['p']),
                "volume": float(data['q']),
                "is_buyer_maker": data['m']
            }

            if clean_record['price'] <= 0 or clean_record['volume'] <= 0:
                logger.warning(f"Dropped invalid trade record for {symbol}: {clean_record}")
                return

            self._send_to_kafka(clean_record)
            action = "SELL" if clean_record["is_buyer_maker"] else "BUY"
            logger.debug(
                f"[{symbol}] {action} | Price: {clean_record['price']:,.2f} | Volume: {clean_record['volume']:,.4f}"
            )

        except ValueError as e:
            logger.warning(f"Invalid Binance payload: {e}", exc_info=True)
        except Exception as e:
            logger.error(f"Error processing Binance message: {e}", exc_info=True)

    def on_open(self, ws):
        """Handle WebSocket connection opened event.
        
        Args:
            ws: WebSocket connection object.
        """
        self.reconnect_attempt = 0  # Reset reconnection counter on successful connection
        logger.info(f"Connected to Binance Combined WebSocket! Streaming to {config.TOPIC_RAW_TRADES}")

    def on_close(self, ws, close_status_code, close_msg):
        """Handle WebSocket connection closed event.
        
        Args:
            ws: WebSocket connection object.
            close_status_code: WebSocket close status code.
            close_msg: WebSocket close message.
        """
        logger.info("Disconnected from Binance. Closing producer...")

    def on_error(self, ws, error):
        """Handle WebSocket error event.
        
        Args:
            ws: WebSocket connection object.
            error: Error object or message.
        """
        error_message = str(error).lower()
        error_type = type(error).__name__

        network_errors = [
            "connection to remote host was lost",
            "connection reset by peer",
            "timed out",
            "broken pipe",
            "network is unreachable",
            "temporary failure in name resolution",
            "errno -3"
        ]

        if isinstance(error, websocket.WebSocketConnectionClosedException) or \
            any(net_err in error_message for net_err in network_errors):
            logger.warning(f"Binance WebSocket dropped ({error_type}): {error}")
        else:
            logger.error(f"WebSocket error ({error_type}): {error}", exc_info=True)

    def run(self):
        """Start the WebSocket connection and run the producer loop."""
        while self.is_running:
            try:
                self.ws = websocket.WebSocketApp(
                    self.ws_url,
                    on_open=self.on_open,
                    on_message=self.on_message,
                    on_error=self.on_error,
                    on_close=self.on_close
                )
                logger.info(f"Connecting to {self.ws_url} ...")
                self.ws.run_forever(
                    ping_interval=60,
                    ping_timeout=30,
                )
                
                if self.is_running:
                    self._handle_reconnect("WebSocket connection closed unexpectedly")
            except Exception as e:
                logger.error(f"Fatal error in producer: {e}", exc_info=True)
                if self.is_running:
                    self._handle_reconnect(f"Exception during connection: {str(e)}")

        self.shutdown()

    def _handle_reconnect(self, reason: str):
        """Handle reconnection with exponential backoff.
        
        Args:
            reason: Reason for reconnection attempt.
        """
        self.reconnect_attempt += 1
        if self.reconnect_attempt > self.max_reconnect_attempts:
            logger.error(f"Max reconnection attempts ({self.max_reconnect_attempts}) reached. Giving up.")
            self.is_running = False
            return
        
        # Exponential backoff: 5s, 10s, 20s, 40s, ... (max 5 minutes)
        delay = min(self.base_reconnect_delay * (2 ** (self.reconnect_attempt - 1)), 300)
        logger.warning(f"{reason}. Reconnecting in {delay:.1f}s... (attempt {self.reconnect_attempt}/{self.max_reconnect_attempts})")
        time.sleep(delay)

    def shutdown(self):
        """Gracefully shutdown the producer and close all connections."""
        logger.info("Shutting down Binance WebSocket producer...")
        self.is_running = False
        if self.ws:
            self.ws.close()
        try:
            self.producer.flush(timeout=10)
        except Exception as exc:
            logger.warning(f"Failed to flush Kafka producer: {exc}", exc_info=True)
        finally:
            self.producer.close()
            logger.info("Producer shut down successfully.")


if __name__ == "__main__":
    symbols_to_track = config.TRADING_SYMBOLS 
    
    app = BinanceCombinedProducer(symbols_to_track)
    
    def signal_handler(sig, frame):
        logger.info(f"Received signal {sig}. Initiating graceful shutdown...")
        app.shutdown()
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    try:
        app.run()
    except Exception as e:
        logger.error(f"Fatal error in main: {e}", exc_info=True)
        app.shutdown()
        sys.exit(1)