"""Run startup candle backfill as a standalone service."""

import os
import sys
import time

from data_pipeline.backfill.state import remove_backfill_state_file, write_backfill_state
from data_pipeline.backfill import reconciler
from data_pipeline.common.logger import get_logger

logger = get_logger(__name__)


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


def run_startup_backfill() -> bool:
    """Run bounded startup reconciliation and write a processor fence on success."""

    remove_backfill_state_file()

    if not _env_bool("STARTUP_RECONCILE_ENABLED", True):
        logger.info("Startup backfill is disabled. Processor can start without a backfill write fence.")
        return True

    required = _env_bool("STARTUP_RECONCILE_REQUIRED", True)
    attempts = _env_int("STARTUP_RECONCILE_MAX_ATTEMPTS", 3)
    base_delay = _env_float("STARTUP_RECONCILE_RETRY_DELAY_SECONDS", 5.0)
    dry_run = _env_bool("STARTUP_RECONCILE_DRY_RUN", False)
    keep_temp = _env_bool("STARTUP_RECONCILE_KEEP_TEMP", False)
    symbols = os.getenv("STARTUP_RECONCILE_SYMBOLS")
    base_url = os.getenv("STARTUP_RECONCILE_BINANCE_REST_URL") or os.getenv("BINANCE_REST_URL")
    tolerance = os.getenv("STARTUP_RECONCILE_TOLERANCE")
    bootstrap_candles = os.getenv("STARTUP_RECONCILE_BOOTSTRAP_CANDLES")
    wait_for_open_close = _env_bool("STARTUP_RECONCILE_WAIT_FOR_OPEN_CANDLE_CLOSE", True)
    if os.getenv("STARTUP_RECONCILE_WINDOW_HOURS"):
        logger.warning(
            "STARTUP_RECONCILE_WINDOW_HOURS is deprecated and ignored for startup. "
            "Startup reconciliation uses each symbol's QuestDB watermark; "
            "STARTUP_RECONCILE_BOOTSTRAP_CANDLES applies only to empty symbols."
        )

    last_error = None
    for attempt in range(1, attempts + 1):
        try:
            logger.info(f"Running startup candle backfill ({attempt}/{attempts}).")
            cutover = reconciler.resolve_startup_cutover(base_url or reconciler.DEFAULT_BINANCE_REST_URL)
            if wait_for_open_close:
                reconciler.wait_for_open_candle_close(
                    base_url or reconciler.DEFAULT_BINANCE_REST_URL,
                    cutover,
                )
            result = reconciler.run_reconciliation(
                symbols_arg=symbols,
                binance_rest_url=base_url,
                dry_run=dry_run,
                keep_temp=keep_temp,
                tolerance_arg=tolerance,
                bootstrap_candles=bootstrap_candles,
                cutover=cutover,
            )
            if not result.dry_run:
                write_backfill_state(
                    start=result.start,
                    end=result.end,
                    symbols=result.symbols,
                    interval=result.interval,
                    expected_count=result.expected_count,
                    dry_run=False,
                    ranges=result.ranges,
                )
                logger.info(f"Startup candle backfill completed. Processor cutover={result.end.isoformat()}.")
            else:
                logger.info("Startup backfill dry run completed without writing a processor fence.")
            return True
        except KeyboardInterrupt:
            raise
        except Exception as exc:
            last_error = exc
            logger.error(f"Startup candle backfill failed on attempt {attempt}/{attempts}: {exc}", exc_info=True)
            if attempt < attempts:
                delay = min(base_delay * (2 ** (attempt - 1)), 60.0)
                logger.info(f"Retrying startup candle backfill in {delay:.1f}s.")
                time.sleep(delay)

    logger.error(f"Startup candle backfill failed after all attempts. Last error: {last_error}")
    return not required


def main() -> None:
    """CLI entrypoint for the startup backfill service."""

    sys.exit(0 if run_startup_backfill() else 1)


if __name__ == "__main__":
    main()
