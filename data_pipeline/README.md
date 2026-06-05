# NexTick Data Pipeline

`data_pipeline/` is the Python market-data write path for NexTick.

It connects to Binance combined trade streams, publishes normalized raw trades to Kafka, aggregates OHLCV candles in memory, writes final `1m` candles to QuestDB, and publishes final plus non-final candle updates for downstream consumers.

This module does not expose browser APIs, render UI, or run the NestJS backend.

## Components

| Component | Role |
| --- | --- |
| `producer/binance_producer.py` | Runs `BinanceCombinedProducer`, connects to Binance trade streams, validates raw trade price/volume, and publishes cleaned trades to Kafka. |
| `processor/candle_processor.py` | Runs `CandleProcessor`, consumes raw trades, aggregates candles by symbol/interval, writes final `1m` candles to QuestDB, and publishes kline updates. |
| `candle_reconciler.py` | Maintenance script that replaces a closed `1m` candle window from Binance REST klines with backup, staging, and verification. |
| `config.py` | Loads `data_pipeline/.env`, validates required config, parses symbols and intervals. |
| `logger_config.py` | Configures stdout logging with timestamp, level, module name, and message. |

## Run with Docker Compose

From the repository root:

```bash
cp data_pipeline/.env.example data_pipeline/.env
```

Windows PowerShell:

```powershell
Copy-Item data_pipeline\.env.example data_pipeline\.env
```

Fill `data_pipeline/.env`, then start the infrastructure and pipeline:

```bash
docker compose up -d --build kafka kafka-ui kafka-setup questdb data-processor data-producer
```

Compose behavior:

| Service | Behavior |
| --- | --- |
| `kafka` | Runs a single KRaft Kafka broker with internal listener `kafka:29092` and host listener `localhost:9092`. |
| `kafka-ui` | Exposes topic and consumer inspection at `http://localhost:8080`. |
| `kafka-setup` | Reads `data_pipeline/.env`, waits for Kafka, creates raw trade and kline topics with 3 partitions. |
| `questdb` | Exposes the web console on `9000` and PostgreSQL wire on `8812`. |
| `data-processor` | Overrides `KAFKA_BROKER=kafka:29092` and `QUESTDB_HOST=questdb`, waits for QuestDB, then runs `python -m data_pipeline.processor.candle_processor`. |
| `data-producer` | Overrides `KAFKA_BROKER=kafka:29092`, starts after Kafka setup and the processor, then runs `python -m data_pipeline.producer.binance_producer`. |

Check logs:

```bash
docker compose logs -f data-producer data-processor
```

## Run Manually

Use this mode when Kafka and QuestDB run in Docker but the Python producer and processor run on the host.

Start infrastructure only:

```bash
docker compose up -d kafka kafka-ui kafka-setup questdb
```

Create a virtual environment from the repository root:

```bash
python -m venv .venv
```

Windows PowerShell, processor terminal:

```powershell
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m data_pipeline.processor.candle_processor
```

Windows PowerShell, producer terminal:

```powershell
.\.venv\Scripts\Activate.ps1
python -m data_pipeline.producer.binance_producer
```

macOS/Linux, processor terminal:

```bash
source .venv/bin/activate
pip install -r requirements.txt
python -m data_pipeline.processor.candle_processor
```

macOS/Linux, producer terminal:

```bash
source .venv/bin/activate
python -m data_pipeline.producer.binance_producer
```

## Reconcile Recent Candles

Run this maintenance script when you want to replace the last closed 24 hours of
stored `1m` candles with Binance REST klines. It excludes the currently
streaming `1m` candle, validates the full Binance window before touching
QuestDB, builds a replacement table, verifies it, and swaps it into
`market_candles` with QuestDB `RENAME TABLE`. This avoids `DELETE`, `UPDATE`,
and historical inserts on the current `BYPASS WAL` table.
After a successful run it drops its current old/replacement tables and also
cleans up old reconciler temporary tables from previous runs. Use `--keep-temp`
only when you intentionally want to inspect those temporary tables.

The current reconcile window is fixed in code at 24 hours and intentionally
ends 30 minutes behind the latest Binance server minute. This lag keeps the
script away from candles that the live processor is still closing while the
replacement table is being built. Running the script again later reconciles
those newer candles after they move out of the lag window.
The script uses Binance server time for the window boundary, so it expects
exactly 1440 closed `1m` candles from
`[server_minute - lag - 24h, server_minute - lag)`.
When it starts inside the first seconds of a fresh minute, it waits briefly
before resolving the final window to avoid racing the live processor at the
minute boundary.

Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
python -m data_pipeline.candle_reconciler
```

macOS/Linux:

```bash
source .venv/bin/activate
python -m data_pipeline.candle_reconciler
```

Useful options:

```bash
python -m data_pipeline.candle_reconciler --dry-run
python -m data_pipeline.candle_reconciler --symbols BTCUSDT,ETHUSDT
python -m data_pipeline.candle_reconciler --keep-temp
```

The script reads QuestDB connection settings and `TRADING_SYMBOLS` from
`data_pipeline/.env`. `BINANCE_REST_URL` is optional and defaults to
`https://api.binance.com`.

## Environment Variables

These names match `data_pipeline/.env.example` and `config.py`. The example file intentionally contains blank values; local `.env` must be filled before startup.

| Variable | Required by code | Example | Notes |
| --- | --- | --- | --- |
| `QUESTDB_HOST` | Yes | `localhost` | Use `questdb` inside the Compose network. |
| `QUESTDB_PORT` | Yes | `8812` | PostgreSQL wire port. |
| `QUESTDB_USER` | Yes | `admin` | QuestDB user. |
| `QUESTDB_PASSWORD` | Yes | `quest` | QuestDB password. |
| `QUESTDB_DB_NAME` | Yes | `qdb` | QuestDB database name. |
| `KAFKA_BROKER` | Yes | `localhost:9092` | Use `kafka:29092` inside the Compose network. |
| `KAFKA_TOPIC_RAW_TRADES` | Yes | `raw-trades` | Topic for normalized raw trades. |
| `KAFKA_TOPIC_KLINE_STREAM` | Yes | `kline-stream` | Topic for candle updates. |
| `BINANCE_SOCKET_URL` | Yes | `wss://stream.binance.com:9443/stream` | Base Binance WebSocket endpoint used to build the combined stream URL. |
| `TRADING_SYMBOLS` | Effectively required in `.env` | `BTCUSDT,ETHUSDT` | If unset, defaults to `BTCUSDT`; if present but blank, no symbols are produced. |
| `CANDLE_INTERVALS` | Effectively required in `.env` | `1m,3m,5m,15m,30m,1h` | If unset, defaults to all supported intervals; if present but blank, no interval managers are created. |
| `CANDLE_UPDATE_INTERVAL_MS` | No | `500` | Defaults to `500`. Controls non-final candle publish cadence. |

Supported intervals:

```text
1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M
```

## Kafka Topics

| Topic env | Producer | Consumer | Payload |
| --- | --- | --- | --- |
| `KAFKA_TOPIC_RAW_TRADES` | `BinanceCombinedProducer` | `CandleProcessor` | Normalized trade JSON. |
| `KAFKA_TOPIC_KLINE_STREAM` | `CandleProcessor` | NestJS backend | Candle update JSON with `is_final`. |

Compose creates both topics with 3 partitions and replication factor `1`. The Kafka key is the candle or trade `symbol`, so records for a symbol stay partition-consistent.

## Raw Trade Message Contract

The producer publishes this shape to `KAFKA_TOPIC_RAW_TRADES`. The Kafka key is `symbol`.

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

Field source:

| Field | Source |
| --- | --- |
| `symbol` | Binance trade field `s`, uppercased. |
| `trade_id` | Binance trade field `t`. |
| `timestamp` | Binance trade field `T`, milliseconds since Unix epoch. |
| `price` | Binance trade field `p`, converted to number. |
| `volume` | Binance trade field `q`, converted to number. |
| `is_buyer_maker` | Binance trade field `m`. |

Trades with `price <= 0` or `volume <= 0` are dropped.

## Kline Message Contract

The processor publishes this shape to `KAFKA_TOPIC_KLINE_STREAM`. The Kafka key is `symbol`.

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

`is_final=false` means the active candle is still updating. `is_final=true` means a trade crossed into a new interval and the previous candle is closed.

Only final `1m` candles are inserted into QuestDB by the current code.

## Candle Aggregation

`SingleCandleManager` keeps only the active candle for one symbol and interval.

For each trade:

| Field | Update rule |
| --- | --- |
| `open` | Set once when a new candle starts. |
| `high` | `max(current_high, trade_price)`. |
| `low` | `min(current_low, trade_price)`. |
| `close` | Set to the latest trade price. |
| `volume` | Add the latest trade volume. |
| `is_final` | Added when publishing. `true` for closed candles, `false` for timer-based active candle updates. |

`MultiTimeframeManager` owns one `SingleCandleManager` per configured interval for a symbol. It emits non-final candles every `CANDLE_UPDATE_INTERVAL_MS`.

The processor does not keep a historical trade buffer to update active candles.

## QuestDB Schema

`CandleProcessor` creates this table on startup:

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

Insert behavior:

| Rule | Current behavior |
| --- | --- |
| Stored candles | Final `1m` candles only. |
| Insert method | `psycopg2` through QuestDB PostgreSQL wire protocol. |
| Values | Bound as query parameters. |
| Offset commit | `consumer.commit()` runs after the insert succeeds. |
| Failed insert | Retries 3 times; if still failing, the final `1m` candle is not published to the kline topic. |

## Timestamp and Timezone Rules

| Boundary | Format |
| --- | --- |
| Binance input | Milliseconds since Unix epoch from trade field `T`. |
| Python processing | UTC-aware `datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc)`. |
| Candle interval boundary | Truncated from the UTC `datetime`. |
| Kafka kline output | ISO 8601 from `datetime.isoformat()`, for example `2026-05-20T08:00:00+00:00`. |
| QuestDB insert | `%Y-%m-%d %H:%M:%S` string. |

The processor skips records with missing fields, non-positive price/volume, or timestamps before year 2020.

## Failure Handling

| Failure | Current behavior |
| --- | --- |
| Kafka producer or consumer not ready | Retry with exponential backoff, up to 60 attempts. |
| Binance WebSocket closes or network drops | Reconnect with exponential backoff, up to 10 attempts. |
| Invalid Binance payload | Log and skip. |
| Invalid raw trade in processor | Skip if symbol, timestamp, price, or volume is missing or invalid. |
| QuestDB connection startup fails | Processor startup fails. |
| QuestDB insert fails | Retry 3 times, log failure, skip final publish for that persisted `1m` candle. |
| Kafka kline publish fails | Retry publish, then log failure. |

## Boundary

The data pipeline communicates through Kafka topics and QuestDB only.

It does not:

| Not owned here | Owner |
| --- | --- |
| Browser API | NestJS backend |
| Frontend UI | React frontend |
| REST validation and Swagger | NestJS backend |
| Socket.IO fan-out | NestJS backend |
| AI forecasting request path | Future isolated service |

Future replay buffers, model training, online learning, and forecasting services should consume Kafka or QuestDB contracts. They should not depend on `CandleProcessor` in-memory state.
