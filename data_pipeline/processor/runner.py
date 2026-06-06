"""Start the realtime candle processor with a health marker."""

import os
import signal
import sys
import tempfile
import time
from pathlib import Path

from data_pipeline.common.logger import get_logger

logger = get_logger(__name__)

DEFAULT_READY_FILE = Path(tempfile.gettempdir()) / "nextick-processor-ready"


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


def run_processor() -> None:
    """Run the realtime processor until it exits or receives a signal."""

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
        from data_pipeline.processor.candle_processor import CandleProcessor

        processor = CandleProcessor()
        _write_ready_marker()
        logger.info("Processor is ready; entering realtime processing loop.")
        processor.run()
    finally:
        _remove_ready_marker()


def main() -> None:
    """CLI entrypoint for the realtime processor runner."""

    run_processor()


if __name__ == "__main__":
    main()
