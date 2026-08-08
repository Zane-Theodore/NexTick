"""Shared retry behavior for infrastructure operations."""

import time
from collections.abc import Callable
from typing import TypeVar

from kafka.errors import NoBrokersAvailable

from data_pipeline.common.logger import get_logger

logger = get_logger(__name__)

T = TypeVar("T")


def retry_with_backoff(
    operation: Callable[[], T],
    *,
    max_retries: int = 60,
    base_delay: float = 1.0,
    max_delay: float = 10.0,
    operation_name: str = "operation",
) -> T:
    """Run an operation with bounded exponential backoff."""

    for attempt in range(1, max_retries + 1):
        try:
            return operation()
        except Exception as error:
            if attempt == max_retries:
                logger.error(f"{operation_name} failed after {attempt} attempts.", exc_info=True)
                raise

            delay = min(base_delay * (2 ** (attempt - 1)), max_delay)
            if isinstance(error, NoBrokersAvailable):
                logger.warning(
                    f"{operation_name} failed (Kafka not ready). "
                    f"Retrying in {delay:.1f}s... ({attempt}/{max_retries})"
                )
            else:
                logger.warning(
                    f"{operation_name} failed on attempt {attempt}: {error}. "
                    f"Retrying in {delay:.1f}s..."
                )
            time.sleep(delay)

    raise RuntimeError(f"{operation_name} retry loop exited unexpectedly")
