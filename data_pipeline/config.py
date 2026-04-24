# config.py

# ==========================================
# CẤU HÌNH KAFKA
# ==========================================
KAFKA_SERVER = 'localhost:9092'
TOPIC_RAW_TRADES = 'binance-raw-trades'
TOPIC_PROCESSED_CANDLES = 'processed-candles'

# ==========================================
# CẤU HÌNH QUESTDB
# ==========================================
QUESTDB_HOST = 'localhost'
QUESTDB_PORT = 8812
QUESTDB_USER = 'admin'
QUESTDB_PASSWORD = 'quest'
QUESTDB_DATABASE = 'qdb'

# ==========================================
# CẤU HÌNH BINANCE
# ==========================================
BINANCE_SOCKET_URL = "wss://stream.binance.com:9443/stream"
