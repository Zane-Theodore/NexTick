"""Regression coverage for DB-watermark + Binance-cutover startup backfill."""

import os
import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from unittest.mock import Mock, patch


# kafka-python 2.0.2 is the pinned production client for Python 3.10. Its
# vendored-six import is incompatible with this repository's Python 3.12 test
# runner, while these unit tests never construct a Kafka client.
try:
    import kafka  # noqa: F401
except ModuleNotFoundError:
    from types import ModuleType

    for module_name in list(sys.modules):
        if module_name == "kafka" or module_name.startswith("kafka."):
            del sys.modules[module_name]
    kafka_stub = ModuleType("kafka")
    kafka_stub.KafkaConsumer = object
    kafka_stub.KafkaProducer = object
    kafka_errors_stub = ModuleType("kafka.errors")
    kafka_errors_stub.NoBrokersAvailable = type("NoBrokersAvailable", (Exception,), {})
    kafka_stub.errors = kafka_errors_stub
    sys.modules["kafka"] = kafka_stub
    sys.modules["kafka.errors"] = kafka_errors_stub


# These are read while importing the processor configuration module.
os.environ.setdefault("KAFKA_BROKER", "localhost:9092")
os.environ.setdefault("KAFKA_TOPIC_MARKET_TRADES", "market-trades")
os.environ.setdefault("KAFKA_TOPIC_KLINE_STREAM", "kline-stream")
os.environ.setdefault("QUESTDB_HOST", "localhost")
os.environ.setdefault("QUESTDB_PORT", "8812")
os.environ.setdefault("QUESTDB_USER", "admin")
os.environ.setdefault("QUESTDB_PASSWORD", "quest")
os.environ.setdefault("QUESTDB_DB_NAME", "qdb")
os.environ.setdefault("BINANCE_SOCKET_URL", "wss://example.test/stream")

from data_pipeline.backfill import reconciler, runner
from data_pipeline.backfill.state import get_backfill_state_file, read_backfill_cutover, write_backfill_state
from data_pipeline.processor.candle_aggregator import CandleAggregator
from data_pipeline.processor.candle_processor import CandleProcessor


UTC = timezone.utc


def at(hour: int, minute: int) -> datetime:
    return datetime(2026, 8, 9, hour, minute, tzinfo=UTC)


def db_row(symbol: str, timestamp: datetime, *, valid: bool = True):
    return (
        symbol,
        "1m",
        timestamp,
        Decimal("100") if valid else Decimal("0"),
        Decimal("110"),
        Decimal("90"),
        Decimal("105"),
        Decimal("1"),
    )


def candle(timestamp: datetime, *, is_final: bool = True) -> dict:
    return {
        "symbol": "BTCUSDT",
        "interval": "1m",
        "timestamp": timestamp,
        "open": 100.0,
        "high": 110.0,
        "low": 90.0,
        "close": 105.0,
        "volume": 1.0,
        "is_final": is_final,
    }


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows
        self.executed = []

    def execute(self, *args):
        self.executed.append(args)

    def fetchall(self):
        return self.rows


class StartupBackfillTests(unittest.TestCase):
    def test_cutover_is_next_binance_minute_before_stability_wait(self):
        with patch.object(reconciler, "fetch_binance_server_time", return_value=at(8, 20) + timedelta(seconds=30)):
            self.assertEqual(reconciler.resolve_startup_cutover("https://example.test"), at(8, 21))

    def test_watermark_range_is_exact_and_ignores_invalid_newer_row(self):
        cutover = at(8, 21)
        cursor = FakeCursor([
            db_row("BTCUSDT", at(8, 17), valid=False),
            db_row("BTCUSDT", at(8, 15)),
        ])

        result = reconciler.resolve_symbol_range(cursor, "BTCUSDT", cutover, 1000)

        self.assertEqual(result.watermark, at(8, 15))
        self.assertEqual(result.start, at(8, 16))
        self.assertEqual(result.end, cutover)
        self.assertEqual(result.expected_count, 5)
        self.assertFalse(result.bootstrap)

    def test_empty_db_bootstrap_is_capped_at_eight_hours(self):
        cutover = at(8, 21)
        result = reconciler.resolve_symbol_range(FakeCursor([]), "ETHUSDT", cutover, 1000)

        self.assertEqual(result.start, cutover - timedelta(minutes=480))
        self.assertEqual(result.end, cutover)
        self.assertEqual(result.expected_count, 480)
        self.assertTrue(result.bootstrap)

    def test_old_watermark_backfill_is_capped_at_eight_hours(self):
        cutover = at(8, 21)
        result = reconciler.resolve_symbol_range(
            FakeCursor([db_row("BTCUSDT", at(0, 0))]), "BTCUSDT", cutover, 480
        )

        self.assertEqual(result.start, cutover - timedelta(minutes=480))
        self.assertEqual(result.expected_count, 480)
        self.assertFalse(result.bootstrap)

    def test_watermark_at_cutover_minus_one_needs_no_fetch(self):
        cutover = at(8, 21)
        result = reconciler.resolve_symbol_range(
            FakeCursor([db_row("BTCUSDT", at(8, 20))]), "BTCUSDT", cutover, 1000
        )

        self.assertIsNone(result.start)
        self.assertEqual(result.expected_count, 0)

    def test_symbols_resolve_independent_watermarks(self):
        cutover = at(8, 21)
        btc = reconciler.resolve_symbol_range(
            FakeCursor([db_row("BTCUSDT", at(8, 15))]), "BTCUSDT", cutover, 1000
        )
        eth = reconciler.resolve_symbol_range(
            FakeCursor([db_row("ETHUSDT", at(8, 19))]), "ETHUSDT", cutover, 1000
        )

        self.assertEqual((btc.start, btc.expected_count), (at(8, 16), 5))
        self.assertEqual((eth.start, eth.expected_count), (at(8, 20), 1))

    def test_binance_pagination_is_ascending_and_complete(self):
        start = at(0, 0)
        end = start + timedelta(minutes=1002)
        request_starts = []

        def api_response(url, max_retries=5):
            from urllib.parse import parse_qs, urlparse

            query = parse_qs(urlparse(url).query)
            request_start = int(query["startTime"][0])
            request_end = int(query["endTime"][0])
            request_starts.append(request_start)
            return [
                [
                    timestamp,
                    "100",
                    "110",
                    "90",
                    "105",
                    "1",
                    timestamp + reconciler.INTERVAL_MS - 1,
                ]
                for timestamp in range(request_start, request_end + 1, reconciler.INTERVAL_MS)
            ]

        with patch.object(reconciler, "request_json", side_effect=api_response):
            rows = reconciler.fetch_binance_klines("https://example.test", "BTCUSDT", start, end)

        reconciler.validate_rows(rows, "BTCUSDT", start, end)
        self.assertEqual(request_starts, [int(start.timestamp() * 1000), int((start + timedelta(minutes=1000)).timestamp() * 1000)])
        self.assertEqual([row.timestamp for row in rows], [start + timedelta(minutes=index) for index in range(1002)])

    def test_incomplete_binance_response_fails_before_any_db_write(self):
        start = at(8, 16)
        rows = [
            reconciler.CandleRow(
                symbol="BTCUSDT", interval="1m", timestamp=start,
                open=Decimal("100"), high=Decimal("110"), low=Decimal("90"),
                close=Decimal("105"), volume=Decimal("1"),
            )
        ]
        with self.assertRaisesRegex(ValueError, "expected 2 Binance candles, got 1"):
            reconciler.validate_rows(rows, "BTCUSDT", start, start + timedelta(minutes=2))

    def _processor_with_fence(self, cutover: datetime) -> CandleProcessor:
        processor = CandleProcessor.__new__(CandleProcessor)
        processor.backfill_write_fence = cutover
        processor.aggregator = CandleAggregator(["1m"])
        processor.pending_live_candles = {}
        processor.pending_candle_updates = {}
        processor.pending_db_candles = {}
        return processor

    def test_processor_fence_skips_before_cutover_and_accepts_cutover(self):
        cutover = at(8, 21)
        processor = self._processor_with_fence(cutover)
        processor.broadcast_candle = Mock(return_value=True)
        processor.save_to_db = Mock(return_value=True)

        processor._handle_candle(candle(at(8, 20)))
        processor._handle_candle(candle(cutover))

        self.assertEqual(processor.broadcast_candle.call_count, 1)
        self.assertEqual(processor.save_to_db.call_count, 1)
        self.assertEqual(processor.broadcast_candle.call_args.args[0]["timestamp"], cutover)

    def test_processor_fence_never_queues_old_retry_or_live_candles(self):
        processor = self._processor_with_fence(at(8, 21))
        old = candle(at(8, 20), is_final=False)

        processor._queue_live_candle(old)
        processor._queue_candle_retry(old, persist=False)
        processor._queue_db_retry({**old, "is_final": True}, persist=False)

        self.assertEqual(processor.pending_live_candles, {})
        self.assertEqual(processor.pending_candle_updates, {})
        self.assertEqual(processor.pending_db_candles, {})

    def test_processor_restart_discards_pre_cutover_aggregator_state(self):
        processor = self._processor_with_fence(at(8, 21))
        state = {
            "candles": [
                {"timestamp": at(8, 20).isoformat()},
                {"timestamp": at(8, 21).isoformat()},
            ],
            "finalized_starts": [
                {"timestamp": at(8, 20).isoformat()},
                {"timestamp": at(8, 21).isoformat()},
            ],
        }

        filtered = processor._discard_pre_cutover_aggregator_state(state)

        self.assertEqual([item["timestamp"] for item in filtered["candles"]], [at(8, 21).isoformat()])
        self.assertEqual([item["timestamp"] for item in filtered["finalized_starts"]], [at(8, 21).isoformat()])

    def test_startup_mid_minute_does_not_create_partial_realtime_candle(self):
        cutover = at(8, 21)
        processor = self._processor_with_fence(cutover)
        processor._handle_candle = Mock()

        processor.process_trade({"symbol": "BTCUSDT", "trade_id": 1, "timestamp": int(at(8, 20).timestamp() * 1000), "price": 100, "quantity": 1})
        processor.process_trade({"symbol": "BTCUSDT", "trade_id": 2, "timestamp": int(cutover.timestamp() * 1000), "price": 101, "quantity": 1})

        self.assertEqual(processor._handle_candle.call_count, 1)
        self.assertEqual(processor._handle_candle.call_args.args[0]["timestamp"], cutover)

    def test_dry_run_never_writes_a_state_fence(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            os.environ,
            {
                "STARTUP_BACKFILL_STATE_FILE": str(Path(directory) / "state.json"),
                "STARTUP_RECONCILE_ENABLED": "true",
                "STARTUP_RECONCILE_DRY_RUN": "true",
                "STARTUP_RECONCILE_MAX_ATTEMPTS": "1",
                "STARTUP_RECONCILE_WINDOW_HOURS": "",
            },
            clear=False,
        ), patch.object(runner.reconciler, "resolve_startup_cutover", return_value=at(8, 21)), patch.object(
            runner.reconciler, "wait_for_open_candle_close"
        ), patch.object(runner.reconciler, "run_reconciliation", return_value=reconciler.ReconciliationResult(
            symbols=["BTCUSDT"], interval="1m", start=at(8, 16), end=at(8, 21), expected_count=5,
            dry_run=True, ranges=[]
        )), patch.object(runner, "write_backfill_state") as write_state:
            self.assertTrue(runner.run_startup_backfill())
            write_state.assert_not_called()
            self.assertFalse(get_backfill_state_file().exists())

    def test_blank_enabled_setting_defaults_to_backfill_on(self):
        with patch.dict(
            os.environ,
            {
                "STARTUP_RECONCILE_ENABLED": "",
                "STARTUP_RECONCILE_DRY_RUN": "true",
                "STARTUP_RECONCILE_MAX_ATTEMPTS": "1",
                "STARTUP_RECONCILE_WINDOW_HOURS": "",
            },
            clear=False,
        ), patch.object(runner.reconciler, "resolve_startup_cutover", return_value=at(8, 21)) as resolve_cutover, patch.object(
            runner.reconciler, "wait_for_open_candle_close"
        ), patch.object(runner.reconciler, "run_reconciliation", return_value=reconciler.ReconciliationResult(
            symbols=["BTCUSDT"], interval="1m", start=at(8, 16), end=at(8, 21), expected_count=5,
            dry_run=True, ranges=[]
        )):
            self.assertTrue(runner.run_startup_backfill())
            resolve_cutover.assert_called_once()

    def test_success_state_records_cutover_and_per_symbol_ranges(self):
        cutover = at(8, 21)
        symbol_range = reconciler.SymbolReconciliationRange(
            symbol="BTCUSDT", start=at(8, 16), end=cutover, watermark=at(8, 15),
            bootstrap=False, expected_count=5,
        )
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            os.environ, {"STARTUP_BACKFILL_STATE_FILE": str(Path(directory) / "state.json")}, clear=False
        ):
            write_backfill_state(
                start=symbol_range.start, end=cutover, symbols=["BTCUSDT"], interval="1m",
                expected_count=5, dry_run=False, ranges=[symbol_range],
            )
            payload = json.loads(get_backfill_state_file().read_text(encoding="utf-8"))
            restored_cutover = read_backfill_cutover()

        self.assertEqual(payload["cutover"], cutover.isoformat())
        self.assertEqual(payload["ranges"][0]["start"], at(8, 16).isoformat())
        self.assertEqual(restored_cutover, cutover)

    def test_required_failure_blocks_processor_and_removes_stale_state(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            os.environ,
            {
                "STARTUP_BACKFILL_STATE_FILE": str(Path(directory) / "state.json"),
                "STARTUP_RECONCILE_ENABLED": "true",
                "STARTUP_RECONCILE_REQUIRED": "true",
                "STARTUP_RECONCILE_MAX_ATTEMPTS": "1",
                "STARTUP_RECONCILE_WINDOW_HOURS": "",
            },
            clear=False,
        ), patch.object(runner.reconciler, "resolve_startup_cutover", side_effect=RuntimeError("Binance unavailable")):
            get_backfill_state_file().write_text("stale", encoding="utf-8")
            self.assertFalse(runner.run_startup_backfill())
            self.assertFalse(get_backfill_state_file().exists())


if __name__ == "__main__":
    unittest.main()
