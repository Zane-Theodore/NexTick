# NexTick Data Pipeline

Python streaming pipeline for Binance ingestion, O(1) candle aggregation, Kafka publishing, and QuestDB persistence.

This layer owns the market-data write path. It connects to Binance, normalizes raw trades, publishes them to Kafka, aggregates OHLCV candles with constant-memory state, stores final `1m` candles in QuestDB, and publishes final plus non-final candle updates for realtime consumers.

## Responsibilities

| Component | Role |
| --- | --- |
| `producer/binance_producer.py` | Connects to Binance combined trade streams and publishes normalized raw trades to Kafka. |
| `processor/candle_processor.py` | Consumes raw trades, aggregates multi-timeframe candles, persists final `1m` candles, and publishes kline updates. |
| `config.py` | Loads and validates required environment variables from `data_pipeline/.env`. |
| `logger_config.py` | Provides structured logger setup for pipeline services. |

## Setup

Create and activate a Python virtual environment:

```bash
python -m venv .venv
```

Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
```

macOS/Linux:

```bash
source .venv/bin/activate
```

Install dependencies from the repository root:

```bash
pip install -r requirements.txt
```

Create the environment file:

```bash
cp data_pipeline/.env.example data_pipeline/.env
```

Start Kafka and QuestDB:

```bash
docker compose up -d kafka kafka-ui kafka-setup questdb
```

Run the processor:

```bash
python -m data_pipeline.processor.candle_processor
```

Run the Binance producer:

```bash
python -m data_pipeline.producer.binance_producer
```

Docker Compose can also run the pipeline services:

```bash
docker compose up -d data-processor data-producer
```

## Environment Variables

| Variable | Required | Example | Description |
| --- | --- | --- | --- |
| `BINANCE_SOCKET_URL` | Yes | `wss://stream.binance.com:9443/stream` | Binance WebSocket base URL. The current producer builds a combined stream URL from `TRADING_SYMBOLS`. |
| `TRADING_SYMBOLS` | No | `BTCUSDT,ETHUSDT` | Comma-separated symbols to ingest. Defaults to `BTCUSDT` in `config.py` when not provided. |
| `CANDLE_INTERVALS` | No | `1m,5m,15m,1h` | Comma-separated candle intervals managed by `MultiTimeframeManager`. Defaults to `1m,5m`. |
| `CANDLE_UPDATE_INTERVAL_MS` | No | `500` | Periodic non-final candle broadcast interval in milliseconds. Defaults to `500`. |
| `KAFKA_BROKER` | Yes | `localhost:9092` | Kafka bootstrap server. Use `kafka:29092` inside Docker Compose services. |
| `KAFKA_TOPIC_RAW_TRADES` | Yes | `raw-trades` | Topic receiving normalized raw Binance trade records. |
| `KAFKA_TOPIC_KLINE_STREAM` | Yes | `kline-stream` | Topic receiving final and non-final candle updates. |
| `QUESTDB_HOST` | Yes | `localhost` | QuestDB host. Use `questdb` inside Docker Compose services. |
| `QUESTDB_PORT` | Yes | `8812` | QuestDB PostgreSQL wire port. |
| `QUESTDB_USER` | Yes | `admin` | QuestDB user. |
| `QUESTDB_PASSWORD` | Yes | `quest` | QuestDB password. |
| `QUESTDB_DB_NAME` | Yes | `qdb` | QuestDB database name. |

## BinanceCombinedProducer

`BinanceCombinedProducer` is the ingestion entry point.

It:

1. Reads `TRADING_SYMBOLS`.
2. Builds a Binance combined stream URL:

```text
wss://stream.binance.com:9443/stream?streams={symbol}@trade/{symbol}@trade
```

3. Normalizes Binance trade payloads into the internal raw trade contract:

```json
{
  "symbol": "BTCUSDT",
  "trade_id": 123456789,
  "timestamp": 1779254400000,
  "price": 105000.5,
  "volume": 0.125,
  "is_buyer_maker": false
}
```

4. Publishes valid records to `KAFKA_TOPIC_RAW_TRADES` with the symbol as the Kafka key.

Operational behavior:

| Concern | Behavior |
| --- | --- |
| Kafka startup | Retries producer creation with exponential backoff. |
| Binance disconnects | Reconnects with bounded exponential backoff. |
| Invalid trades | Drops zero or negative price/volume records. |
| Publish failures | Logs asynchronous and immediate Kafka publish failures. |

## CandleProcessor

`CandleProcessor` is the aggregation and storage entry point.

It:

1. Consumes raw trades from `KAFKA_TOPIC_RAW_TRADES`.
2. Converts Binance millisecond timestamps into UTC-aware Python `datetime` values.
3. Creates one `MultiTimeframeManager` per symbol.
4. Updates each configured `SingleCandleManager` in O(1) time.
5. Broadcasts non-final candles every `CANDLE_UPDATE_INTERVAL_MS`.
6. Persists final `1m` candles to QuestDB.
7. Publishes final and non-final candles to `KAFKA_TOPIC_KLINE_STREAM`.

### O(1) Aggregation

`SingleCandleManager` stores only the active candle for a symbol/timeframe. Each trade updates:

| Field | Update Rule |
| --- | --- |
| `open` | Set once when the interval starts. |
| `high` | `max(current_high, trade_price)` |
| `low` | `min(current_low, trade_price)` |
| `close` | Latest trade price. |
| `volume` | Running sum of trade volume. |

No historical trade buffer is required for active candle updates.

### Published Kline Contract

```json
{
  "timestamp": "2026-05-20T08:00:00+00:00",
  "symbol": "BTCUSDT",
  "interval": "1m",
  "open": 105000.5,
  "high": 105250.75,
  "low": 104900.25,
  "close": 105120.1,
  "volume": 12.34567,
  "is_final": false
}
```

`is_final=false` updates are for realtime UI movement. `is_final=true` updates represent closed candles. Only final `1m` candles are written to QuestDB.

## QuestDB Schema

The processor verifies and creates the canonical candle table:

```sql
CREATE TABLE IF NOT EXISTS market_candles (
  symbol SYMBOL,
  interval SYMBOL,
  timestamp TIMESTAMP,
  open DOUBLE,
  high DOUBLE,
  low DOUBLE,
  close DOUBLE,
  volume DOUBLE
) TIMESTAMP(timestamp) PARTITION BY MONTH BYPASS WAL;
```

Storage rules:

| Rule | Description |
| --- | --- |
| Authoritative table | `market_candles` |
| Persisted interval | Final `1m` candles only |
| Higher intervals | Derived by backend QuestDB `SAMPLE BY ... ALIGN TO CALENDAR` queries |
| SQL casing | QuestDB keywords should be uppercase; table and column names should be lowercase snake_case. |
| Inserts | Use parameter binding for candle values. |

## Timestamp and Timezone Rules

Timestamps cross multiple boundaries and must remain explicit.

| Boundary | Format |
| --- | --- |
| Binance trade input | Milliseconds since Unix epoch from Binance trade field `T`. |
| Python processing | UTC-aware `datetime` via `datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc)`. |
| Kafka kline output | ISO 8601 string from `datetime.isoformat()`. |
| QuestDB insert | Explicit timestamp string formatted as `%Y-%m-%d %H:%M:%S`. |
| Backend/frontend output | ISO 8601 string. |

Do not pass ambiguous naive datetimes between layers. Invalid or suspicious timestamps should be dropped and logged before they reach QuestDB.

## Local Operations

Inspect Kafka topics in Kafka UI:

```text
http://localhost:8080
```

Inspect QuestDB:

```text
http://localhost:9000
```

Query stored candles:

```sql
SELECT *
FROM market_candles
WHERE symbol = 'BTCUSDT'
ORDER BY timestamp DESC
LIMIT 20;
```

Aggregate `1m` storage into higher intervals:

```sql
SELECT
  timestamp,
  symbol,
  first(open) AS open,
  max(high) AS high,
  min(low) AS low,
  last(close) AS close,
  sum(volume) AS volume
FROM market_candles
WHERE symbol = 'BTCUSDT' AND interval = '1m'
SAMPLE BY 5m ALIGN TO CALENDAR
ORDER BY timestamp DESC
LIMIT 100;
```

## Pipeline Boundary

The data pipeline should not expose browser APIs or run frontend/backend presentation logic. It communicates through Kafka topics and QuestDB only. Future AI services should consume from Kafka or QuestDB and publish forecasts to dedicated topics or storage contracts, never by coupling directly to this processor's in-memory state.

