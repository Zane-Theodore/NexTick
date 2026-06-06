"""Start the data pipeline in the required reconciliation-first order."""

import os
import signal
import sys
import tempfile
import time
from pathlib import Path

from data_pipeline import candle_reconciler
from data_pipeline.logger_config import get_logger

logger = get_logger(__name__)

DEFAULT_READY_FILE = Path(tempfile.gettempdir()) / "nextick-processor-ready"


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


def _ready_file_path() -> Path:
    return Path(os.getenv("PROCESSOR_READY_FILE") or DEFAULT_READY_FILE)


def _remove_ready_marker() -> None:
    ready_file = _ready_file_path()
    try:
        ready_file.unlink(missing_ok=True)
    except OSError:
        logger.warning(f"Failed to remove processor ready marker {ready_file}.", exc_info=True)


def _write_ready_marker() -> None:
    ready_file = _ready_file_path()
    try:
        ready_file.parent.mkdir(parents=True, exist_ok=True)
        ready_file.write_text(str(int(time.time())), encoding="utf-8")
    except OSError:
        logger.error(f"Failed to write processor ready marker {ready_file}.", exc_info=True)
        raise


def _run_startup_reconciliation() -> None:
    if not _env_bool("STARTUP_RECONCILE_ENABLED", True):
        logger.warning("Startup reconciliation is disabled. Processor will start without repairing recent candles.")
        return

    required = _env_bool("STARTUP_RECONCILE_REQUIRED", True)
    attempts = _env_int("STARTUP_RECONCILE_MAX_ATTEMPTS", 3)
    base_delay = _env_float("STARTUP_RECONCILE_RETRY_DELAY_SECONDS", 5.0)
    dry_run = _env_bool("STARTUP_RECONCILE_DRY_RUN", False)
    keep_temp = _env_bool("STARTUP_RECONCILE_KEEP_TEMP", False)
    symbols = os.getenv("STARTUP_RECONCILE_SYMBOLS")
    base_url = os.getenv("STARTUP_RECONCILE_BINANCE_REST_URL") or os.getenv("BINANCE_REST_URL")
    tolerance = os.getenv("STARTUP_RECONCILE_TOLERANCE")

    last_error = None
    for attempt in range(1, attempts + 1):
        try:
            logger.info(f"Running startup reconciliation before processor startup ({attempt}/{attempts}).")
            candle_reconciler.run_reconciliation(
                symbols_arg=symbols,
                binance_rest_url=base_url,
                dry_run=dry_run,
                keep_temp=keep_temp,
                tolerance_arg=tolerance,
            )
            logger.info("Startup reconciliation completed successfully.")
            return
        except KeyboardInterrupt:
            raise
        except Exception as exc:
            last_error = exc
            logger.error(
                f"Startup reconciliation failed on attempt {attempt}/{attempts}: {exc}",
                exc_info=True,
            )
            if attempt < attempts:
                delay = min(base_delay * (2 ** (attempt - 1)), 60.0)
                logger.info(f"Retrying startup reconciliation in {delay:.1f}s.")
                time.sleep(delay)

    if required:
        raise RuntimeError("Startup reconciliation failed; processor will not start.") from last_error

    logger.error("Startup reconciliation failed, but STARTUP_RECONCILE_REQUIRED=false so processor will continue.")


def main() -> None:
    """Run startup reconciliation, then start the realtime candle processor."""

    _remove_ready_marker()
    processor = None

    def _handle_signal(sig, frame):
        logger.info(f"Received signal {sig}. Initiating graceful shutdown...")
        _remove_ready_marker()
        if processor is not None:
            processor.shutdown()
        sys.exit(0)

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    try:
        _run_startup_reconciliation()

        from data_pipeline.processor.candle_processor import CandleProcessor

        processor = CandleProcessor()
        _write_ready_marker()
        logger.info("Processor is ready; entering realtime processing loop.")
        processor.run()
    finally:
        _remove_ready_marker()


if __name__ == "__main__":
    main()
