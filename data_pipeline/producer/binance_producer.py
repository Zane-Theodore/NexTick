"""Publish Binance raw trade events to Kafka."""

import json
import signal
import sys
import time

import websocket
from kafka import KafkaProducer
from kafka.errors import KafkaError

from data_pipeline.common import config
from data_pipeline.common.logger import get_logger
from data_pipeline.common.retry import retry_with_backoff

logger = get_logger(__name__)

class BinanceCombinedTradeProducer:
    """Subscribe to Binance ``@trade`` streams and publish normalized raw trades."""

    def __init__(self, symbols: list[str]):
        self.symbols = [symbol.lower() for symbol in symbols if symbol]
        self.ws = None
        self.is_running = True
        self.reconnect_attempt = 0
        self.max_reconnect_attempts = 10
        self.base_reconnect_delay = 5

        if not self.symbols:
            raise ValueError("At least one trading symbol is required")

        streams = "/".join(f"{symbol}@trade" for symbol in self.symbols)
        socket_url = config.BINANCE_SOCKET_URL.rstrip("/")
        query_separator = "&" if "?" in socket_url else "?"
        self.ws_url = f"{socket_url}{query_separator}streams={streams}"

        logger.info(
            "Initializing Binance raw trade producer for "
            f"symbols={', '.join(symbol.upper() for symbol in self.symbols)}"
        )

        self.producer = retry_with_backoff(
            lambda: KafkaProducer(
                bootstrap_servers=[config.KAFKA_SERVER],
                api_version=(3, 4, 0),
                value_serializer=lambda value: json.dumps(value).encode("utf-8"),
                acks="all",
                retries=5,
                linger_ms=5,
                request_timeout_ms=30000,
                max_block_ms=10000,
            ),
            operation_name="Kafka producer creation",
        )

    def _normalize_trade_record(self, raw_message: dict) -> dict | None:
        data = raw_message.get("data", raw_message)
        if not isinstance(data, dict) or data.get("e") != "trade":
            return None

        try:
            record = {
                "symbol": str(data["s"]).upper(),
                "trade_id": int(data["t"]),
                "timestamp": int(data["T"]),
                "event_time": int(data["E"]),
                "price": float(data["p"]),
                "quantity": float(data["q"]),
            }
        except (KeyError, TypeError, ValueError) as exc:
            logger.warning(f"Invalid Binance trade payload: {exc}")
            return None

        if (
            not record["symbol"]
            or record["symbol"].lower() not in self.symbols
            or record["trade_id"] < 0
            or record["timestamp"] <= 0
            or record["price"] <= 0
            or record["quantity"] <= 0
        ):
            logger.warning(f"Dropped invalid Binance trade record: {record}")
            return None

        return record

    def _send_to_kafka(self, record: dict) -> None:
        def _send():
            return self.producer.send(
                config.KAFKA_TOPIC_MARKET_TRADES,
                value=record,
                key=record["symbol"].encode("utf-8"),
            )

        try:
            future = retry_with_backoff(
                _send,
                max_retries=4,
                base_delay=0.5,
                operation_name="Kafka raw trade publish",
            )
            future.add_errback(
                lambda error: logger.error(
                    f"Kafka delivery failed for raw trade {record['symbol']}#{record['trade_id']}: {error}"
                )
            )
        except KafkaError:
            logger.error(f"Kafka publish failed immediately for {record['symbol']}.", exc_info=True)
        except Exception:
            logger.error(f"Unexpected Kafka publish failure for {record['symbol']}.", exc_info=True)

    def on_message(self, ws, message) -> None:
        try:
            record = self._normalize_trade_record(json.loads(message))
            if record is not None:
                self._send_to_kafka(record)
        except (TypeError, ValueError) as exc:
            logger.warning(f"Invalid Binance trade message: {exc}")
        except Exception:
            logger.error("Error processing Binance trade message", exc_info=True)

    def on_open(self, ws) -> None:
        self.reconnect_attempt = 0
        logger.info(f"Connected to Binance combined raw trade stream. Topic={config.KAFKA_TOPIC_MARKET_TRADES}")

    @staticmethod
    def on_close(ws, close_status_code, close_msg) -> None:
        logger.info("Disconnected from Binance raw trade stream.")

    def on_error(self, ws, error) -> None:
        message = str(error).lower()
        network_errors = (
            "connection to remote host was lost",
            "connection reset by peer",
            "timed out",
            "broken pipe",
            "network is unreachable",
            "temporary failure in name resolution",
            "errno -3",
        )
        if isinstance(error, websocket.WebSocketConnectionClosedException) or any(item in message for item in network_errors):
            logger.warning(f"Binance WebSocket dropped ({type(error).__name__}): {error}")
            return
        logger.error(f"WebSocket error ({type(error).__name__}): {error}", exc_info=True)

    def run(self) -> None:
        logger.info(f"Producer starting Binance raw trade streams for {len(self.symbols)} symbol(s)")
        while self.is_running:
            try:
                self.ws = websocket.WebSocketApp(
                    self.ws_url,
                    on_open=self.on_open,
                    on_message=self.on_message,
                    on_error=self.on_error,
                    on_close=self.on_close,
                )
                self.ws.run_forever(ping_interval=60, ping_timeout=30)
                if self.is_running:
                    self._handle_reconnect("WebSocket connection closed unexpectedly")
            except Exception:
                logger.error("Fatal error in producer", exc_info=True)
                if self.is_running:
                    self._handle_reconnect("Exception during connection")
        self.shutdown()

    def _handle_reconnect(self, reason: str) -> None:
        self.reconnect_attempt += 1
        if self.reconnect_attempt > self.max_reconnect_attempts:
            logger.error(f"Max reconnection attempts ({self.max_reconnect_attempts}) reached. Giving up.")
            self.is_running = False
            return
        delay = min(self.base_reconnect_delay * (2 ** (self.reconnect_attempt - 1)), 300)
        logger.warning(f"{reason}. Reconnecting in {delay:.1f}s... ({self.reconnect_attempt}/{self.max_reconnect_attempts})")
        time.sleep(delay)

    def shutdown(self) -> None:
        if not self.is_running and self.ws is None:
            return
        logger.info("Shutting down Binance raw trade producer...")
        self.is_running = False
        if self.ws:
            self.ws.close()
        try:
            self.producer.flush(timeout=10)
        except Exception:
            logger.warning("Failed to flush Kafka producer", exc_info=True)
        finally:
            self.producer.close()
            self.ws = None


if __name__ == "__main__":
    app = BinanceCombinedTradeProducer(config.TRADING_SYMBOLS)

    def signal_handler(sig, frame):
        logger.info(f"Received signal {sig}. Initiating graceful shutdown...")
        app.shutdown()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    try:
        app.run()
    except Exception:
        logger.error("Fatal error in main", exc_info=True)
        app.shutdown()
        sys.exit(1)
