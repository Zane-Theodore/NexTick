# NexTick Backend

`backend/` is NexTick's NestJS API gateway. It does not ingest Binance data or create candles. It reads history from QuestDB, receives processed klines from Kafka, and exposes REST and Socket.IO to browsers.

## Scope

| Capability | Implementation |
| --- | --- |
| REST | `GET /`, `GET /health`, `GET /candles`, and Swagger at `/api/docs`. |
| Candle history | `CandlesService` reads final `1m` candles from `market_candles` and aggregates them for the requested interval. |
| Real time | `KafkaService` consumes `kline-stream`, normalizes it, and emits an internal `candle.update` event. |
| Socket.IO | `CandlesGateway` caches then emits `kline_update` to `SYMBOL_interval` rooms. |
| Database | `DatabaseService` uses `pg.Pool` over the QuestDB PostgreSQL wire protocol. |

Browsers must not connect directly to Kafka or QuestDB.

## Run locally

First start Kafka, QuestDB, and the pipeline from the repository root as described in the [root README](../README.md). Create `backend/.env` from the example and fill every value:

```powershell
Copy-Item .env.example .env
npm install
npm run start:dev
```

Example local `.env`:

```env
QUESTDB_HOST=localhost
QUESTDB_PORT=8812
QUESTDB_USER=admin
QUESTDB_PASSWORD=quest
QUESTDB_DB_NAME=qdb
QUESTDB_POOL_MAX=10
QUESTDB_POOL_TIMEOUT=5000
QUESTDB_POOL_IDLE_TIMEOUT=30000
KAFKA_BROKER=localhost:9092
KAFKA_TOPIC_KLINE_STREAM=kline-stream
KAFKA_CLIENT_ID=nextick-backend
KAFKA_GROUP_ID=nextick-backend-group
PORT=3000
FRONTEND_URL=http://localhost:5173
BACKEND_URL=http://localhost:3000
```

The backend starts even when Kafka or QuestDB is temporarily unavailable. It retries each dependency in the background every five seconds and exposes a degraded health status until both reconnect. Existing requests to `/candles` can still fail while QuestDB is down, but the Node process remains alive.

## API

| Method | Path | Result |
| --- | --- | --- |
| `GET` | `/` | The string `Hello World!`. |
| `GET` | `/health` | Returns dependency status; uses `200` when both are available and `503` while either is reconnecting. |
| `GET` | `/candles` | Validated historical OHLCV data. |

Swagger: `http://localhost:3000/api/docs`.

### `GET /candles`

```text
GET /candles?symbol=BTCUSDT&interval=1m&limit=100
```

| Query | Required | Default | Rule |
| --- | --- | --- | --- |
| `symbol` | Yes | — | Must be non-empty; the DTO uppercases it and the service removes characters outside `A-Z0-9` before querying. |
| `interval` | No | `1m` | Must be a supported interval. |
| `limit` | No | `100` | Integer from 1 through 2000. |

Supported intervals: `1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M`.

Response:

```json
{
  "success": true,
  "symbol": "BTCUSDT",
  "interval": "1m",
  "count": 1,
  "data": [
    {
      "timestamp": "2026-08-10T08:00:00.000Z",
      "symbol": "BTCUSDT",
      "interval": "1m",
      "open": 100,
      "high": 102,
      "low": 99,
      "close": 101,
      "volume": 12.5
    }
  ]
}
```

### How history is built

The pipeline stores only closed `1m` candles. The backend reads a time window of at least 24 hours, or a larger window according to the requested `limit` and interval; it filters invalid OHLCV data and ambiguous duplicate `1m` rows, then aggregates through QuestDB `SAMPLE BY`.

- For fixed intervals, only buckets containing every expected minute are returned.
- `1M` uses calendar-month buckets, so it has no fixed minute-count filter.
- Results are sorted from oldest to newest, normalized to ISO 8601 timestamps, and merged with the recent real-time cache before limiting to `limit`. A historical minute with more than one stored version is excluded rather than choosing an ambiguous version.
- Scalar values are parameterized. The `interval` SQL fragment is interpolated only after an allowlist check.

## Socket.IO real time

Rooms use this form:

```text
BTCUSDT_1m
```

| Event | Direction | Payload | Behavior |
| --- | --- | --- | --- |
| `join_kline_room` | Client → server | `{ "symbol": "BTCUSDT", "interval": "1m" }` | Joins the room and receives its existing cached tail. |
| `leave_kline_room` | Client → server | Same shape | Leaves the room. |
| `kline_update` | Server → client | The kline below | Emitted only to the matching symbol/interval room. |

```json
{
  "timestamp": "2026-08-10T08:00:00+00:00",
  "symbol": "BTCUSDT",
  "interval": "1m",
  "open": 100,
  "high": 102,
  "low": 99,
  "close": 101,
  "volume": 12.5,
  "is_final": false
}
```

The real-time cache holds up to 500 candles per room. An update for an existing timestamp replaces the cached value, but a non-final update cannot overwrite a final candle.

REST CORS allows only `FRONTEND_URL`. Socket.IO allows `BACKEND_URL`, `FRONTEND_URL`, and requests with no `Origin` header.

## Source structure

```text
src/
├── app.controller.ts          # / and /health
├── main.ts                    # CORS, ValidationPipe, Swagger, listen
├── common/logger.ts
└── modules/
    ├── candles/               # REST, DTOs, cache, Socket.IO, validation
    ├── database/              # QuestDB pool
    └── kafka/                 # Kline consumer
```

The global `ValidationPipe` and the gateway both enable `transform` and `whitelist`. `candle-normalization.ts` normalizes symbols, timestamps, OHLCV numbers, and room keys; invalid payloads are discarded before caching or emitting to clients.

## npm commands

| Command | Purpose |
| --- | --- |
| `npm run start` | Start once. |
| `npm run start:dev` | Start in watch mode. |
| `npm run start:debug` | Start in debug watch mode. |
| `npm run build` | Compile into `dist/`. |
| `npm run start:prod` | Run `dist/main`. |
| `npm run test` | Run unit tests. |
| `npm run test:e2e` | Run the e2e test. |
| `npm run test:cov` | Run tests with coverage. |
| `npm run lint` | Run ESLint with `--fix`; it may edit source files. |
| `npm run format` | Run Prettier for `src/` and `test/`. |

## Architecture boundaries

- Do not ingest Binance data in the backend.
- Do not write candles directly to QuestDB from the backend.
- Do not expose Kafka or QuestDB to browsers.
- Future AI services should use dedicated Kafka or QuestDB contracts rather than sit in the `/candles` or Socket.IO request path.
