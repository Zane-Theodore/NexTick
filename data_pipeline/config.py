import os
from dotenv import load_dotenv

load_dotenv()

from data_pipeline.logger_config import get_logger

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
TOPIC_RAW_TRADES = get_env_or_raise('KAFKA_TOPIC_RAW_TRADES')
TOPIC_KLINE_STREAM = get_env_or_raise('KAFKA_TOPIC_KLINE_STREAM')

# QUESTDB
QUESTDB_HOST = get_env_or_raise('QUESTDB_HOST')
QUESTDB_PORT = int(get_env_or_raise('QUESTDB_PORT'))
QUESTDB_USER = get_env_or_raise('QUESTDB_USER')
QUESTDB_PASSWORD = get_env_or_raise('QUESTDB_PASSWORD')
QUESTDB_DATABASE = get_env_or_raise('QUESTDB_DB_NAME')

# BINANCE
BINANCE_SOCKET_URL = get_env_or_raise('BINANCE_SOCKET_URL')

# DATA PIPELINE CONFIG
# List of trading symbols to process (can be set via environment variable).
# Format: comma-separated, e.g., "BTCUSDT,ETHUSDT,BNBUSDT"
TRADING_SYMBOLS = _split_env_list('TRADING_SYMBOLS', 'BTCUSDT')
CANDLE_INTERVALS = [item.strip() for item in os.getenv('CANDLE_INTERVALS', '1m,5m').split(',') if item.strip()]

# Interval in milliseconds for broadcasting updating candles to frontend
CANDLE_UPDATE_INTERVAL_MS = int(os.getenv('CANDLE_UPDATE_INTERVAL_MS', '500'))