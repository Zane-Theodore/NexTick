"""Build realtime OHLCV candles from Binance raw trade events."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from data_pipeline.common import config

INTERVAL_MS = dict(config.get_timeframes_with_ms())
CLOSE_GRACE = timedelta(seconds=2)


class CandleAggregator:
    """Stateful, per-symbol aggregation for the configured candle intervals."""

    def __init__(self, intervals: list[str] | None = None):
        self.intervals = intervals or config.CANDLE_INTERVALS
        self._candles: dict[tuple[str, str], dict] = {}
        self._finalized_starts: dict[tuple[str, str], datetime] = {}
        self._last_trade_ids: dict[str, int] = {}

    def process_trade(self, trade: dict) -> list[dict]:
        """Apply one normalized trade and return final and live candle updates."""

        if self._is_duplicate_trade(trade):
            return []

        updates: list[dict] = []
        for interval in self.intervals:
            key = (trade["symbol"], interval)
            bucket_start = self._bucket_start(trade["timestamp"], interval)
            current = self._candles.get(key)
            finalized_start = self._finalized_starts.get(key)

            if finalized_start is not None and bucket_start <= finalized_start:
                continue

            if current is not None and bucket_start < current["timestamp"]:
                continue

            if current is not None and bucket_start > current["timestamp"]:
                updates.append(self._snapshot(current, is_final=True))
                self._finalized_starts[key] = current["timestamp"]
                current = None

            if current is None:
                current = self._new_candle(trade, interval, bucket_start)
                self._candles[key] = current
            else:
                self._apply_trade(current, trade)

            updates.append(self._snapshot(current, is_final=False))

        return updates

    def finalize_expired(self, now: datetime) -> list[dict]:
        """Close candles whose bucket has passed even if no later trade arrives."""

        utc_now = now.astimezone(timezone.utc) - CLOSE_GRACE
        updates: list[dict] = []

        for key, candle in list(self._candles.items()):
            if self._bucket_end(candle["timestamp"], candle["interval"]) > utc_now:
                continue

            updates.append(self._snapshot(candle, is_final=True))
            self._finalized_starts[key] = candle["timestamp"]
            del self._candles[key]

        return updates

    def _is_duplicate_trade(self, trade: dict) -> bool:
        symbol = trade["symbol"]
        trade_id = trade["trade_id"]

        if trade_id <= self._last_trade_ids.get(symbol, -1):
            return True

        self._last_trade_ids[symbol] = trade_id
        return False

    def snapshot(self) -> dict:
        """Return JSON-safe active aggregation state for restart recovery."""

        return {
            "candles": [self._serialize_candle(candle) for candle in self._candles.values()],
            "finalized_starts": [
                {"symbol": symbol, "interval": interval, "timestamp": timestamp.isoformat()}
                for (symbol, interval), timestamp in self._finalized_starts.items()
            ],
            "last_trade_ids": self._last_trade_ids,
        }

    def restore(self, state: dict) -> None:
        """Restore a previous snapshot, discarding malformed entries safely."""

        self._candles.clear()
        self._finalized_starts.clear()
        self._last_trade_ids.clear()
        for symbol, trade_id in (state.get("last_trade_ids") or {}).items():
            try:
                normalized_symbol = str(symbol).upper()
                if normalized_symbol:
                    self._last_trade_ids[normalized_symbol] = int(trade_id)
            except (TypeError, ValueError):
                continue

        for raw_candle in state.get("candles") or []:
            candle = self._deserialize_candle(raw_candle)
            if candle is not None:
                self._candles[(candle["symbol"], candle["interval"])] = candle

        for marker in state.get("finalized_starts") or []:
            try:
                symbol = str(marker["symbol"]).upper()
                interval = str(marker["interval"])
                timestamp = datetime.fromisoformat(str(marker["timestamp"]).replace("Z", "+00:00"))
                if symbol and interval in self.intervals:
                    self._finalized_starts[(symbol, interval)] = timestamp.astimezone(timezone.utc)
            except (KeyError, TypeError, ValueError):
                continue

    @staticmethod
    def _serialize_candle(candle: dict) -> dict:
        return {**candle, "timestamp": candle["timestamp"].isoformat()}

    def _deserialize_candle(self, raw_candle: dict) -> dict | None:
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
            }
        except (KeyError, TypeError, ValueError):
            return None

        if (
            not candle["symbol"]
            or candle["interval"] not in self.intervals
            or candle["open"] <= 0
            or candle["high"] < max(candle["open"], candle["close"])
            or candle["low"] > min(candle["open"], candle["close"])
            or candle["low"] > candle["high"]
            or candle["volume"] < 0
        ):
            return None
        return candle

    @staticmethod
    def _new_candle(trade: dict, interval: str, bucket_start: datetime) -> dict:
        price = trade["price"]
        return {
            "symbol": trade["symbol"],
            "interval": interval,
            "timestamp": bucket_start,
            "open": price,
            "high": price,
            "low": price,
            "close": price,
            "volume": trade["quantity"],
        }

    @staticmethod
    def _apply_trade(candle: dict, trade: dict) -> None:
        price = trade["price"]
        candle["high"] = max(candle["high"], price)
        candle["low"] = min(candle["low"], price)
        candle["close"] = price
        candle["volume"] += trade["quantity"]

    @staticmethod
    def _snapshot(candle: dict, *, is_final: bool) -> dict:
        return {**candle, "is_final": is_final}

    @staticmethod
    def _bucket_start(timestamp: datetime, interval: str) -> datetime:
        timestamp = timestamp.astimezone(timezone.utc)

        if interval == "1M":
            return timestamp.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        if interval == "1w":
            day_start = timestamp.replace(hour=0, minute=0, second=0, microsecond=0)
            return day_start - timedelta(days=day_start.weekday())

        interval_ms = INTERVAL_MS[interval]
        timestamp_ms = int(timestamp.timestamp() * 1000)
        bucket_ms = timestamp_ms - (timestamp_ms % interval_ms)
        return datetime.fromtimestamp(bucket_ms / 1000, tz=timezone.utc)

    @staticmethod
    def _bucket_end(bucket_start: datetime, interval: str) -> datetime:
        if interval == "1M":
            if bucket_start.month == 12:
                return bucket_start.replace(year=bucket_start.year + 1, month=1)
            return bucket_start.replace(month=bucket_start.month + 1)

        if interval == "1w":
            return bucket_start + timedelta(days=7)

        interval_ms = INTERVAL_MS[interval]
        return bucket_start + timedelta(milliseconds=interval_ms)
