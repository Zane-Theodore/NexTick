# NexTick Overview

NexTick is a realtime cryptocurrency candle streaming and charting system.

It reads Binance trade ticks, transports them through Kafka, builds OHLCV candles in Python, stores historical candles in QuestDB, serves REST and Socket.IO through NestJS, and renders the market stream in a React chart UI.

NexTick is not a trading bot and does not provide financial advice.

## Problem It Solves

Realtime charting needs separate concerns:

| Concern | NexTick boundary |
| --- | --- |
| High-frequency trade ingestion | Python producer reads Binance combined trade streams. |
| Candle construction | Python processor updates active OHLCV state. |
| Historical reads | QuestDB stores final `1m` candles. |
| Browser API | NestJS validates REST and Socket.IO contracts. |
| Chart rendering | React and Lightweight Charts handle browser rendering. |

This keeps the browser away from Kafka, QuestDB, Binance credentials, and streaming internals.

## Main Modules

| Module | Role |
| --- | --- |
| [`data_pipeline/`](../data_pipeline/README.md) | Binance ingestion, Kafka raw trade publishing, O(1) candle aggregation, QuestDB writes, kline publishing. |
| [`backend/`](../backend/README.md) | NestJS API gateway, DTO validation, QuestDB queries, Kafka kline consumer, Socket.IO fan-out, Swagger. |
| [`frontend/`](../frontend/README.md) | React chart UI, REST history loading, Socket.IO realtime updates, static `/terms` and `/privacy` pages. |
| Infrastructure | Docker Compose services for Kafka, Kafka UI, QuestDB, producer, and processor. |

## End-to-End Data Flow

1. Binance emits trade ticks over combined trade streams.
2. `BinanceCombinedProducer` normalizes each trade.
3. The producer publishes raw trade JSON to `KAFKA_TOPIC_RAW_TRADES`.
4. `CandleProcessor` consumes raw trades and updates one active candle per symbol/interval.
5. Final `1m` candles are inserted into QuestDB table `market_candles`.
6. Final and non-final candle updates are published to `KAFKA_TOPIC_KLINE_STREAM`.
7. `KafkaService` in the backend consumes kline updates and emits internal `candle.update` events.
8. `CandlesGateway` sends Socket.IO `kline_update` to rooms like `BTCUSDT_1m`.
9. The frontend loads history from `GET /candles`, joins the room, and updates Lightweight Charts.

## Current Features

| Feature | Current implementation |
| --- | --- |
| Binance trade ingestion | `data_pipeline/producer/binance_producer.py`. |
| Raw trade Kafka topic | Configured by `KAFKA_TOPIC_RAW_TRADES`. |
| Candle aggregation | O(1) active candle updates in `SingleCandleManager`. |
| QuestDB storage | Final `1m` candles in `market_candles`. |
| Historical REST API | `GET /candles?symbol=BTCUSDT&interval=1m&limit=100`. |
| Health endpoint | `GET /health`. |
| Swagger UI | `/api/docs`. |
| Realtime Socket.IO | `join_kline_room`, `leave_kline_room`, `kline_update`. |
| Chart UI | Candlesticks, volume, symbol/interval controls, OHLCV tooltip, scroll-to-latest, EMA/MA overlays. |
| Static legal pages | `/terms` and `/privacy` in the frontend. |
| API status | Frontend footer checks `VITE_API_HEALTH_URL`. |

Supported intervals in code:

```text
1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M
```

## Out of Scope

These are intentionally not implemented as current runtime features:

| Item | Status |
| --- | --- |
| Trading execution | Out of scope. NexTick does not place orders. |
| Financial advice | Out of scope. The UI shows market data only. |
| Browser access to Kafka or QuestDB | Out of scope. Browser traffic goes through the backend. |
| Backend Binance ingestion | Out of scope. Python owns ingestion. |
| Backend raw trade aggregation | Out of scope. Python owns candle aggregation. |
| AI forecasting | Future extension only. |
| Replay buffer, model training, online learning | Future extension only. |

## Project Boundaries

| Boundary | Rule |
| --- | --- |
| Frontend | Calls only NestJS REST and Socket.IO. |
| Backend | Reads QuestDB, consumes kline Kafka, validates DTOs, and fans out Socket.IO. |
| Data pipeline | Owns Binance ingestion, Kafka raw trade publishing, aggregation, QuestDB writes, and kline publishing. |
| Kafka | Integration contract between pipeline and backend. |
| QuestDB | Historical candle store. |
| AI/model services | Future services should consume Kafka or QuestDB and stay outside the current API request path. |

## Documentation

| Document | Scope |
| --- | --- |
| [Root README](../README.md) | Main repository overview and quickstart. |
| [Architecture](architecture.md) | Detailed runtime boundaries, contracts, storage, and scaling notes. |
| [Setup](setup.md) | Local setup and troubleshooting. |
| [Data pipeline README](../data_pipeline/README.md) | Python producer and processor details. |
| [Backend README](../backend/README.md) | NestJS endpoints, modules, Kafka, QuestDB, and Socket.IO. |
| [Frontend README](../frontend/README.md) | React UI, env config, REST and realtime chart flow. |
