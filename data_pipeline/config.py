import os
import logging
from dotenv import load_dotenv

load_dotenv()

from data_pipeline.logger_config import get_logger

logger = get_logger(__name__)

def get_env_or_raise(var_name: str) -> str:
    value = os.getenv(var_name)
    
    if value is None or value.strip() == '':
        logger.error(f"Missing required environment variable: {var_name}")
        raise ValueError(f"Environment variable {var_name} is not set or is empty")
    
    return value

# ==========================================
# KAFKA
# ==========================================
KAFKA_SERVER = get_env_or_raise('KAFKA_BROKER')
TOPIC_RAW_TRADES = get_env_or_raise('KAFKA_TOPIC_RAW_TRADES')
TOPIC_KLINE_STREAM = get_env_or_raise('KAFKA_TOPIC_KLINE_STREAM')

# ==========================================
# QUESTDB
# ==========================================
QUESTDB_HOST = get_env_or_raise('QUESTDB_HOST')
QUESTDB_PORT = int(get_env_or_raise('QUESTDB_PORT'))
QUESTDB_USER = get_env_or_raise('QUESTDB_USER')
QUESTDB_PASSWORD = get_env_or_raise('QUESTDB_PASSWORD')
QUESTDB_DATABASE = get_env_or_raise('QUESTDB_DB_NAME')

# ==========================================
# BINANCE
# ==========================================
BINANCE_SOCKET_URL = get_env_or_raise('BINANCE_SOCKET_URL')

# ==========================================
# DATA PIPELINE CONFIG
# ==========================================
# List of trading symbols to process (can be set via environment variable)
# Format: comma-separated, e.g., "BTCUSDT,ETHUSDT,BNBUSDT"
TRADING_SYMBOLS = os.getenv('TRADING_SYMBOLS', 'BTCUSDT').split(',')
TRADING_SYMBOLS = [s.strip().lower() for s in TRADING_SYMBOLS]

# List of candle intervals to generate from raw trade data
# Format: list of interval strings
CANDLE_INTERVALS = os.getenv('CANDLE_INTERVALS', '1m,5m').split(',')
CANDLE_INTERVALS = [s.strip() for s in CANDLE_INTERVALS]

# Interval in milliseconds for broadcasting updating candles to frontend
CANDLE_UPDATE_INTERVAL_MS = int(os.getenv('CANDLE_UPDATE_INTERVAL_MS', '500'))