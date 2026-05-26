# NexTick Backend

NestJS API gateway for historical candle queries, QuestDB access, Kafka kline consumption, and Socket.IO realtime fan-out.

The backend is intentionally not an ingestion engine, candle aggregation engine, or AI runtime. Its job is to validate contracts, query the authoritative time-series store, consume already-processed candle updates, and distribute them to connected clients.

## Responsibilities

| Capability | Implementation |
| --- | --- |
| Historical candles | `GET /candles` through `CandlesController` and `CandlesService` |
| QuestDB access | `DatabaseService` using `pg.Pool` over QuestDB PostgreSQL wire protocol |
| Realtime ingestion | `KafkaService` consuming `KAFKA_TOPIC_KLINE_STREAM` with KafkaJS |
| Realtime fan-out | `CandlesGateway` emitting Socket.IO `kline_update` events to symbol/interval rooms |
| Validation | Global `ValidationPipe`, DTO classes, `class-validator`, `class-transformer` |
| API documentation | Swagger UI at `/api/docs` |

## Setup

Install dependencies:

```bash
cd backend
npm install
```

Create the environment file:

```bash
cp .env.example .env
```

Start the development server:

```bash
npm run start:dev
```

Useful commands:

```bash
npm run build
npm run lint
npm run test
npm run test:e2e
```

Default local endpoints:

| Endpoint | URL |
| --- | --- |
| REST API | `http://localhost:3000` |
| Swagger UI | `http://localhost:3000/api/docs` |
| Historical candles | `GET http://localhost:3000/candles?symbol=BTCUSDT&interval=1m&limit=100` |
| Socket.IO | `http://localhost:3000` |

## Environment Variables

| Variable | Required | Example | Description |
| --- | --- | --- | --- |
| `QUESTDB_HOST` | Yes | `localhost` | QuestDB PostgreSQL wire host. Use `questdb` when running inside the Docker Compose network. |
| `QUESTDB_PORT` | Yes | `8812` | QuestDB PostgreSQL wire port. |
| `QUESTDB_USER` | Yes | `admin` | QuestDB user. |
| `QUESTDB_PASSWORD` | Yes | `quest` | QuestDB password. |
| `QUESTDB_DB_NAME` | Yes | `qdb` | QuestDB database name. |
| `QUESTDB_POOL_MAX` | Yes | `10` | Maximum number of database connections in the backend pool. |
| `QUESTDB_POOL_TIMEOUT` | Yes | `5000` | Connection timeout in milliseconds for `pg.Pool`. |
| `QUESTDB_POOL_IDLE_TIMEOUT` | Yes | `30000` | Idle connection timeout in milliseconds. |
| `KAFKA_BROKER` | Yes | `localhost:9092` | Comma-separated Kafka broker list. |
| `KAFKA_TOPIC_KLINE_STREAM` | Yes | `kline-stream` | Topic containing final and non-final candle updates from the Python processor. |
| `KAFKA_CLIENT_ID` | Yes | `nextick-backend` | KafkaJS client ID. |
| `KAFKA_GROUP_ID` | Yes | `nextick-backend-group` | Kafka consumer group ID for backend kline consumption. |
| `PORT` | Yes | `3000` | NestJS listen port. |
| `FRONTEND_URL` | Yes | `http://localhost:5173` | Allowed browser origin for REST and Socket.IO CORS. |
| `BACKEND_URL` | Yes | `http://localhost:3000` | Public backend URL used in logs and Socket.IO CORS allowlist. |

## REST API

### `GET /candles`

Returns historical candles sorted from oldest to newest.

Query parameters:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `symbol` | `string` | Required | Trading pair, transformed to uppercase by `CandlesQueryDto`. |
| `interval` | `CandleInterval` | `1m` | Allowlisted candle interval. |
| `limit` | `number` | `100` | Number of candles to return, constrained from `1` to `1000`. |

Example:

```bash
curl "http://localhost:3000/candles?symbol=BTCUSDT&interval=5m&limit=200"
```

Response shape:

```json
{
  "success": true,
  "symbol": "BTCUSDT",
  "interval": "5m",
  "count": 200,
  "data": [
    {
      "timestamp": "2026-05-20T08:00:00.000Z",
      "symbol": "BTCUSDT",
      "interval": "5m",
      "open": 105000.5,
      "high": 105250.75,
      "low": 104900.25,
      "close": 105120.1,
      "volume": 12.34567
    }
  ]
}
```

## Socket.IO Events

Rooms use this format:

```text
{SYMBOL}_{interval}
```

Example:

```text
BTCUSDT_1m
```

| Event | Direction | Payload | Description |
| --- | --- | --- | --- |
| `join_kline_room` | Client to server | `{ "symbol": "BTCUSDT", "interval": "1m" }` | Subscribes the socket to a symbol/interval room. |
| `leave_kline_room` | Client to server | `{ "symbol": "BTCUSDT", "interval": "1m" }` | Removes the socket from a symbol/interval room. |
| `kline_update` | Server to client | `KlineUpdateDto` | Emits a final or non-final candle update to subscribed clients. |

`kline_update` payload:

```json
{
  "timestamp": "2026-05-20T08:00:00.000Z",
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

Internally, `KafkaService` emits `candle.update` on the application event bus. `CandlesGateway` listens for that internal event and emits `kline_update` to the matching Socket.IO room.

## Key Architectural Rules

### DTO Validation

Every public contract should be represented by a DTO:

| Contract | DTO |
| --- | --- |
| REST query | `CandlesQueryDto` |
| REST response | `CandlesResponseDto` |
| Candle payload | `CandleDto` |
| Socket room payload | `KlineRoomPayloadDto` |
| Realtime candle update | `KlineUpdateDto` |

The application enables a global `ValidationPipe` with:

```ts
new ValidationPipe({
  whitelist: true,
  transform: true,
})
```

Socket.IO gateway payloads also use `ValidationPipe`.

### Swagger Docs

DTO fields must be decorated with `@ApiProperty()` or `@ApiPropertyOptional()` so the contract is visible in Swagger.

Swagger UI is registered at:

```text
/api/docs
```

### Defensive Transform

Transforms must tolerate missing and empty values. Numeric coercion should follow the current pattern:

```ts
@Transform(({ value }) =>
  value === undefined || value === '' ? undefined : Number(value),
)
```

This prevents optional query fields from throwing during transformation before validation can produce a clear response.

### QuestDB Query Safety

`CandlesService` reads from `market_candles` and uses QuestDB aggregation:

```sql
SAMPLE BY ${interval} ALIGN TO CALENDAR
```

Because QuestDB SQL fragments such as `SAMPLE BY 5m` cannot be parameterized like scalar values, intervals must be allowlisted before interpolation. User-controlled scalar values such as `symbol` and `limit` must be parameterized.

## Backend Boundary

The backend must not:

| Do Not | Owner |
| --- | --- |
| Connect to Binance WebSocket | Python data pipeline |
| Aggregate raw trades into candles | Python `CandleProcessor` |
| Persist final candles from raw trades | Python `CandleProcessor` |
| Run replay buffers, GRU training, or online learning | Isolated AI/model services |
| Expose Kafka or QuestDB directly to browsers | Backend gateway only |
