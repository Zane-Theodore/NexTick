"""Publish normalized Binance trades and partial market depth to Kafka."""

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
from data_pipeline.producer.depth_normalization import normalize_binance_depth_record
from data_pipeline.producer.trade_normalization import normalize_binance_trade_record

logger = get_logger(__name__)

class BinanceCombinedTradeProducer:
    """Publish normalized Binance raw trades and partial market depth."""

    def __init__(self, symbols: list[str]):
        self.symbols = [symbol.lower() for symbol in symbols if symbol]
        self.ws = None
        self.is_running = True
        self.reconnect_attempt = 0
        self.max_reconnect_attempts = 10
        self.base_reconnect_delay = 5

        if not self.symbols:
            raise ValueError("At least one trading symbol is required")

        streams = "/".join(
            stream
            for symbol in self.symbols
            for stream in (f"{symbol}@trade", f"{symbol}@depth20@100ms")
        )
        socket_url = config.BINANCE_SOCKET_URL.rstrip("/")
        query_separator = "&" if "?" in socket_url else "?"
        self.ws_url = f"{socket_url}{query_separator}streams={streams}"

        logger.info(
            "Initializing Binance market-data producer for "
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
        return normalize_binance_trade_record(raw_message, self.symbols)

    def _normalize_depth_record(self, raw_message: dict) -> dict | None:
        return normalize_binance_depth_record(raw_message, self.symbols)

    def _send_to_kafka(
        self,
        record: dict,
        topic: str,
        record_kind: str,
        record_id: int,
    ) -> None:
        def _send():
            return self.producer.send(
                topic,
                value=record,
                key=record["symbol"].encode("utf-8"),
            )

        try:
            future = retry_with_backoff(
                _send,
                max_retries=4,
                base_delay=0.5,
                operation_name=f"Kafka {record_kind} publish",
            )
            future.add_errback(
                lambda error: logger.error(
                    f"Kafka delivery failed for {record_kind} "
                    f"{record['symbol']}#{record_id}: {error}"
                )
            )
        except KafkaError:
            logger.error(f"Kafka publish failed immediately for {record['symbol']}.", exc_info=True)
        except Exception:
            logger.error(f"Unexpected Kafka publish failure for {record['symbol']}.", exc_info=True)

    def on_message(self, ws, message) -> None:
        try:
            raw_message = json.loads(message)
            trade_record = self._normalize_trade_record(raw_message)
            if trade_record is not None:
                self._send_to_kafka(
                    trade_record,
                    config.KAFKA_TOPIC_MARKET_TRADES,
                    "raw trade",
                    trade_record["trade_id"],
                )
                return

            depth_record = self._normalize_depth_record(raw_message)
            if depth_record is not None:
                self._send_to_kafka(
                    depth_record,
                    config.KAFKA_TOPIC_MARKET_DEPTH,
                    "market depth",
                    depth_record["last_update_id"],
                )
        except (TypeError, ValueError) as exc:
            logger.warning(f"Invalid Binance market-data message: {exc}")
        except Exception:
            logger.error("Error processing Binance market-data message", exc_info=True)

    def on_open(self, ws) -> None:
        self.reconnect_attempt = 0
        logger.info(
            "Connected to Binance combined market-data stream. "
            f"Topics={config.KAFKA_TOPIC_MARKET_TRADES},{config.KAFKA_TOPIC_MARKET_DEPTH}"
        )

    @staticmethod
    def on_close(ws, close_status_code, close_msg) -> None:
        logger.info("Disconnected from Binance market-data stream.")

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
        logger.info(
            f"Producer starting Binance trade/depth streams for {len(self.symbols)} symbol(s)"
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
        logger.info("Shutting down Binance market-data producer...")
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
