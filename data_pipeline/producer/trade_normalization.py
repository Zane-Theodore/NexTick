"""Pure normalization for Binance raw trade stream messages."""

from data_pipeline.common.logger import get_logger

logger = get_logger(__name__)


def normalize_binance_trade_record(
    raw_message: dict,
    symbols: list[str],
) -> dict | None:
    data = raw_message.get("data", raw_message)
    if not isinstance(data, dict) or data.get("e") != "trade":
        return None

    try:
        is_buyer_maker = data["m"]
        if not isinstance(is_buyer_maker, bool):
            raise TypeError("m must be a boolean")

        record = {
            "symbol": str(data["s"]).upper(),
            "trade_id": int(data["t"]),
            "timestamp": int(data["T"]),
            "event_time": int(data["E"]),
            "price": float(data["p"]),
            "quantity": float(data["q"]),
            "is_buyer_maker": is_buyer_maker,
        }
    except (KeyError, TypeError, ValueError) as exc:
        logger.warning(f"Invalid Binance trade payload: {exc}")
        return None

    if (
        not record["symbol"]
        or record["symbol"].lower() not in symbols
        or record["trade_id"] < 0
        or record["timestamp"] <= 0
        or record["price"] <= 0
        or record["quantity"] <= 0
    ):
        logger.warning(f"Dropped invalid Binance trade record: {record}")
        return None

    return record
