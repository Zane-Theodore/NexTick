"""Pure normalization for Binance partial order-book depth messages."""

import math

from data_pipeline.common.logger import get_logger

logger = get_logger(__name__)


def normalize_binance_depth_record(
    raw_message: dict,
    symbols: list[str],
) -> dict | None:
    stream = raw_message.get("stream")
    data = raw_message.get("data")

    if (
        not isinstance(stream, str)
        or "@depth20" not in stream
        or not isinstance(data, dict)
    ):
        return None

    symbol = stream.split("@", 1)[0].lower()

    try:
        last_update_id = int(data["lastUpdateId"])
        bids = _normalize_levels(data["bids"])
        asks = _normalize_levels(data["asks"])
    except (KeyError, TypeError, ValueError) as exc:
        logger.warning(f"Invalid Binance depth payload: {exc}")
        return None

    if (
        symbol not in symbols
        or last_update_id <= 0
        or bids is None
        or asks is None
        or not bids
        or not asks
    ):
        logger.warning(
            f"Dropped invalid Binance depth record for {symbol or 'unknown symbol'}"
        )
        return None

    return {
        "symbol": symbol.upper(),
        "last_update_id": last_update_id,
        "bids": bids,
        "asks": asks,
    }


def _normalize_levels(value: object) -> list[list[float]] | None:
    if not isinstance(value, list):
        return None

    levels: list[list[float]] = []
    for entry in value:
        if not isinstance(entry, list) or len(entry) < 2:
            return None

        price = float(entry[0])
        quantity = float(entry[1])
        if (
            not math.isfinite(price)
            or price <= 0
            or not math.isfinite(quantity)
            or quantity <= 0
        ):
            return None

        levels.append([price, quantity])

    return levels
