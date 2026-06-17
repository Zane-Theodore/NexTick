# NexTick Backend

`backend/` is the NestJS API gateway for NexTick.

It validates public contracts, reads historical candles from QuestDB, exposes REST and Swagger, consumes processed kline updates from Kafka, and fans those updates out to browsers through Socket.IO rooms.

The backend is not an ingestion engine. It does not connect to Binance and does not own candle ingestion.

## Responsibilities

| Capability | Implementation |
| --- | --- |
| REST API | `AppController` and `CandlesController`. |
| Health check | `GET /health` returns `{ status, timestamp }`. |
| Historical candles | `GET /candles` queries QuestDB through `CandlesService`, filters invalid OHLCV rows, skips duplicate visible WAL versions, returns complete aggregate buckets where possible, and merges the recent realtime tail. |
| Swagger | Registered at `/api/docs` in `main.ts`. |
| Validation | Global `ValidationPipe` plus DTO classes for REST and Socket.IO payloads. |
| QuestDB access | `DatabaseService` uses `pg.Pool` over QuestDB PostgreSQL wire protocol. |
| Kafka consumption | `KafkaService` consumes `KAFKA_TOPIC_KLINE_STREAM` with KafkaJS. |
| Recent realtime cache | `RecentCandlesCacheService` stores up to 500 normalized kline updates per symbol/interval room. |
| Realtime fan-out | `CandlesGateway` emits Socket.IO `kline_update` events to symbol/interval rooms and replays cached tail data to new subscribers. |

## Source Structure

```text
backend/
|-- src/
|   |-- app.controller.ts
|   |-- app.controller.spec.ts
|   |-- app.module.ts
|   |-- app.service.ts
|   |-- common/
|   |   `-- logger.ts
|   |-- main.ts
|   `-- modules/
|       |-- candles/
|       |   |-- candles.controller.ts
|       |   |-- candle-normalization.ts
|       |   |-- candle-validation.ts
|       |   |-- candles.gateway.ts
|       |   |-- candles.module.ts
|       |   |-- candles.service.ts
|       |   |-- dto/
|       |   |-- enum/
|       |   `-- recent-candles-cache.service.ts
|       |-- database/
|       |   |-- database.module.ts
|       |   `-- database.service.ts
|       `-- kafka/
|           |-- kafka.module.ts
|           `-- kafka.service.ts
|-- test/
|   |-- app.e2e-spec.ts
|   `-- jest-e2e.json
|-- package.json
`-- README.md
```

## Local Setup

Start Docker infrastructure from the repository root before starting the backend:

```bash
docker compose up -d --build kafka kafka-ui kafka-setup questdb data-producer data-backfill data-processor
```

Create and fill the backend env file:

```bash
cd backend
cp .env.example .env
npm install
npm run start:dev
```

Windows PowerShell:

```powershell
cd backend
Copy-Item .env.example .env
npm install
npm run start:dev
```

The app opens QuestDB and Kafka connections during startup. If either service is unavailable or a required env value is blank, startup fails instead of running partially connected.

## Scripts

These scripts come from `backend/package.json`:

| Command | Purpose |
| --- | --- |
| `npm run start` | Start NestJS once. |
| `npm run start:dev` | Start NestJS in watch mode. |
| `npm run start:debug` | Start NestJS in debug watch mode. |
| `npm run start:prod` | Run `dist/main` after a build. |
| `npm run build` | Compile the backend. |
| `npm run format` | Run Prettier over `src/**/*.ts` and `test/**/*.ts`. |
| `npm run lint` | Run ESLint with `--fix`. |
| `npm run test` | Run unit specs under `src`. |
| `npm run test:watch` | Run Jest in watch mode. |
| `npm run test:cov` | Run Jest with coverage. |
| `npm run test:e2e` | Run e2e tests from `test/jest-e2e.json`. |

## Environment Variables

These names match `backend/.env.example` and current code. The example file intentionally contains blank values; local `.env` must be filled before startup.

| Variable | Required | Example | Used by |
| --- | --- | --- | --- |
| `QUESTDB_HOST` | Yes | `localhost` | `DatabaseService` |
| `QUESTDB_PORT` | Yes | `8812` | `DatabaseService` |
| `QUESTDB_USER` | Yes | `admin` | `DatabaseService` |
| `QUESTDB_PASSWORD` | Yes | `quest` | `DatabaseService` |
| `QUESTDB_DB_NAME` | Yes | `qdb` | `DatabaseService` |
| `QUESTDB_POOL_MAX` | Yes | `10` | `pg.Pool.max` |
| `QUESTDB_POOL_TIMEOUT` | Yes | `5000` | `pg.Pool.connectionTimeoutMillis` |
| `QUESTDB_POOL_IDLE_TIMEOUT` | Yes | `30000` | `pg.Pool.idleTimeoutMillis` |
| `KAFKA_BROKER` | Yes | `localhost:9092` | KafkaJS broker list, split by comma. |
| `KAFKA_TOPIC_KLINE_STREAM` | Yes | `kline-stream` | Kafka topic consumed by the backend. |
| `KAFKA_CLIENT_ID` | Yes | `nextick-backend` | KafkaJS client id. |
| `KAFKA_GROUP_ID` | Yes | `nextick-backend-group` | Kafka consumer group id. |
| `PORT` | Yes | `3000` | NestJS listen port. |
| `FRONTEND_URL` | Yes | `http://localhost:5173` | REST CORS and Socket.IO CORS allowlist. |
| `BACKEND_URL` | Yes | `http://localhost:3000` | Log output and Socket.IO CORS allowlist. |

## REST Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/` | Returns `Hello World!`. |
| `GET` | `/health` | Returns service health metadata. |
| `GET` | `/candles` | Returns historical candle data from QuestDB. |

Swagger UI:

```text
http://localhost:3000/api/docs
```

### `GET /health`

Example:

```bash
curl "http://localhost:3000/health"
```

Response:

```json
{
  "status": "ok",
  "timestamp": "2026-05-20T08:00:00.000Z"
}
```

### `GET /candles`

Example:

```bash
curl "http://localhost:3000/candles?symbol=BTCUSDT&interval=1m&limit=100"
```

Query parameters:

| Parameter | Required | Default | Validation |
| --- | --- | --- | --- |
| `symbol` | Yes | None | String, not empty, transformed to uppercase by DTO. |
| `interval` | No | `1m` | Must be one of `VALID_INTERVALS`. |
| `limit` | No | `100` | Integer from `1` to `2000`. |

Supported intervals:

```text
1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M
```

Response shape:

```json
{
  "success": true,
  "symbol": "BTCUSDT",
  "interval": "1m",
  "count": 1,
  "data": [
    {
      "timestamp": "2026-05-20T08:00:00.000Z",
      "symbol": "BTCUSDT",
      "interval": "1m",
      "open": 105000.5,
      "high": 105250.75,
      "low": 104900.25,
      "close": 105120.1,
      "volume": 12.34567
    }
  ]
}
```

## QuestDB Query Behavior

`CandlesService` reads from `market_candles`, where the pipeline stores final `1m` candles.

The backend reads a bounded time window from stored `1m` rows, filters invalid
OHLCV values, skips any `1m` timestamp that still has duplicate visible WAL
versions, and only returns fixed-size aggregate buckets after all expected
minute rows are present. The `1M` interval is the exception: it uses QuestDB's
calendar month buckets without a fixed minute-count filter because month length
varies.

```sql
WITH candidate_1m AS (
  SELECT
    timestamp,
    symbol,
    interval,
    last(open) AS open,
    last(high) AS high,
    last(low) AS low,
    last(close) AS close,
    last(volume) AS volume,
    count() AS version_count
  FROM market_candles
  WHERE symbol = $1
    AND interval = '1m'
    AND timestamp >= $2
    AND timestamp < $3
    AND open > 0
    AND high > 0
    AND low > 0
    AND close > 0
    AND volume >= 0
    AND high >= open
    AND high >= close
    AND low <= open
    AND low <= close
    AND high >= low
  SAMPLE BY 1m ALIGN TO CALENDAR
),
stable_1m AS (
  SELECT timestamp, symbol, interval, open, high, low, close, volume
  FROM candidate_1m
  WHERE version_count = 1
),
aggregated AS (
  SELECT
    timestamp,
    symbol,
    '${interval}' AS interval,
    first(open) AS open,
    max(high) AS high,
    min(low) AS low,
    last(close) AS close,
    sum(volume) AS volume,
    count() AS minute_count
  FROM stable_1m
  SAMPLE BY ${interval} ALIGN TO CALENDAR
)
SELECT
  timestamp,
  symbol,
  interval,
  open,
  high,
  low,
  close,
  volume
FROM aggregated
WHERE minute_count = ${expectedOneMinuteCount}
ORDER BY timestamp DESC
LIMIT $4;
```

The query window is `max(interval_ms * limit * 2, 24h)`. The service reverses
returned rows so API clients receive candles from oldest to newest, converts
QuestDB timestamps to ISO strings, filters any invalid computed candles, merges
the in-memory recent realtime cache, trims to `limit`, and logs duplicate or
missing candle gaps.

Security notes:

| Concern | Current handling |
| --- | --- |
| `interval` SQL fragment | Checked against `VALID_INTERVALS` before interpolation into `SAMPLE BY`. |
| `symbol` | Uppercased by room/update normalization; REST history symbols are stripped to `[A-Z0-9]`, then passed as `$1`. |
| `limit` | DTO-constrained to `1..2000`, then passed as `$4`. |

## Kafka Consumer Behavior

`KafkaService`:

1. Creates a KafkaJS client with `KAFKA_CLIENT_ID` and `KAFKA_BROKER`.
2. Creates one consumer with `KAFKA_GROUP_ID`.
3. Subscribes to `KAFKA_TOPIC_KLINE_STREAM` with `fromBeginning: false`.
4. Parses each message as JSON.
5. Skips empty values and messages missing required candle fields.
6. Normalizes timestamps, symbols, and numeric OHLCV fields before validation.
7. Emits an internal `candle.update` event through `EventEmitter2`.

The backend consumes processed candle updates only. It does not consume Binance market streams directly.

## Socket.IO Events

Room format:

```text
{SYMBOL}_{interval}
```

Example:

```text
BTCUSDT_1m
```

| Event | Direction | Payload | Behavior |
| --- | --- | --- | --- |
| `join_kline_room` | Client to server | `{ "symbol": "BTCUSDT", "interval": "1m" }` | Joins the socket to `BTCUSDT_1m` and sends cached tail candles for that room. |
| `leave_kline_room` | Client to server | `{ "symbol": "BTCUSDT", "interval": "1m" }` | Leaves the matching room. |
| `kline_update` | Server to client | `KlineUpdateDto` | Sent to the room matching the candle symbol and interval. |

`kline_update` payload:

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

Socket.IO CORS allows `BACKEND_URL`, `FRONTEND_URL`, and requests without an `origin`. REST CORS allows `FRONTEND_URL`.

## DTO Validation

| Contract | DTO |
| --- | --- |
| REST candle query | `CandlesQueryDto` |
| REST candle item | `CandleDto` |
| REST candle response | `CandlesResponseDto` |
| Socket room payload | `KlineRoomPayloadDto` |
| Realtime candle update | `KlineUpdateDto` |

`candle-normalization.ts` centralizes symbol, room-key, timestamp, and Kafka
update normalization. `candle-validation.ts` parses numeric values from
QuestDB/Kafka and rejects invalid OHLCV shapes before the backend returns or
emits candles.

The app enables a global pipe:

```ts
new ValidationPipe({
  whitelist: true,
  transform: true,
})
```

Socket gateway payloads also use `ValidationPipe`.

## Tests

Current test coverage is focused on NestJS service/controller/gateway behavior:

| Area | Files |
| --- | --- |
| App root and health | `src/app.controller.spec.ts`, `test/app.e2e-spec.ts` |
| Candles API and service | `src/modules/candles/*.spec.ts` |
| Database provider | `src/modules/database/database.service.spec.ts` |
| Kafka consumer | `src/modules/kafka/kafka.service.spec.ts` |

Run:

```bash
npm run test
npm run test:e2e
```

## Security and Boundary Notes

| Rule | Reason |
| --- | --- |
| Validate interval allowlist before SQL interpolation. | QuestDB `SAMPLE BY ${interval}` is a SQL fragment and cannot be passed as a scalar parameter. |
| Parameterize scalar values. | `symbol`, `startTimestamp`, `endTimestamp`, and `limit` are passed as query parameters. |
| Do not expose Kafka or QuestDB to browsers. | Browsers should use NestJS REST and Socket.IO only. |
| Do not ingest Binance in the backend. | Binance ingestion belongs to the Python producer. |
| Do not ingest Binance streams in the backend. | Binance stream handling belongs to the Python pipeline. |
| Keep AI/model work outside the API request path. | Future forecasting should consume Kafka or QuestDB through explicit contracts. |
