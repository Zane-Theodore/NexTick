"""Durable processor state used to resume active candles after a restart."""

import json
import os
import tempfile
from pathlib import Path

from data_pipeline.common.logger import get_logger

logger = get_logger(__name__)

DEFAULT_PROCESSOR_STATE_FILE = Path(tempfile.gettempdir()) / "nextick-candle-processor-state.json"


def get_processor_state_file() -> Path:
    return Path(os.getenv("CANDLE_PROCESSOR_STATE_FILE") or DEFAULT_PROCESSOR_STATE_FILE)


def read_processor_state() -> dict:
    state_file = get_processor_state_file()
    try:
        with state_file.open("r", encoding="utf-8") as handle:
            state = json.load(handle)
        return state if isinstance(state, dict) else {}
    except FileNotFoundError:
        return {}
    except (OSError, json.JSONDecodeError):
        logger.warning(f"Failed to read processor state file {state_file}; starting with an empty state.", exc_info=True)
        return {}


def write_processor_state(state: dict) -> None:
    state_file = get_processor_state_file()
    temporary_file = state_file.with_name(f".{state_file.name}.tmp")

    try:
        state_file.parent.mkdir(parents=True, exist_ok=True)
        temporary_file.write_text(json.dumps(state, separators=(",", ":")), encoding="utf-8")
        temporary_file.replace(state_file)
    except OSError:
        logger.error(f"Failed to persist processor state file {state_file}.", exc_info=True)
        raise
