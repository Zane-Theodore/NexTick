"""Run periodic recent closed-candle reconciliation."""

import os
import signal
import sys
import time

from data_pipeline.backfill import reconciler
from data_pipeline.common.logger import get_logger

logger = get_logger(__name__)

running = True


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _env_int(name: str, default: int, minimum: int = 1) -> int:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    try:
        parsed = int(value)
    except ValueError:
        logger.warning(f"Invalid integer for {name}={value!r}; using {default}.")
        return default
    return max(parsed, minimum)


def _env_float(name: str, default: float, minimum: float = 0.0) -> float:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    try:
        parsed = float(value)
    except ValueError:
        logger.warning(f"Invalid number for {name}={value!r}; using {default}.")
        return default
    return max(parsed, minimum)


def _sleep_interruptibly(seconds: float) -> None:
    deadline = time.monotonic() + seconds
    while running and time.monotonic() < deadline:
        time.sleep(min(1.0, max(0.0, deadline - time.monotonic())))


def run_recent_reconciler() -> None:
    """Periodically upsert authoritative REST candles for the recent closed tail."""

    if not _env_bool("RECENT_RECONCILE_ENABLED", True):
        logger.warning("Recent candle reconciliation is disabled.")
        return

    interval_seconds = _env_int("RECENT_RECONCILE_INTERVAL_SECONDS", 60, minimum=10)
    lookback_minutes = _env_int("RECENT_RECONCILE_LOOKBACK_MINUTES", 15, minimum=2)
    end_lag_minutes = _env_int("RECENT_RECONCILE_END_LAG_MINUTES", 3, minimum=0)
    initial_delay_seconds = _env_float("RECENT_RECONCILE_INITIAL_DELAY_SECONDS", 5.0)
    wal_apply_timeout_seconds = _env_float("RECENT_RECONCILE_WAL_APPLY_TIMEOUT_SECONDS", 120.0, minimum=1.0)
    verify_after_write = _env_bool("RECENT_RECONCILE_VERIFY_AFTER_WRITE", False)
    dry_run = _env_bool("RECENT_RECONCILE_DRY_RUN", False)
    symbols = os.getenv("RECENT_RECONCILE_SYMBOLS")
    base_url = os.getenv("RECENT_RECONCILE_BINANCE_REST_URL") or os.getenv("BINANCE_REST_URL")
    tolerance = os.getenv("RECENT_RECONCILE_TOLERANCE")

    logger.info(
        f"Recent candle reconciler starting: interval_seconds={interval_seconds}, "
        f"lookback_minutes={lookback_minutes}, end_lag_minutes={end_lag_minutes}, "
        f"wal_apply_timeout_seconds={wal_apply_timeout_seconds}, "
        f"verify_after_write={verify_after_write}, dry_run={dry_run}"
    )
    _sleep_interruptibly(initial_delay_seconds)

    while running:
        started_at = time.monotonic()
        try:
            reconciler.run_recent_reconciliation(
                lookback_minutes=lookback_minutes,
                symbols_arg=symbols,
                binance_rest_url=base_url,
                dry_run=dry_run,
                tolerance_arg=tolerance,
                end_lag_minutes=end_lag_minutes,
                wal_apply_timeout_seconds=wal_apply_timeout_seconds,
                verify_after_write=verify_after_write,
            )
        except KeyboardInterrupt:
            raise
        except Exception as exc:
            logger.error(f"Recent candle reconciliation pass failed: {exc}", exc_info=True)

        elapsed = time.monotonic() - started_at
        _sleep_interruptibly(max(1.0, interval_seconds - elapsed))

    logger.info("Recent candle reconciler stopped.")


def main() -> None:
    """CLI entrypoint for periodic recent reconciliation."""

    def _handle_signal(sig, frame):
        global running
        logger.info(f"Received signal {sig}. Stopping recent candle reconciler...")
        running = False

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    run_recent_reconciler()
    sys.exit(0)


if __name__ == "__main__":
    main()
