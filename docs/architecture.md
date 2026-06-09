# NexTick Architecture

NexTick is a realtime market-data system with explicit runtime boundaries.

Binance trades enter the Python pipeline, Kafka separates services, QuestDB stores final `1m` candles, NestJS exposes validated API contracts, and React renders the chart. AI forecasting, replay buffers, model training, and online learning are future extensions only.

## System Diagram

```mermaid
flowchart LR
  binance["Binance combined trade streams"] --> producer["Python BinanceCombinedProducer"]
  producer --> raw[("Kafka: KAFKA_TOPIC_RAW_TRADES")]
  raw --> processor["Python CandleProcessor"]
  processor --> questdb[("QuestDB: market_candles")]
  processor --> kline[("Kafka: KAFKA_TOPIC_KLINE_STREAM")]

  questdb --> candlesApi["NestJS CandlesService"]
  candlesApi --> rest["REST: GET /candles"]
  kline --> kafkaSvc["NestJS KafkaService"]
  kafkaSvc --> eventBus["EventEmitter2: candle.update"]
  eventBus --> gateway["CandlesGateway"]
  gateway --> socket["Socket.IO: kline_update"]

  rest --> frontend["React + Lightweight Charts"]
  socket --> frontend
  frontend --> health["GET /health"]

  questdb -. future extension .-> ai["AI/model services"]
  kline -. future extension .-> ai
```

## Runtime Boundaries

| Boundary | Owner | Contract |
| --- | --- | --- |
| Binance to raw Kafka | Python producer | Normalized raw trade JSON in `KAFKA_TOPIC_RAW_TRADES`. |
| Raw Kafka to candle state | Python processor | `CandleProcessor` consumes raw trades and updates active candles. |
| Candle state to QuestDB | Python processor | Final `1m` candles upserted into `market_candles`. |
| Candle state to kline Kafka | Python processor | Final and non-final candle JSON in `KAFKA_TOPIC_KLINE_STREAM`. |
| QuestDB to REST | NestJS backend | `GET /candles` response DTO. |
| Kline Kafka to Socket.IO | NestJS backend | `candle.update` internal event to `kline_update` room broadcast. |
| REST/Socket.IO to chart | React frontend | Axios history load and Socket.IO realtime updates. |

## Data Pipeline Layer

### Producer

`data_pipeline/producer/binance_producer.py` runs `BinanceCombinedProducer`.

Current behavior:

1. Reads `BINANCE_SOCKET_URL` and `TRADING_SYMBOLS` from config.
2. Lowercases configured symbols for Binance stream names.
3. Builds a combined stream URL from `BINANCE_SOCKET_URL`, like:

```text
wss://stream.binance.com:9443/stream?streams=btcusdt@trade/ethusdt@trade
```

4. Converts Binance payloads into the raw trade contract.
5. Drops trades with non-positive price or volume.
6. Publishes to `KAFKA_TOPIC_RAW_TRADES` with `symbol` as the Kafka key.
7. Reconnects to Binance with exponential backoff when the WebSocket drops.

### Processor

`data_pipeline/processor/candle_processor.py` runs `CandleProcessor`.

Current behavior:

1. Connects to QuestDB through PostgreSQL wire protocol.
2. Creates `market_candles` as a WAL/dedup table if it does not exist.
3. Consumes `KAFKA_TOPIC_RAW_TRADES` with group id `candle-processor-group` by default.
4. Creates one `MultiTimeframeManager` per detected symbol.
5. Creates one `SingleCandleManager` per configured interval.
6. Emits non-final candles every `CANDLE_UPDATE_INTERVAL_MS`.
7. Emits final candles when a trade crosses an interval boundary.
8. Persists final `1m` candles only.
9. Publishes final `1m` candles only after QuestDB insert succeeds.

### Candle Aggregation

Each `SingleCandleManager` keeps only the active candle for one symbol and interval.

| Candle field | Update rule |
| --- | --- |
| `open` | Set from the first trade in the interval. |
| `high` | Maximum of current high and latest trade price. |
| `low` | Minimum of current low and latest trade price. |
| `close` | Latest trade price. |
| `volume` | Running sum of trade volume. |
| `is_final` | Added at publish time. `false` for active candle updates, `true` for closed candles. |

No replay buffer or full trade history is used for active candle aggregation.

## Kafka Topics

| Topic env | Current producer | Current consumer | Message shape |
| --- | --- | --- | --- |
| `KAFKA_TOPIC_RAW_TRADES` | Python producer | Python processor | Raw trade JSON. |
| `KAFKA_TOPIC_KLINE_STREAM` | Python processor | NestJS backend | Candle JSON plus `is_final`. |

Docker Compose creates both topics in `kafka-setup` using values from `data_pipeline/.env`. Each topic is created with 3 partitions and replication factor `1`.

## Data Shapes

### Raw Trade

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

### Kline Update

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

### REST Candle Response

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

These shapes must stay in sync across Python publishing, backend DTOs, and frontend formatters.

## QuestDB Storage Model

The processor creates this table:

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

Current storage rules:

| Rule | Current behavior |
| --- | --- |
| Stored interval | Final `1m` candles only. |
| Historical larger intervals | Built by backend SQL using QuestDB `SAMPLE BY`. |
| Table partitioning | Monthly. |
| Timestamp column | Designated QuestDB timestamp. |
| Insert path | Python processor and one startup REST reconciler pass. |

Maintenance reconciliation is handled by `data_pipeline.backfill.reconciler`. In
Docker startup, `data-producer` runs first so raw trades are buffered in Kafka,
`data-backfill` runs one Binance REST replacement backfill pass, and only then
`data-processor` starts `CandleProcessor`. Startup backfill ends at Binance's
current minute floor, so only the open in-progress minute is excluded. The
backfill service writes a shared watermark file; while draining the Kafka
backlog, the processor skips final `1m` DB upserts before that watermark so
partial replay candles cannot overwrite the canonical REST rows. The optional
`data-recent-reconcile` maintenance profile runs `data_pipeline.backfill.recent_runner`
for periodic closed-tail repair when explicitly enabled. The live table is
WAL/dedup with `UPSERT KEYS(timestamp, symbol, interval)`.

## Backend Layer

NestJS modules:

| Module | Role |
| --- | --- |
| `CandlesModule` | `GET /candles`, `CandlesService`, and Socket.IO gateway. |
| `DatabaseModule` | `pg.Pool` connection to QuestDB. |
| `KafkaModule` | KafkaJS kline consumer. |

REST endpoints:

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/` | Returns `Hello World!`. |
| `GET` | `/health` | Returns status and timestamp. |
| `GET` | `/candles` | Returns historical candles. |

Swagger is available at:

```text
/api/docs
```

### REST Query Path

```mermaid
sequenceDiagram
  participant Client
  participant Controller as CandlesController
  participant Service as CandlesService
  participant DB as QuestDB

  Client->>Controller: GET /candles?symbol=BTCUSDT&interval=5m&limit=100
  Controller->>Controller: CandlesQueryDto validation
  Controller->>Service: getHistoricalCandles(symbol, limit, interval)
  Service->>Service: allowlist interval and sanitize symbol
  Service->>DB: SELECT ... SAMPLE BY 5m ALIGN TO CALENDAR
  DB-->>Service: rows newest first
  Service-->>Controller: rows reversed oldest to newest
  Controller-->>Client: CandlesResponseDto
```

### Socket.IO Path

```mermaid
sequenceDiagram
  participant UI as Frontend
  participant Gateway as CandlesGateway
  participant KafkaSvc as KafkaService
  participant Kafka as Kline topic

  UI->>Gateway: join_kline_room { symbol, interval }
  Gateway->>UI: socket joins SYMBOL_interval
  Kafka->>KafkaSvc: kline message
  KafkaSvc->>Gateway: internal candle.update event
  Gateway->>UI: kline_update to room
  UI->>Gateway: leave_kline_room on cleanup
```

Socket.IO events:

| Event | Direction | Payload |
| --- | --- | --- |
| `join_kline_room` | Client to server | `{ "symbol": "BTCUSDT", "interval": "1m" }` |
| `leave_kline_room` | Client to server | `{ "symbol": "BTCUSDT", "interval": "1m" }` |
| `kline_update` | Server to client | Kline update JSON. |

## Frontend Layer

The frontend is a Vite React app.

Key files:

| File | Role |
| --- | --- |
| `src/App.tsx` | Selects `/`, `/terms`, or `/privacy` based on `window.location.pathname`. |
| `src/services/api.ts` | Calls `GET {VITE_API_URL}/candles`. |
| `src/services/socket.ts` | Creates Socket.IO client and room helpers. |
| `src/hooks/useMarketData.ts` | Loads history, joins/leaves rooms, applies realtime candles, and syncs indicators. |
| `src/components/chart/TradingChart.tsx` | Composes chart controls, chart container, overlays, and indicator legend. |
| `src/components/chart/useTradingChartState.ts` | Owns chart refs, selected market, indicator settings, and chart UI state. |
| `src/components/chart/useTradingChartSetup.ts` | Creates Lightweight Charts series, crosshair behavior, pane layout tracking, and visible high/low overlay data. |
| `src/components/indicators/IndicatorLegend.tsx` | Displays indicator values and settings window. |
| `src/components/indicators/indicatorSettingsModel.ts` | Indicator settings tabs, slot defaults, pane placement helpers, and settings-window positioning. |
| `src/utils/chartIndicators.ts` | Maps indicator settings and series configs to calculated chart values. |
| `src/components/layout/useApiHealthStatus.ts` | Checks `VITE_API_HEALTH_URL` and returns API status for the footer. |

Chart update rules:

| Case | API |
| --- | --- |
| Historical load | `setData()` for candles, volume, and indicator series. |
| Symbol or interval switch | Clear series, fetch history, then `setData()`. |
| Realtime candle | `update()` for candle and volume series. |
| Realtime indicators | Recalculate visible indicator history and call indicator `setData()`. |

Indicator groups:

| Group | Pane behavior |
| --- | --- |
| EMA | Main chart pane. |
| MA | Main chart pane. |
| Volume MA | Volume pane. |
| RSI | Secondary pane when enabled. |
| MACD | Secondary pane with MACD and signal line when enabled. |

## Time Format Rules

| Boundary | Format |
| --- | --- |
| Binance trade input | Milliseconds since Unix epoch from field `T`. |
| Python processor | UTC-aware `datetime`. |
| Kafka kline output | ISO 8601 string, usually with `+00:00`. |
| QuestDB insert | `%Y-%m-%d %H:%M:%S`. |
| Backend response | ISO 8601 string, usually ending in `Z`. |
| Frontend chart | Unix seconds for Lightweight Charts. |

## Failure Handling

| Area | Current handling |
| --- | --- |
| Producer Kafka startup | Retry with exponential backoff, up to 60 attempts. |
| Producer Binance disconnect | Reconnect with exponential backoff, up to 10 attempts. |
| Invalid producer trade | Drop non-positive price or volume. |
| Processor Kafka startup | Retry with exponential backoff. |
| Invalid raw trade | Skip missing symbol, timestamp, price, volume, non-positive values, or pre-2020 timestamps. |
| Processor QuestDB startup | Startup fails if connection cannot be opened. |
| Processor QuestDB upsert | Retry 3 times. If final `1m` persistence fails, skip publishing that final candle. |
| Startup reconciler failure | Retry the one-shot reconciliation according to `STARTUP_RECONCILE_MAX_ATTEMPTS`; live processing continues after retries are exhausted. |
| Candle reconciler failure | Keeps full-table backups in `market_candles_old_*`; if `market_candles` is missing, the next run restores from the newest backup before reconciling. |
| Backend QuestDB startup | Runs `SELECT 1`; startup fails if QuestDB is unreachable. |
| Backend Kafka startup | Startup fails if consumer cannot connect or subscribe. |
| Frontend history load | Logs error and does not join the Socket.IO room if history load fails. |
| Frontend health check | Times out after 5 seconds and marks API as `Offline`. |

## Scaling Notes

| Area | Note |
| --- | --- |
| Kafka partitions | Compose creates 3 partitions for each topic; producers use `symbol` as key. |
| More symbols | Add symbols to `TRADING_SYMBOLS` and `VITE_TRADING_SYMBOLS`. |
| More backend instances | Socket.IO fan-out across multiple backend instances would need a shared Socket.IO adapter. |
| More processors | Partition or symbol ownership must be designed so two processors do not aggregate the same symbol independently. |
| QuestDB | Current table partitions by month and stores final `1m` candles as the source for historical aggregation. |

## Security and Validation Notes

| Layer | Current protection |
| --- | --- |
| REST query DTO | `CandlesQueryDto` validates `symbol`, `interval`, and `limit`. |
| Socket room DTO | `KlineRoomPayloadDto` validates `symbol` and allowlisted `interval`. |
| SQL interval | Interpolated only after checking `VALID_INTERVALS`. |
| SQL scalars | `symbol` and `limit` are passed as query parameters. |
| REST CORS | Uses `FRONTEND_URL`. |
| Socket.IO CORS | Allows `BACKEND_URL`, `FRONTEND_URL`, or no origin. |
| Browser access | Browser cannot access Kafka or QuestDB directly. |

## Data That Must Stay in Sync

| Change | Update these places |
| --- | --- |
| Add interval | `data_pipeline/common/config.py`, `backend/src/modules/candles/enum/candle-interval.enum.ts`, `data_pipeline/.env`, `frontend/.env`, docs. |
| Add symbol | `data_pipeline/.env`, `frontend/.env`, docs/examples if needed. |
| Rename topics | `data_pipeline/.env`, `backend/.env`, `docker-compose.yml`, docs. |
| Change kline payload | Python `broadcast_candle`, backend DTOs, frontend `MarketCandle` and `KlineUpdate`, docs. |
| Change QuestDB schema | Processor DDL and insert, backend SQL, docs, and data migration plan. |
| Change health route | `AppController`, frontend `VITE_API_HEALTH_URL`, docs. |

## Future AI Boundary

AI features are not in the current request path.

Future services such as replay buffers, model training, online learning, and forecasting should:

| Rule | Reason |
| --- | --- |
| Consume Kafka or QuestDB contracts. | Keeps model code decoupled from processor memory. |
| Publish to dedicated topics, tables, or explicit backend APIs. | Avoids hidden dependencies in the chart path. |
| Stay outside `GET /candles` and Socket.IO kline fan-out. | Prevents model latency from slowing market data delivery. |
| Be documented as separate runtime services. | Keeps portfolio documentation accurate. |
