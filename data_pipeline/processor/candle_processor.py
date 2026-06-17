import json
import signal
import sys
import time
from datetime import datetime, timezone

import psycopg2
from kafka import KafkaConsumer, KafkaProducer
from kafka.errors import NoBrokersAvailable

from data_pipeline.backfill.state import read_backfill_end
from data_pipeline.common import config
from data_pipeline.common.logger import get_logger

logger = get_logger(__name__)


def retry_with_backoff(
    operation,
    max_retries=60,
    base_delay=1.0,
    max_delay=10.0,
    operation_name="operation",
):
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


class CandleProcessor:
    """Processes Binance kline streams and persists final 1m candles.

    The processor no longer aggregates trade-level events in memory. Binance kline
    events are treated as the realtime source for final and non-final candle
    updates, while REST backfill/reconcile remains the authoritative repair
    path for closed historical candles.
    """

    def __init__(self):
        self.table_name = "market_candles"
        self.backfill_write_fence = read_backfill_end()
        if self.backfill_write_fence is not None:
            logger.info(
                "Processor DB write fence is active for startup-backfilled candles: "
                f"skip final 1m upserts before {self.backfill_write_fence.isoformat()}"
            )

        logger.info("Starting Binance kline processor with synchronous QuestDB writes")

        try:
            self.db_conn = psycopg2.connect(
                host=config.QUESTDB_HOST,
                port=config.QUESTDB_PORT,
                database=config.QUESTDB_DATABASE,
                user=config.QUESTDB_USER,
                password=config.QUESTDB_PASSWORD,
            )
            self.db_conn.autocommit = True
            self.db_cursor = self.db_conn.cursor()
            logger.info("Connected to QuestDB via PostgreSQL wire protocol.")

            self.db_cursor.execute(
                f"""
                CREATE TABLE IF NOT EXISTS {self.table_name} (
                    symbol SYMBOL,
                    interval SYMBOL,
                    timestamp TIMESTAMP,
                    open DOUBLE,
                    high DOUBLE,
                    low DOUBLE,
                    close DOUBLE,
                    volume DOUBLE
                ) TIMESTAMP(timestamp)
                PARTITION BY MONTH
                DEDUP UPSERT KEYS(timestamp, symbol, interval);
                """
            )
            self._ensure_dedup_enabled()
            logger.info(
                f"Verified/Created table {self.table_name} with WAL dedup upsert keys "
                "(timestamp, symbol, interval)."
            )
        except Exception as exc:
            logger.error(f"Failed to connect to QuestDB: {exc}", exc_info=True)
            raise

        def _create_consumer():
            return KafkaConsumer(
                config.KAFKA_TOPIC_MARKET_KLINES,
                bootstrap_servers=[config.KAFKA_SERVER],
                api_version=(3, 4, 0),
                auto_offset_reset=config.KAFKA_AUTO_OFFSET_RESET,
                enable_auto_commit=False,
                consumer_timeout_ms=1000,
                value_deserializer=lambda value: json.loads(value.decode("utf-8")),
                group_id=config.KAFKA_CONSUMER_GROUP_ID,
            )

        self.consumer = retry_with_backoff(
            _create_consumer,
            operation_name="Kafka consumer creation",
        )
        logger.info(
            f"Kafka kline input consumer initialized: topic={config.KAFKA_TOPIC_MARKET_KLINES}, "
            f"groupId={config.KAFKA_CONSUMER_GROUP_ID}, "
            f"autoOffsetReset={config.KAFKA_AUTO_OFFSET_RESET}"
        )

        def _create_producer():
            return KafkaProducer(
                bootstrap_servers=[config.KAFKA_SERVER],
                api_version=(3, 4, 0),
                value_serializer=lambda value: json.dumps(value).encode("utf-8"),
                retries=5,
                linger_ms=5,
                request_timeout_ms=30000,
            )

        self.producer = retry_with_backoff(
            _create_producer,
            operation_name="Kafka producer creation",
        )
        self.running = True

    def _ensure_dedup_enabled(self) -> None:
        """Enable QuestDB deduplication when the table is WAL-capable."""

        try:
            self.db_cursor.execute(
                f"ALTER TABLE {self.table_name} "
                "DEDUP ENABLE UPSERT KEYS(timestamp, symbol, interval)"
            )
        except Exception as exc:
            logger.error(
                f"{self.table_name} does not accept DEDUP UPSERT KEYS"
                "(timestamp, symbol, interval). "
                "If this is an existing BYPASS WAL table, migrate it to a "
                "WAL table before running the live processor to prevent "
                "duplicate candles.",
                exc_info=True,
            )
            raise exc

    def _is_valid_candle(self, candle: dict) -> bool:
        try:
            open_price = float(candle["open"])
            high = float(candle["high"])
            low = float(candle["low"])
            close = float(candle["close"])
            volume = float(candle["volume"])
        except (KeyError, TypeError, ValueError):
            return False

        return (
            open_price > 0
            and high > 0
            and low > 0
            and close > 0
            and volume >= 0
            and high >= max(open_price, close)
            and low <= min(open_price, close)
            and high >= low
        )

    def _is_before_backfill_fence(self, candle: dict) -> bool:
        timestamp = candle.get("timestamp")
        return (
            self.backfill_write_fence is not None
            and isinstance(timestamp, datetime)
            and timestamp < self.backfill_write_fence
        )

    def _commit_consumer_offset(self, reason: str) -> bool:
        try:
            self.consumer.commit()
            return True
        except Exception:
            logger.warning(f"Failed to commit Kafka offset after {reason}.", exc_info=True)
            return False

    def _parse_timestamp(self, value) -> datetime | None:
        try:
            if isinstance(value, (int, float)):
                return datetime.fromtimestamp(float(value) / 1000.0, tz=timezone.utc)

            text = str(value).strip()
            if not text:
                return None
            if text.isdigit():
                return datetime.fromtimestamp(int(text) / 1000.0, tz=timezone.utc)

            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        except (TypeError, ValueError, OSError):
            return None

    def normalize_kline(self, raw_kline: dict) -> dict | None:
        timestamp = self._parse_timestamp(raw_kline.get("timestamp"))

        if timestamp is None or timestamp.year < 2020:
            return None

        try:
            candle = {
                "symbol": str(raw_kline.get("symbol") or "").upper(),
                "interval": str(raw_kline.get("interval") or ""),
                "timestamp": timestamp,
                "open": float(raw_kline.get("open")),
                "high": float(raw_kline.get("high")),
                "low": float(raw_kline.get("low")),
                "close": float(raw_kline.get("close")),
                "volume": float(raw_kline.get("volume")),
                "is_final": raw_kline.get("is_final") is True,
            }
        except (TypeError, ValueError):
            return None

        if (
            not candle["symbol"]
            or candle["interval"] not in config.CANDLE_INTERVALS
            or not self._is_valid_candle(candle)
        ):
            return None

        return candle

    def save_to_db(self, candle: dict) -> bool:
        """Upsert a final 1m candle to QuestDB."""

        if not self._is_valid_candle(candle):
            logger.error(
                f"Refusing to upsert invalid candle: symbol={candle.get('symbol')}, "
                f"interval={candle.get('interval')}, open_time={candle.get('timestamp')}, "
                f"open={candle.get('open')}, high={candle.get('high')}, "
                f"low={candle.get('low')}, close={candle.get('close')}, "
                f"volume={candle.get('volume')}"
            )
            return False

        def _upsert():
            db_timestamp_str = candle["timestamp"].strftime("%Y-%m-%d %H:%M:%S")
            self.db_cursor.execute(
                f"""
                INSERT INTO {self.table_name} (
                    symbol,
                    interval,
                    timestamp,
                    open,
                    high,
                    low,
                    close,
                    volume
                )
                VALUES (%s, %s, to_timestamp(%s, 'yyyy-MM-dd HH:mm:ss'), %s, %s, %s, %s, %s)
                """,
                (
                    candle["symbol"],
                    candle["interval"],
                    db_timestamp_str,
                    candle["open"],
                    candle["high"],
                    candle["low"],
                    candle["close"],
                    candle["volume"],
                ),
            )

        try:
            retry_with_backoff(_upsert, max_retries=3, operation_name="QuestDB candle upsert")
            logger.info(
                f"Upserted candle: symbol={candle['symbol']}, interval={candle['interval']}, "
                f"open_time={candle['timestamp'].isoformat()}, source=BINANCE_KLINE"
            )
            return True
        except Exception:
            logger.error(
                f"Failed to upsert candle after retries: symbol={candle.get('symbol')}, "
                f"interval={candle.get('interval')}, open_time={candle.get('timestamp')}",
                exc_info=True,
            )
            return False

    def _send_to_topic(self, topic: str, value: dict):
        def _send():
            future = self.producer.send(
                topic,
                value=value,
                key=f"{value['symbol']}_{value['interval']}".encode("utf-8"),
            )
            return future.get(timeout=15)

        retry_with_backoff(
            _send,
            max_retries=4,
            base_delay=0.5,
            operation_name=f"Kafka publish to {topic}",
        )

    def broadcast_candle(self, candle: dict) -> bool:
        """Publish a normalized kline to the backend-facing stream topic."""

        kafka_candle = {
            "symbol": candle["symbol"],
            "interval": candle["interval"],
            "timestamp": candle["timestamp"].isoformat(),
            "open": candle["open"],
            "high": candle["high"],
            "low": candle["low"],
            "close": candle["close"],
            "volume": candle["volume"],
            "is_final": candle["is_final"],
        }

        try:
            self._send_to_topic(config.TOPIC_KLINE_STREAM, kafka_candle)
            return True
        except Exception:
            logger.error(
                f"Failed to publish candle update for {candle['symbol']} "
                f"{candle['interval']} to Kafka.",
                exc_info=True,
            )
            return False

    def process_kline(self, raw_kline: dict) -> bool:
        candle = self.normalize_kline(raw_kline)

        if not candle:
            logger.debug(f"Skipped invalid kline input: {raw_kline}")
            self._commit_consumer_offset("skipping invalid kline input")
            return True

        if candle["is_final"] and self._is_before_backfill_fence(candle):
            logger.info(
                "Skipping final candle before startup backfill watermark: "
                f"symbol={candle['symbol']}, interval={candle['interval']}, "
                f"open_time={candle['timestamp'].isoformat()}, "
                f"backfill_end={self.backfill_write_fence.isoformat()}"
            )
            self._commit_consumer_offset("skipping startup-backfilled final candle")
            return True

        if candle["is_final"] and candle["interval"] == "1m":
            if not self.save_to_db(candle):
                logger.warning(
                    f"Skipping final candle publish for {candle['symbol']} "
                    "because DB persistence failed."
                )
                return False

        if not self.broadcast_candle(candle):
            return False

        self._commit_consumer_offset("processing kline input")
        return True

    def run(self):
        """Start processing Binance kline records."""

        logger.info(
            f"Processor started; consuming Kafka topic={config.KAFKA_TOPIC_MARKET_KLINES}, "
            f"groupId={config.KAFKA_CONSUMER_GROUP_ID}"
        )
        try:
            while self.running:
                raw_messages = self.consumer.poll(timeout_ms=1000)

                for topic_partition, messages in raw_messages.items():
                    for message in messages:
                        try:
                            logger.debug(
                                f"Processor consumed Kafka message: topic={message.topic}, "
                                f"partition={message.partition}, offset={message.offset}"
                            )
                            self.process_kline(message.value)
                        except Exception as exc:
                            logger.error(
                                f"Error processing kline from Kafka "
                                f"topic={message.topic}, partition={message.partition}, "
                                f"offset={message.offset}: {exc}",
                                exc_info=True,
                            )
        except KeyboardInterrupt:
            logger.info("Shutdown signal received")
        except Exception as exc:
            logger.error(f"Unexpected error in processor: {exc}", exc_info=True)
        finally:
            self.shutdown()

    def shutdown(self):
        """Gracefully shutdown the processor and close all connections."""

        self.running = False

        try:
            self.consumer.close()
        except Exception as exc:
            logger.warning(f"Failed to close Kafka consumer cleanly: {exc}", exc_info=True)

        try:
            self.producer.flush(timeout=10)
            self.producer.close()
        except Exception as exc:
            logger.warning(f"Failed to flush/close Kafka producer cleanly: {exc}", exc_info=True)

        try:
            if hasattr(self, "db_cursor"):
                self.db_cursor.close()
            if hasattr(self, "db_conn"):
                self.db_conn.close()
        except Exception as exc:
            logger.warning(f"Failed to close QuestDB connection cleanly: {exc}", exc_info=True)

        logger.info("Processor shut down successfully")


if __name__ == "__main__":
    app = CandleProcessor()

    def _handle_signal(sig, frame):
        logger.info(f"Received signal {sig}. Initiating graceful shutdown...")
        app.shutdown()
        sys.exit(0)

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    app.run()
