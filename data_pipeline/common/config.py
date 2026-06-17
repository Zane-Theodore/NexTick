import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from data_pipeline directory.
env_path = Path(__file__).resolve().parents[1] / '.env'
load_dotenv(env_path)

from data_pipeline.common.logger import get_logger

logger = get_logger(__name__)


def get_env_or_raise(var_name: str) -> str:
    """Retrieve and validate a required environment variable.
    
    Args:
        var_name: Environment variable name.
        
    Returns:
        Trimmed value of the environment variable.
        
    Raises:
        ValueError: If variable is not set or is empty after trimming.
    """
    value = os.getenv(var_name)
    if not value or not value.strip():
        logger.error(f"Missing required environment variable: {var_name}")
        raise ValueError(f"Environment variable {var_name} is not set or is empty")
    return value.strip()


def _split_env_list(var_name: str, default: str = "") -> list[str]:
    """Parse a comma-separated environment variable into a list of strings.
    
    Args:
        var_name: Environment variable name.
        default: Default value if variable is not set.
        
    Returns:
        List of lowercase, trimmed strings.
    """
    return [item.strip().lower() for item in os.getenv(var_name, default).split(",") if item.strip()]

# KAFKA
KAFKA_SERVER = get_env_or_raise('KAFKA_BROKER')
KAFKA_TOPIC_MARKET_KLINES = get_env_or_raise('KAFKA_TOPIC_MARKET_KLINES')
TOPIC_KLINE_STREAM = get_env_or_raise('KAFKA_TOPIC_KLINE_STREAM')
KAFKA_CONSUMER_GROUP_ID = os.getenv('KAFKA_CONSUMER_GROUP_ID', 'candle-processor-group').strip() or 'candle-processor-group'
KAFKA_AUTO_OFFSET_RESET = os.getenv('KAFKA_AUTO_OFFSET_RESET', 'earliest').strip().lower() or 'earliest'

if KAFKA_AUTO_OFFSET_RESET not in {'earliest', 'latest'}:
    logger.warning(f"Invalid KAFKA_AUTO_OFFSET_RESET={KAFKA_AUTO_OFFSET_RESET!r}; using 'earliest'.")
    KAFKA_AUTO_OFFSET_RESET = 'earliest'

# QUESTDB
QUESTDB_HOST = get_env_or_raise('QUESTDB_HOST')
QUESTDB_PORT = int(get_env_or_raise('QUESTDB_PORT'))
QUESTDB_USER = get_env_or_raise('QUESTDB_USER')
QUESTDB_PASSWORD = get_env_or_raise('QUESTDB_PASSWORD')
QUESTDB_DATABASE = get_env_or_raise('QUESTDB_DB_NAME')

# BINANCE
BINANCE_SOCKET_URL = get_env_or_raise('BINANCE_SOCKET_URL')

SUPPORTED_CANDLE_INTERVALS = (
    '1m',
    '3m',
    '5m',
    '15m',
    '30m',
    '1h',
    '2h',
    '4h',
    '6h',
    '8h',
    '12h',
    '1d',
    '3d',
    '1w',
    '1M',
)

DEFAULT_CANDLE_INTERVALS = ",".join(SUPPORTED_CANDLE_INTERVALS)

# DATA PIPELINE CONFIG
# List of trading symbols to process (can be set via environment variable).
# Format: comma-separated, e.g., "BTCUSDT,ETHUSDT,BNBUSDT"
TRADING_SYMBOLS = _split_env_list('TRADING_SYMBOLS', 'BTCUSDT')
CANDLE_INTERVALS = [item.strip() for item in os.getenv('CANDLE_INTERVALS', DEFAULT_CANDLE_INTERVALS).split(',') if item.strip()]

# Mapping of interval names to milliseconds
_INTERVAL_MS_MAP = {
    '1m': 60 * 1000,
    '3m': 3 * 60 * 1000,
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '30m': 30 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '2h': 2 * 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '8h': 8 * 60 * 60 * 1000,
    '12h': 12 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
    '3d': 3 * 24 * 60 * 60 * 1000,
    '1w': 7 * 24 * 60 * 60 * 1000,
    '1M': 30 * 24 * 60 * 60 * 1000,
}

def get_timeframes_with_ms() -> list[tuple[str, int]]:
    """Convert configured interval names to (interval_name, interval_ms) tuples.
    
    Returns:
        List of tuples: [(interval_name, interval_ms), ...]
    """
    invalid_intervals = [interval for interval in CANDLE_INTERVALS if interval not in _INTERVAL_MS_MAP]
    if invalid_intervals:
        logger.error(f"Invalid candle intervals configured: {invalid_intervals}")
        raise ValueError(
            f"Invalid candle intervals configured: {', '.join(invalid_intervals)}. "
            f"Supported intervals: {', '.join(SUPPORTED_CANDLE_INTERVALS)}"
        )

    return [(interval, _INTERVAL_MS_MAP[interval]) for interval in CANDLE_INTERVALS]
