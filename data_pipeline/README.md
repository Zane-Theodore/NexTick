# NexTick Data Pipeline

`data_pipeline/` is the Python market-data write path for NexTick.

It connects to Binance combined trade streams, publishes normalized raw trades to Kafka, aggregates OHLCV candles in memory, writes final `1m` candles to QuestDB, and publishes final plus non-final candle updates for downstream consumers.

This module does not expose browser APIs, render UI, or run the NestJS backend.

## Components

| Component | Role |
| --- | --- |
| `producer/binance_producer.py` | Runs `BinanceCombinedProducer`, connects to Binance trade streams, validates raw trade price/volume, and publishes cleaned trades to Kafka. |
| `processor/candle_processor.py` | Runs `CandleProcessor`, consumes raw trades, aggregates candles by symbol/interval, writes final `1m` candles to QuestDB, and publishes kline updates. |
| `processor/runner.py` | Processor service entrypoint with signal handling and health marker management. |
| `backfill/runner.py` | Startup backfill service entrypoint with retry policy and failure behavior. |
| `backfill/reconciler.py` | Maintenance script that validates Binance REST klines and replaces a closed `1m` candle window in QuestDB. |
| `backfill/recent_runner.py` | Optional periodic recent closed-candle reconciler used by the Compose `maintenance` profile. |
| `backfill/state.py` | Shared backfill watermark reader/writer used by backfill and processor services. |
| `common/config.py` | Loads `data_pipeline/.env`, validates required config, parses symbols and intervals. |
| `common/logger.py` | Configures stdout logging with timestamp, level, module name, and message. |

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
docker compose up -d --build kafka kafka-ui kafka-setup questdb data-producer data-backfill data-processor
```

Compose behavior:

| Service | Behavior |
| --- | --- |
| `kafka` | Runs a single KRaft Kafka broker with internal listener `kafka:29092` and host listener `localhost:9092`. |
| `kafka-ui` | Exposes topic and consumer inspection at `http://localhost:8080`. |
| `kafka-setup` | Reads `data_pipeline/.env`, waits for Kafka, creates raw trade and kline topics with 3 partitions. |
| `questdb` | Exposes the web console on `9000` and PostgreSQL wire on `8812`. |
| `data-producer` | Overrides `KAFKA_BROKER=kafka:29092`, starts as soon as Kafka topics exist, then streams live Binance trades into Kafka. |
| `data-backfill` | Runs `data_pipeline.backfill.runner`, repairs the closed startup window, and writes a shared watermark. |
| `data-processor` | Starts after `data-backfill` completes, drains buffered raw trades, and skips DB upserts for candles before the watermark. |
| `data-recent-reconcile` | Optional `maintenance` profile service that runs periodic recent closed-candle repair when `RECENT_RECONCILE_ENABLED=true`. |

Check logs:

```bash
docker compose logs -f data-producer data-backfill data-processor
```

Start the optional recent closed-candle reconciler:

```bash
docker compose --profile maintenance up -d data-recent-reconcile
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

Windows PowerShell, producer terminal:

```powershell
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m data_pipeline.producer.binance_producer
```

Windows PowerShell, backfill terminal:

```powershell
.\.venv\Scripts\Activate.ps1
python -m data_pipeline.backfill.runner
```

Windows PowerShell, processor terminal:

```powershell
.\.venv\Scripts\Activate.ps1
python -m data_pipeline.processor.runner
```

macOS/Linux, producer terminal:

```bash
source .venv/bin/activate
pip install -r requirements.txt
python -m data_pipeline.producer.binance_producer
```

macOS/Linux, backfill terminal:

```bash
source .venv/bin/activate
python -m data_pipeline.backfill.runner
```

macOS/Linux, processor terminal:

```bash
source .venv/bin/activate
python -m data_pipeline.processor.runner
```

## Reconcile Recent Candles

At normal Docker startup, `data-producer` starts first and buffers raw trades in
Kafka. `data-backfill` then runs `data_pipeline.backfill.runner` as a separate
one-shot service before `data-processor` starts. After backfill succeeds, the
processor reads the shared `STARTUP_BACKFILL_STATE_FILE` watermark and refuses
to upsert final `1m` candles older than that watermark while it drains the Kafka
backlog.

Run `data_pipeline.backfill.reconciler` directly when you want to repair recent
missing or incorrect stored `1m` candles outside normal startup. The normal path
validates a bounded Binance window, builds a replacement table that excludes
stale rows in that window, and swaps it into `market_candles` before the
processor starts.

If a previous failed run dropped `market_candles` but left a
`market_candles_old_*` backup table, startup recovery recreates `market_candles`
from the newest backup before continuing. If replacement verification or swap
verification fails, rollback recreates `market_candles` from the full backup.
After a successful run it drops its current old/replacement/staging tables and
also cleans up old reconciler temporary tables from previous runs. Use
`--keep-temp` only when you intentionally want to inspect those temporary
tables.

The default startup reconcile window is 24 hours and ends at Binance's current
minute floor, so it includes every closed candle and excludes only the currently
open minute. The script runs one pass only; it does not chase newly closed tail
candles while the processor is live. With defaults, each
symbol expects exactly 1440 closed `1m` candles from
`[safe_end - 24h, safe_end)`, where `safe_end = current_minute_floor`.
When it starts inside the first seconds of a fresh minute, it waits briefly
before resolving the window to avoid unstable exchange boundaries.

Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
python -m data_pipeline.backfill.reconciler
```

macOS/Linux:

```bash
source .venv/bin/activate
python -m data_pipeline.backfill.reconciler
```

Useful options:

```bash
python -m data_pipeline.backfill.reconciler --dry-run
python -m data_pipeline.backfill.reconciler --symbols BTCUSDT,ETHUSDT
python -m data_pipeline.backfill.reconciler --window-hours 24 --end-lag-minutes 2
python -m data_pipeline.backfill.reconciler --keep-temp
```

The script reads QuestDB connection settings and `TRADING_SYMBOLS` from
`data_pipeline/.env`. `BINANCE_REST_URL` is optional and defaults to
`https://api.binance.com`.

Operational notes:

| Behavior | Detail |
| --- | --- |
| Startup order | `data-producer` runs continuously, `data-backfill` completes, then `data-processor` starts. |
| Startup failure | `data-backfill` retries according to `STARTUP_RECONCILE_MAX_ATTEMPTS`; with `STARTUP_RECONCILE_REQUIRED=true`, `data-processor` does not start if backfill fails. |
| Manual full repair | Stop `data-processor` before running any repair workflow that drops, recreates, or migrates `market_candles`. |
| Reconcile end | The startup run fills one 24-hour window and writes the exclusive end timestamp to `STARTUP_BACKFILL_STATE_FILE`. |
| Backup names | Full backups use `market_candles_old_<SYMBOL>_<RUN_ID>`. |
| Replacement names | Replacement tables use `market_candles_replace_<SYMBOL>_<RUN_ID>`. |
| Recovery | If `market_candles` is missing and an old backup exists, the script restores from the newest backup automatically. |

## Environment Variables

These names match `data_pipeline/.env.example` and `common/config.py`. The example file intentionally contains blank values; local `.env` must be filled before startup.

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
| `STARTUP_RECONCILE_ENABLED` | No | `true` | Runs the standalone startup backfill service when enabled. |
| `STARTUP_RECONCILE_REQUIRED` | No | `true` | Blocks processor startup if startup backfill fails after all retries. |
| `STARTUP_RECONCILE_MAX_ATTEMPTS` | No | `3` | Number of startup reconciliation attempts before applying the failure policy. |
| `STARTUP_RECONCILE_RETRY_DELAY_SECONDS` | No | `5` | Initial startup reconciliation retry delay with exponential backoff capped at 60 seconds. |
| `STARTUP_RECONCILE_SYMBOLS` | No | `BTCUSDT,ETHUSDT` | Optional startup-only symbol override; defaults to `TRADING_SYMBOLS`. |
| `STARTUP_RECONCILE_DRY_RUN` | No | `false` | Validates Binance data at startup without writing QuestDB when true. |
| `STARTUP_RECONCILE_KEEP_TEMP` | No | `false` | Keeps startup reconciliation temp tables for inspection when true. |
| `STARTUP_RECONCILE_BINANCE_REST_URL` | No | `https://api.binance.com` | Optional startup-only REST endpoint override. |
| `STARTUP_RECONCILE_TOLERANCE` | No | `0.00000001` | Optional startup verification tolerance override. |
| `STARTUP_RECONCILE_WINDOW_HOURS` | No | `24` | Number of closed hours to fill in the one-shot startup pass. |
| `STARTUP_RECONCILE_END_LAG_MINUTES` | No | `0` | Optional lag behind Binance's current minute floor. Keep `0` for startup so DB has no handoff gap before the processor starts. |
| `STARTUP_RECONCILE_WAIT_FOR_OPEN_CANDLE_CLOSE` | No | `true` | Waits briefly near a fresh minute boundary before resolving the startup backfill window. |
| `STARTUP_BACKFILL_STATE_FILE` | No | `/tmp/nextick/startup-backfill.json` in Docker | Shared marker file containing the startup backfill watermark for the processor; blank uses the OS temp directory. |
| `RECENT_RECONCILE_ENABLED` | No | `false` | Enables the optional periodic recent closed-candle reconciler. |
| `RECENT_RECONCILE_INTERVAL_SECONDS` | No | `60` | Delay between recent reconciliation passes. |
| `RECENT_RECONCILE_LOOKBACK_MINUTES` | No | `15` | Recent closed window size repaired from Binance REST. |
| `RECENT_RECONCILE_END_LAG_MINUTES` | No | `3` | Lag behind the current minute for recent repair safety. |
| `RECENT_RECONCILE_INITIAL_DELAY_SECONDS` | No | `5` | Startup delay before the first recent reconciliation pass. |
| `RECENT_RECONCILE_WAL_APPLY_TIMEOUT_SECONDS` | No | `120` | Wait time for QuestDB WAL apply before optional verification. |
| `RECENT_RECONCILE_VERIFY_AFTER_WRITE` | No | `false` | Enables post-write verification for recent repair passes. |
| `RECENT_RECONCILE_SYMBOLS` | No | `BTCUSDT,ETHUSDT` | Optional recent-reconcile symbol override; defaults to `TRADING_SYMBOLS`. |
| `RECENT_RECONCILE_DRY_RUN` | No | `false` | Runs recent reconciliation without writing QuestDB. |
| `RECENT_RECONCILE_BINANCE_REST_URL` | No | `https://api.binance.com` | Optional recent-reconcile REST endpoint override. |
| `RECENT_RECONCILE_TOLERANCE` | No | `0.00000001` | Verification tolerance for recent reconciliation. |

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
) TIMESTAMP(timestamp)
PARTITION BY MONTH
DEDUP UPSERT KEYS(timestamp, symbol, interval);
```

Insert behavior:

| Rule | Current behavior |
| --- | --- |
| Stored candles | Final `1m` candles only. |
| Insert method | `psycopg2` through QuestDB PostgreSQL wire protocol into a WAL/dedup table, so inserts with the same timestamp/symbol/interval become upserts. |
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
