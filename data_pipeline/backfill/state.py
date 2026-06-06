"""Shared startup backfill state used by Docker services."""

import json
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from data_pipeline.common.logger import get_logger

logger = get_logger(__name__)

DEFAULT_BACKFILL_STATE_FILE = Path(tempfile.gettempdir()) / "nextick-startup-backfill.json"


def get_backfill_state_file() -> Path:
    """Return the shared startup backfill marker path."""

    return Path(os.getenv("STARTUP_BACKFILL_STATE_FILE") or DEFAULT_BACKFILL_STATE_FILE)


def remove_backfill_state_file() -> None:
    """Remove stale startup backfill state before a new backfill attempt."""

    state_file = get_backfill_state_file()
    try:
        state_file.unlink(missing_ok=True)
    except OSError:
        logger.warning(f"Failed to remove startup backfill state file {state_file}.", exc_info=True)


def write_backfill_state(
    *,
    start: datetime,
    end: datetime,
    symbols: list[str],
    interval: str,
    expected_count: int,
    dry_run: bool,
) -> None:
    """Persist the successfully reconciled candle window for the processor."""

    state_file = get_backfill_state_file()
    state_file.parent.mkdir(parents=True, exist_ok=True)
    payload: dict[str, Any] = {
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "start": start.astimezone(timezone.utc).isoformat(),
        "end": end.astimezone(timezone.utc).isoformat(),
        "symbols": symbols,
        "interval": interval,
        "expected_count": expected_count,
        "dry_run": dry_run,
    }
    temp_file = state_file.with_name(f"{state_file.name}.{int(time.time() * 1000)}.tmp")
    temp_file.write_text(json.dumps(payload, sort_keys=True), encoding="utf-8")
    temp_file.replace(state_file)


def read_backfill_end() -> datetime | None:
    """Read the exclusive end timestamp of the last completed startup backfill."""

    state_file = get_backfill_state_file()
    if not state_file.exists():
        logger.info(f"No startup backfill state file found at {state_file}; no DB write fence is active.")
        return None

    try:
        payload = json.loads(state_file.read_text(encoding="utf-8"))
        if payload.get("dry_run"):
            logger.info(f"Startup backfill state file {state_file} is from a dry run; no DB write fence is active.")
            return None
        raw_end = payload["end"]
        parsed = datetime.fromisoformat(str(raw_end).replace("Z", "+00:00"))
    except Exception:
        logger.warning(f"Failed to read startup backfill state file {state_file}; ignoring write fence.", exc_info=True)
        return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)
