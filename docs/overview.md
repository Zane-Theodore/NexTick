# NexTick Overview

NexTick is a realtime cryptocurrency candle streaming and charting system.

It reads Binance raw-trade and partial-depth streams, transports normalized market data through Kafka, aggregates candles in Python, stores final `1m` candles in QuestDB, serves REST and Socket.IO contracts through NestJS, and renders the market stream in a React chart UI.

NexTick is not a trading bot and does not provide financial advice.

## What It Solves

Realtime charting needs separate runtime responsibilities:

| Concern | NexTick boundary |
| --- | --- |
| Realtime exchange ingestion | Python producer reads Binance combined raw-trade and partial-depth streams. |
| Candle processing | Python processor aggregates normalized raw trades into OHLCV candles and persists final `1m` rows. |
| Historical reads | QuestDB stores final `1m` candles. |
| Browser API | NestJS validates REST and Socket.IO contracts. |
| Chart rendering | React and Lightweight Charts handle browser rendering. |

This keeps the browser away from Kafka, QuestDB, Binance internals, and streaming service credentials.

## Main Modules

| Module | Role |
| --- | --- |
| [`data_pipeline/`](../data_pipeline/README.md) | Binance raw-trade/depth ingestion, Kafka market-data publishing, candle aggregation, QuestDB writes, and kline publishing. |
| [`backend/`](../backend/README.md) | NestJS API gateway, DTO validation, QuestDB queries, recent candle/trade/depth caches, Kafka market-data consumer, Socket.IO fan-out, Swagger. |
| [`frontend/`](../frontend/README.md) | React chart, Market Trades and Order Book UI, REST candle history, Socket.IO realtime updates, indicators, and preferences. |
| Infrastructure | Docker Compose services for Kafka, Kafka UI, QuestDB, producer, startup backfill, and processor. |

## End-to-End Data Flow

1. Binance emits individual trades and 20-level partial-depth snapshots over one combined stream.
2. `BinanceCombinedTradeProducer` normalizes each trade and depth snapshot.
3. The producer publishes raw trades to `KAFKA_TOPIC_MARKET_TRADES` and depth to `KAFKA_TOPIC_MARKET_DEPTH`.
4. `CandleProcessor` and the NestJS backend independently consume raw trades; the processor builds candles while the backend fans trades out to browser rooms.
5. Final `1m` candles are upserted into QuestDB table `market_candles`.
6. Final and non-final candle updates are published to `KAFKA_TOPIC_KLINE_STREAM`.
7. `KafkaService` consumes kline, raw-trade, and market-depth topics and emits normalized internal events.
8. The gateways send `kline_update`, `market_trade`, and `order_book_update` to matching Socket.IO rooms.
9. The frontend loads candle history and receives every live market-data view through backend rooms.

## Current Features

| Feature | Current implementation |
| --- | --- |
| Binance raw-trade ingestion | `data_pipeline/producer/binance_producer.py`. |
| Market-trade Kafka topic | Configured by `KAFKA_TOPIC_MARKET_TRADES`. |
| Market-depth Kafka topic | Configured by `KAFKA_TOPIC_MARKET_DEPTH`. |
| Market Trades UI | Backend caches and streams normalized raw trades by symbol. |
| Order Book UI | Backend caches and streams normalized 20-level depth by symbol. |
| Candle processing | Raw trades are aggregated into OHLCV candles for every configured interval; open updates and final candles are published. |
| QuestDB storage | Final `1m` candles in `market_candles`. |
| Historical REST API | `GET /candles?symbol=BTCUSDT&interval=1m&limit=100`. |
| Recent realtime tail cache | Backend keeps up to 500 recent kline updates per room and merges them into history responses. |
| Health endpoint | `GET /health`. |
| Swagger UI | `/api/docs`. |
| Realtime Socket.IO | Room-scoped kline, Market Trades, and Order Book snapshots/updates with reconnect rejoin. |
| Chart UI | Candlesticks, volume, symbol/interval controls, OHLCV tooltip, visible high/low overlay, scroll-to-latest, and session-scoped chart view preferences. |
| Indicators | EMA, MA, volume-MA, RSI, and MACD with configurable visibility, periods, source, width, and colors. MA is hidden by default through group visibility. |
| Static legal pages | `/terms` and `/privacy` in the frontend. |
| API status | Frontend footer checks `VITE_API_HEALTH_URL`. |
| Visible high/low overlay | Frontend marks visible-range price extrema on the chart. |
| Startup backfill | Enabled by default; `data-backfill` catches each symbol up for at most 480 minutes before one Binance-time cutover, then begins live processing. |

Supported intervals in code:

```text
1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M
```

## Current Contracts

| Contract | Owner | Consumer |
| --- | --- | --- |
| Market raw-trade JSON in `KAFKA_TOPIC_MARKET_TRADES` | Python producer | Python processor and NestJS backend |
| Market-depth JSON in `KAFKA_TOPIC_MARKET_DEPTH` | Python producer | NestJS backend |
| Kline update JSON in `KAFKA_TOPIC_KLINE_STREAM` | Python processor | NestJS backend |
| Final `1m` rows in `market_candles` | Python processor | NestJS backend |
| `GET /candles` response DTO | NestJS backend | React frontend |
| Socket.IO room events | NestJS backend | React frontend |

## Out of Scope

These are intentionally not implemented as current runtime features:

| Item | Status |
| --- | --- |
| Trading execution | Out of scope. NexTick does not place orders. |
| Financial advice | Out of scope. The UI shows market data only. |
| Browser access to Kafka or QuestDB | Out of scope. Browser traffic goes through the backend. |
| Backend Binance ingestion and candle aggregation | Out of scope. Python owns exchange streams and candle construction. |
| AI forecasting | Future extension only. |
| Replay buffer, model training, online learning | Future extension only. |

## Project Boundaries

| Boundary | Rule |
| --- | --- |
| Frontend | Uses only NestJS REST/Socket.IO for candles, trades, and Order Book depth. |
| Backend | Reads QuestDB, consumes kline/raw-trade/market-depth Kafka, validates data, and fans out Socket.IO. |
| Data pipeline | Owns Binance raw-trade/depth ingestion, candle aggregation, QuestDB writes, and Kafka publishing. |
| Kafka | Integration contract between pipeline and backend. |
| QuestDB | Historical candle store. |
| AI/model services | Future services should consume Kafka or QuestDB and stay outside the current API request path. |

## Documentation

| Document | Scope |
| --- | --- |
| [Root README](../README.md) | Main repository overview, quickstart, commands, and documentation index. |
| [Architecture](architecture.md) | Detailed runtime boundaries, contracts, storage, validation, and scaling notes. |
| [Setup](setup.md) | Local setup, env values, verification commands, and troubleshooting. |
| [Data pipeline README](../data_pipeline/README.md) | Python producer and processor details. |
| [Backend README](../backend/README.md) | NestJS endpoints, modules, Kafka, QuestDB, recent realtime caches, Socket.IO, and current test status. |
| [Frontend README](../frontend/README.md) | React UI, env config, REST and realtime chart flow, and indicators. |
