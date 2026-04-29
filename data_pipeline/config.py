import os
import logging
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

def get_env_or_raise(var_name: str) -> str:
    value = os.getenv(var_name)
    
    if value is None or value.strip() == '':
        logger.error(f"Missing required environment variable: '{var_name}'")
        raise ValueError(f"Environment variable '{var_name}' is not set or is empty")
    
    return value

# ==========================================
# KAFKA
# ==========================================
KAFKA_SERVER = get_env_or_raise('KAFKA_BROKER')
TOPIC_RAW_TRADES = get_env_or_raise('KAFKA_TOPIC_RAW_TRADES')
TOPIC_KLINE_STREAM = get_env_or_raise('KAFKA_TOPIC_KLINE_STREAM')
TOPIC_PROCESSED_CANDLES = get_env_or_raise('KAFKA_TOPIC_PROCESSED_CANDLES')
TOPIC_UPDATING_CANDLES = get_env_or_raise('KAFKA_TOPIC_UPDATING_CANDLES')

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