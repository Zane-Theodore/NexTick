import json
import signal
import sys
import time

import websocket
from kafka import KafkaProducer
from kafka.errors import KafkaError, NoBrokersAvailable

from data_pipeline.common import config
from data_pipeline.common.logger import get_logger

logger = get_logger(__name__)


def retry_with_backoff(operation, max_retries=60, base_delay=1.0, max_delay=10.0, operation_name="operation"):
    """Execute an operation with exponential backoff retry logic."""

    attempt = 0
    while attempt < max_retries:
        try:
            return operation()
        except NoBrokersAvailable:
            attempt += 1
            delay = min(base_delay * (2 ** (attempt - 1)), max_delay)
            logger.warning(
                f"{operation_name} failed (Kafka not ready). "
                f"Retrying in {delay:.1f}s... ({attempt}/{max_retries})"
            )
            time.sleep(delay)
        except Exception as error:
            attempt += 1
            if attempt >= max_retries:
                logger.error(f"{operation_name} failed after {attempt} attempts.", exc_info=True)
                raise
            delay = min(base_delay * (2 ** (attempt - 1)), max_delay)
            logger.warning(
                f"{operation_name} failed on attempt {attempt}: {error}. "
                f"Retrying in {delay:.1f}s..."
            )
            time.sleep(delay)


class BinanceCombinedKlineProducer:
    """Binance WebSocket producer for authoritative kline streams.

    The producer subscribes to Binance combined kline streams for every
    configured symbol and interval, normalizes the payload, and publishes it to
    Kafka. Downstream code no longer reconstructs candles from trade-level events.
    """

    def __init__(self, symbols: list[str], intervals: list[str]):
        self.symbols = [symbol.lower() for symbol in symbols if symbol]
        self.intervals = [interval for interval in intervals if interval]
        self.ws = None
        self.is_running = True
        self.reconnect_attempt = 0
        self.max_reconnect_attempts = 10
        self.base_reconnect_delay = 5

        if not self.symbols:
            raise ValueError("At least one trading symbol is required")
        if not self.intervals:
            raise ValueError("At least one candle interval is required")

        streams = "/".join(
            f"{symbol}@kline_{interval}"
            for symbol in self.symbols
            for interval in self.intervals
        )
        binance_socket_url = config.BINANCE_SOCKET_URL.rstrip("/")
        query_separator = "&" if "?" in binance_socket_url else "?"
        self.ws_url = f"{binance_socket_url}{query_separator}streams={streams}"

        logger.info(
            "Initializing Binance kline producer for "
            f"symbols={', '.join(symbol.upper() for symbol in self.symbols)}, "
            f"intervals={self.intervals}"
        )

        def _create_producer():
            return KafkaProducer(
                bootstrap_servers=[config.KAFKA_SERVER],
                api_version=(3, 4, 0),
                value_serializer=lambda value: json.dumps(value).encode("utf-8"),
                acks="all",
                retries=5,
                linger_ms=5,
                request_timeout_ms=30000,
                max_block_ms=10000,
            )

        self.producer = retry_with_backoff(_create_producer, operation_name="Kafka producer creation")
        logger.info("Kafka producer initialized successfully.")

    def _normalize_kline_record(self, raw_message: dict) -> dict | None:
        data = raw_message.get("data", raw_message)
        kline = data.get("k") if isinstance(data, dict) else None

        if not isinstance(kline, dict):
            return None

        try:
            symbol = str(kline.get("s") or data.get("s")).upper()
            interval = str(kline["i"])
            record = {
                "symbol": symbol,
                "interval": interval,
                "timestamp": int(kline["t"]),
                "close_time": int(kline["T"]),
                "event_time": int(data.get("E", kline["T"])),
                "open": float(kline["o"]),
                "high": float(kline["h"]),
                "low": float(kline["l"]),
                "close": float(kline["c"]),
                "volume": float(kline["v"]),
                "is_final": bool(kline["x"]),
            }
        except (KeyError, TypeError, ValueError) as exc:
            logger.warning(f"Invalid Binance kline payload: {exc}", exc_info=True)
            return None

        if (
            not record["symbol"]
            or record["interval"] not in self.intervals
            or record["timestamp"] <= 0
            or record["open"] <= 0
            or record["high"] <= 0
            or record["low"] <= 0
            or record["close"] <= 0
            or record["volume"] < 0
            or record["high"] < max(record["open"], record["close"])
            or record["low"] > min(record["open"], record["close"])
            or record["high"] < record["low"]
        ):
            logger.warning(f"Dropped invalid Binance kline record: {record}")
            return None

        return record

    def _send_to_kafka(self, record: dict):
        def _send():
            logger.debug(
                f"Producer publishing kline: symbol={record['symbol']}, "
                f"interval={record['interval']}, open_time={record['timestamp']}, "
                f"is_final={record['is_final']}, topic={config.KAFKA_TOPIC_MARKET_KLINES}"
            )
            future = self.producer.send(
                config.KAFKA_TOPIC_MARKET_KLINES,
                value=record,
                key=f"{record['symbol']}_{record['interval']}".encode("utf-8"),
            )
            return future.get(timeout=15)

        try:
            metadata = retry_with_backoff(
                _send,
                max_retries=4,
                base_delay=0.5,
                operation_name="Kafka kline publish",
            )
            self._on_kafka_send_success(metadata, record)
        except KafkaError:
            logger.error(f"Kafka publish failed immediately for {record['symbol']}.", exc_info=True)
        except Exception:
            logger.error(f"Unexpected Kafka publish failure for {record['symbol']}.", exc_info=True)

    def _on_kafka_send_success(self, metadata, record: dict):
        logger.debug(
            f"Published {record['symbol']} {record['interval']} kline "
            f"to {metadata.topic}[{metadata.partition}]@{metadata.offset}"
        )

    def _on_kafka_send_error(self, exc, record: dict):
        logger.error(
            f"Kafka async publish failed for {record['symbol']} {record['interval']} "
            f"kline at {record['timestamp']}: {exc}",
            exc_info=True,
        )

    def on_message(self, ws, message):
        try:
            raw_message = json.loads(message)
            record = self._normalize_kline_record(raw_message)

            if not record:
                return

            self._send_to_kafka(record)
            logger.debug(
                f"[{record['symbol']} {record['interval']}] "
                f"close={record['close']:,.8f} volume={record['volume']:,.8f} "
                f"is_final={record['is_final']}"
            )
        except ValueError as exc:
            logger.warning(f"Invalid Binance payload: {exc}", exc_info=True)
        except Exception as exc:
            logger.error(f"Error processing Binance kline message: {exc}", exc_info=True)

    def on_open(self, ws):
        self.reconnect_attempt = 0
        logger.info(f"Connected to Binance combined kline stream. Topic={config.KAFKA_TOPIC_MARKET_KLINES}")

    def on_close(self, ws, close_status_code, close_msg):
        logger.info("Disconnected from Binance kline stream.")

    def on_error(self, ws, error):
        error_message = str(error).lower()
        error_type = type(error).__name__

        network_errors = [
            "connection to remote host was lost",
            "connection reset by peer",
            "timed out",
            "broken pipe",
            "network is unreachable",
            "temporary failure in name resolution",
            "errno -3",
        ]

        if isinstance(error, websocket.WebSocketConnectionClosedException) or any(
            network_error in error_message for network_error in network_errors
        ):
            logger.warning(f"Binance WebSocket dropped ({error_type}): {error}")
        else:
            logger.error(f"WebSocket error ({error_type}): {error}", exc_info=True)

    def run(self):
        logger.info(
            "Producer starting Binance kline streams for "
            f"{len(self.symbols)} symbol(s) x {len(self.intervals)} interval(s)"
        )
        while self.is_running:
            try:
                self.ws = websocket.WebSocketApp(
                    self.ws_url,
                    on_open=self.on_open,
                    on_message=self.on_message,
                    on_error=self.on_error,
                    on_close=self.on_close,
                )
                logger.info(f"Connecting to {self.ws_url} ...")
                self.ws.run_forever(
                    ping_interval=60,
                    ping_timeout=30,
                )

                if self.is_running:
                    self._handle_reconnect("WebSocket connection closed unexpectedly")
            except Exception as exc:
                logger.error(f"Fatal error in producer: {exc}", exc_info=True)
                if self.is_running:
                    self._handle_reconnect(f"Exception during connection: {exc}")

        self.shutdown()

    def _handle_reconnect(self, reason: str):
        self.reconnect_attempt += 1
        if self.reconnect_attempt > self.max_reconnect_attempts:
            logger.error(f"Max reconnection attempts ({self.max_reconnect_attempts}) reached. Giving up.")
            self.is_running = False
            return

        delay = min(self.base_reconnect_delay * (2 ** (self.reconnect_attempt - 1)), 300)
        logger.warning(
            f"{reason}. Reconnecting in {delay:.1f}s... "
            f"(attempt {self.reconnect_attempt}/{self.max_reconnect_attempts})"
        )
        time.sleep(delay)

    def shutdown(self):
        logger.info("Shutting down Binance kline producer...")
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
    app = BinanceCombinedKlineProducer(config.TRADING_SYMBOLS, config.CANDLE_INTERVALS)

    def signal_handler(sig, frame):
        logger.info(f"Received signal {sig}. Initiating graceful shutdown...")
        app.shutdown()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    try:
        app.run()
    except Exception as exc:
        logger.error(f"Fatal error in main: {exc}", exc_info=True)
        app.shutdown()
        sys.exit(1)
