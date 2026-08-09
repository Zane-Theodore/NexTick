"""Aggregate Binance raw trades into realtime candles and persist closed 1m bars."""

import json
import math
import time
from datetime import datetime, timezone

import psycopg2
from kafka import KafkaConsumer, KafkaProducer

from data_pipeline.backfill.state import read_backfill_cutover
from data_pipeline.common import config
from data_pipeline.common.logger import get_logger
from data_pipeline.common.retry import retry_with_backoff
from data_pipeline.processor.candle_aggregator import CandleAggregator
from data_pipeline.processor.state import read_processor_state, write_processor_state

logger = get_logger(__name__)
LIVE_BROADCAST_INTERVAL_SECONDS = 1.0
STATE_CHECKPOINT_INTERVAL_SECONDS = 1.0

class CandleProcessor:
    """Build configured candles from raw trades; store only closed one-minute bars."""

    def __init__(self):
        self.table_name = "market_candles"
        self.aggregator = CandleAggregator()
        self.pending_live_candles: dict[tuple[str, str, datetime], dict] = {}
        self.pending_candle_updates: dict[tuple[str, str, datetime], dict] = {}
        self.pending_db_candles: dict[tuple[str, datetime], dict] = {}
        self.has_uncommitted_messages = False
        self.last_live_broadcast = time.monotonic()
        self.last_state_checkpoint = time.monotonic()
        self.backfill_write_fence = read_backfill_cutover()
        self.running = True
        self._restore_state()

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
            self._create_candle_table()
        except Exception:
            logger.error("Failed to connect to QuestDB", exc_info=True)
            raise

        self.consumer = retry_with_backoff(
            lambda: KafkaConsumer(
                config.KAFKA_TOPIC_MARKET_TRADES,
                bootstrap_servers=[config.KAFKA_SERVER],
                api_version=(3, 4, 0),
                auto_offset_reset=config.KAFKA_AUTO_OFFSET_RESET,
                enable_auto_commit=False,
                consumer_timeout_ms=1000,
                value_deserializer=lambda value: json.loads(value.decode("utf-8")),
                group_id=config.KAFKA_CONSUMER_GROUP_ID,
            ),
            operation_name="Kafka consumer creation",
        )
        self.producer = retry_with_backoff(
            lambda: KafkaProducer(
                bootstrap_servers=[config.KAFKA_SERVER],
                api_version=(3, 4, 0),
                value_serializer=lambda value: json.dumps(value).encode("utf-8"),
                retries=5,
                linger_ms=5,
                request_timeout_ms=30000,
            ),
            operation_name="Kafka producer creation",
        )
        logger.info(
            f"Processor consuming raw trades from {config.KAFKA_TOPIC_MARKET_TRADES}; "
            f"publishing candles to {config.TOPIC_KLINE_STREAM}"
        )

    @staticmethod
    def _serialize_candle(candle: dict) -> dict:
        return {**candle, "timestamp": candle["timestamp"].isoformat()}

    @staticmethod
    def _deserialize_candle(raw_candle: dict) -> dict | None:
        try:
            candle = {
                "symbol": str(raw_candle["symbol"]).upper(),
                "interval": str(raw_candle["interval"]),
                "timestamp": datetime.fromisoformat(str(raw_candle["timestamp"]).replace("Z", "+00:00")).astimezone(timezone.utc),
                "open": float(raw_candle["open"]),
                "high": float(raw_candle["high"]),
                "low": float(raw_candle["low"]),
                "close": float(raw_candle["close"]),
                "volume": float(raw_candle["volume"]),
                "is_final": raw_candle["is_final"] is True,
            }
        except (KeyError, TypeError, ValueError):
            return None

        return candle if CandleProcessor._is_valid_candle(candle) else None

    def _restore_state(self) -> None:
        state = read_processor_state()
        if not state:
            return

        aggregator_state = state.get("aggregator") or {}
        if self.backfill_write_fence is not None:
            aggregator_state = self._discard_pre_cutover_aggregator_state(aggregator_state)
        self.aggregator.restore(aggregator_state)
        for raw_candle in state.get("pending_candle_updates") or []:
            candle = self._deserialize_candle(raw_candle)
            if candle is not None and not self._is_before_backfill_fence(candle):
                self._queue_candle_retry(candle, persist=False)
        for raw_candle in state.get("pending_db_candles") or []:
            candle = self._deserialize_candle(raw_candle)
            if (
                candle is not None
                and not self._is_before_backfill_fence(candle)
                and candle["is_final"]
                and candle["interval"] == "1m"
            ):
                self._queue_db_retry(candle, persist=False)

        logger.info("Restored active candle state from the previous processor run.")

    def _discard_pre_cutover_aggregator_state(self, state: dict) -> dict:
        """Keep restart recovery, but never revive a candle owned by backfill."""

        def is_at_or_after_cutover(raw_value) -> bool:
            try:
                timestamp = datetime.fromisoformat(str(raw_value).replace("Z", "+00:00"))
                timestamp = timestamp.astimezone(timezone.utc)
            except (TypeError, ValueError):
                return False
            return timestamp >= self.backfill_write_fence

        return {
            **state,
            "candles": [
                candle for candle in state.get("candles") or []
                if isinstance(candle, dict) and is_at_or_after_cutover(candle.get("timestamp"))
            ],
            "finalized_starts": [
                marker for marker in state.get("finalized_starts") or []
                if isinstance(marker, dict) and is_at_or_after_cutover(marker.get("timestamp"))
            ],
        }

    def _persist_state(self) -> None:
        write_processor_state(
            {
                "version": 1,
                "aggregator": self.aggregator.snapshot(),
                "pending_candle_updates": [
                    self._serialize_candle(candle)
                    for candle in self.pending_candle_updates.values()
                    if not self._is_before_backfill_fence(candle)
                ],
                "pending_db_candles": [
                    self._serialize_candle(candle)
                    for candle in self.pending_db_candles.values()
                    if not self._is_before_backfill_fence(candle)
                ],
            }
        )

    def _create_candle_table(self) -> None:
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
        try:
            self.db_cursor.execute(
                f"ALTER TABLE {self.table_name} "
                "DEDUP ENABLE UPSERT KEYS(timestamp, symbol, interval)"
            )
        except Exception:
            logger.error(
                f"{self.table_name} does not accept DEDUP UPSERT KEYS(timestamp, symbol, interval).",
                exc_info=True,
            )
            raise

    @staticmethod
    def _parse_timestamp(value) -> datetime | None:
        try:
            timestamp = datetime.fromtimestamp(float(value) / 1000.0, tz=timezone.utc)
            return timestamp if timestamp.year >= 2020 else None
        except (TypeError, ValueError, OSError):
            return None

    def normalize_trade(self, raw_trade: dict) -> dict | None:
        timestamp = self._parse_timestamp(raw_trade.get("timestamp"))
        if timestamp is None:
            return None

        try:
            trade = {
                "symbol": str(raw_trade.get("symbol") or "").upper(),
                "trade_id": int(raw_trade["trade_id"]),
                "timestamp": timestamp,
                "price": float(raw_trade["price"]),
                "quantity": float(raw_trade["quantity"]),
            }
        except (KeyError, TypeError, ValueError):
            return None

        if not trade["symbol"] or trade["trade_id"] < 0 or trade["price"] <= 0 or trade["quantity"] <= 0:
            return None

        return trade

    def _is_before_backfill_fence(self, candle: dict) -> bool:
        return self.backfill_write_fence is not None and candle["timestamp"] < self.backfill_write_fence

    def _commit_consumer_offset(self, reason: str) -> None:
        try:
            self.consumer.commit()
        except Exception:
            logger.warning(f"Failed to commit Kafka offset after {reason}.", exc_info=True)

    @staticmethod
    def _is_valid_candle(candle: dict) -> bool:
        try:
            open_price = float(candle["open"])
            high = float(candle["high"])
            low = float(candle["low"])
            close = float(candle["close"])
            volume = float(candle["volume"])
        except (KeyError, TypeError, ValueError):
            return False
        return (
            all(math.isfinite(value) for value in (open_price, high, low, close, volume))
            and open_price > 0 and high > 0 and low > 0 and close > 0
            and high >= max(open_price, close) and low <= min(open_price, close)
            and high >= low and volume >= 0
        )

    def save_to_db(self, candle: dict) -> bool:
        """Upsert one closed one-minute candle to QuestDB."""

        if self._is_before_backfill_fence(candle):
            return True
        if not self._is_valid_candle(candle):
            logger.error(f"Refusing to persist invalid candle: {candle}")
            return False

        def _upsert() -> None:
            self.db_cursor.execute(
                f"""
                INSERT INTO {self.table_name} (symbol, interval, timestamp, open, high, low, close, volume)
                VALUES (%s, %s, to_timestamp(%s, 'yyyy-MM-dd HH:mm:ss'), %s, %s, %s, %s, %s)
                """,
                (
                    candle["symbol"],
                    candle["interval"],
                    candle["timestamp"].strftime("%Y-%m-%d %H:%M:%S"),
                    candle["open"],
                    candle["high"],
                    candle["low"],
                    candle["close"],
                    candle["volume"],
                ),
            )

        try:
            retry_with_backoff(_upsert, max_retries=3, operation_name="QuestDB candle upsert")
            return True
        except Exception:
            logger.error(f"Failed to upsert candle: {candle['symbol']} {candle['timestamp'].isoformat()}", exc_info=True)
            return False

    def _queue_db_retry(self, candle: dict, *, persist: bool = True) -> None:
        if self._is_before_backfill_fence(candle):
            return
        self.pending_db_candles[(candle["symbol"], candle["timestamp"])] = candle
        if persist:
            self._persist_state()

    def _queue_candle_retry(self, candle: dict, *, persist: bool = True) -> None:
        if self._is_before_backfill_fence(candle):
            return
        key = (candle["symbol"], candle["interval"], candle["timestamp"])
        existing = self.pending_candle_updates.get(key)
        if existing is None or candle["is_final"] or not existing["is_final"]:
            self.pending_candle_updates[key] = candle
            if persist:
                self._persist_state()

    def _retry_pending_candle_broadcasts(self) -> None:
        changed = False
        for key, candle in list(self.pending_candle_updates.items()):
            if self.broadcast_candle(candle):
                del self.pending_candle_updates[key]
                changed = True
        if changed:
            self._persist_state()

    def _retry_pending_db_writes(self) -> None:
        changed = False
        for key, candle in list(self.pending_db_candles.items()):
            if self.save_to_db(candle):
                del self.pending_db_candles[key]
                changed = True
        if changed:
            self._persist_state()

    def _queue_live_candle(self, candle: dict) -> None:
        if self._is_before_backfill_fence(candle):
            return
        self.pending_live_candles[(candle["symbol"], candle["interval"], candle["timestamp"])] = candle

    def _flush_live_candles(self, *, force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - self.last_live_broadcast < LIVE_BROADCAST_INTERVAL_SECONDS:
            return

        for key, candle in list(self.pending_live_candles.items()):
            if self.broadcast_candle(candle):
                del self.pending_live_candles[key]
            else:
                self._queue_candle_retry(candle)
                del self.pending_live_candles[key]
        self.last_live_broadcast = now

    def _checkpoint_state_and_offsets(self, *, force: bool = False) -> None:
        if not self.has_uncommitted_messages:
            return

        now = time.monotonic()
        if not force and now - self.last_state_checkpoint < STATE_CHECKPOINT_INTERVAL_SECONDS:
            return

        self._persist_state()
        self._commit_consumer_offset("persisting raw-trade aggregation state")
        self.has_uncommitted_messages = False
        self.last_state_checkpoint = now

    def _send_to_topic(self, value: dict) -> None:
        def _send():
            return self.producer.send(
                config.TOPIC_KLINE_STREAM,
                value=value,
                key=f"{value['symbol']}_{value['interval']}".encode("utf-8"),
            ).get(timeout=15)

        retry_with_backoff(_send, max_retries=4, base_delay=0.5, operation_name="Kafka candle publish")

    def broadcast_candle(self, candle: dict) -> bool:
        if self._is_before_backfill_fence(candle):
            return True
        try:
            self._send_to_topic(
                {
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
            )
            return True
        except Exception:
            logger.error(f"Failed to publish candle update for {candle['symbol']} {candle['interval']}", exc_info=True)
            return False

    def _handle_candle(self, candle: dict) -> bool:
        if self._is_before_backfill_fence(candle):
            return True
        if not self._is_valid_candle(candle):
            logger.warning(f"Skipped invalid aggregated candle: {candle}")
            return True

        if not candle["is_final"]:
            self._queue_live_candle(candle)
            return True

        # Emit a closed candle immediately: the backend cache makes it available
        # to a page refresh while QuestDB WAL applies the durable upsert.
        if not self.broadcast_candle(candle):
            self._queue_candle_retry(candle)

        if candle["is_final"] and candle["interval"] == "1m" and not self.save_to_db(candle):
            self._queue_db_retry(candle)
        return True

    def process_trade(self, raw_trade: dict) -> bool:
        trade = self.normalize_trade(raw_trade)
        if trade is None:
            logger.debug(f"Skipped invalid raw trade input: {raw_trade}")
            return True

        if self.backfill_write_fence is not None and trade["timestamp"] < self.backfill_write_fence:
            return True

        candles = self.aggregator.process_trade(trade)
        for candle in candles:
            self._handle_candle(candle)
        return True

    def _finalize_expired_candles(self) -> None:
        candles = self.aggregator.finalize_expired(datetime.now(timezone.utc))
        if not candles:
            return
        for candle in candles:
            self._handle_candle(candle)

    def run(self) -> None:
        logger.info(f"Processor started; groupId={config.KAFKA_CONSUMER_GROUP_ID}")
        try:
            while self.running:
                raw_messages = self.consumer.poll(timeout_ms=1000)
                for messages in raw_messages.values():
                    for message in messages:
                        self.process_trade(message.value)
                        self.has_uncommitted_messages = True
                self._finalize_expired_candles()
                self._flush_live_candles()
                self._retry_pending_candle_broadcasts()
                self._retry_pending_db_writes()
                self._checkpoint_state_and_offsets()
        except KeyboardInterrupt:
            logger.info("Shutdown signal received")
        except Exception:
            logger.error("Unexpected error in processor", exc_info=True)
        finally:
            self.shutdown()

    def shutdown(self) -> None:
        if not self.running:
            return
        self.running = False
        self._finalize_expired_candles()
        self._flush_live_candles(force=True)
        self._retry_pending_candle_broadcasts()
        self._retry_pending_db_writes()
        self._checkpoint_state_and_offsets(force=True)
        for resource, name in ((getattr(self, "consumer", None), "consumer"), (getattr(self, "producer", None), "producer")):
            try:
                if resource is not None:
                    resource.close()
            except Exception:
                logger.warning(f"Failed to close Kafka {name}", exc_info=True)
        try:
            self.db_cursor.close()
            self.db_conn.close()
        except Exception:
            logger.warning("Failed to close QuestDB connection", exc_info=True)


if __name__ == "__main__":
    CandleProcessor().run()
