# NexTick Overview

NexTick is a real-time crypto candle streaming project. It reads Binance trade ticks, sends them through Kafka, builds OHLCV candles in Python, stores historical candles in QuestDB, serves REST and Socket.IO from NestJS, and shows the chart in a React app.

The project keeps each part separate. The backend does not connect to Binance or build candles from raw trades. The frontend does not connect directly to Kafka, QuestDB, or Binance. This makes the system easier to run, test, and extend later.

## Main Parts

| Folder | Role | Main tools |
| --- | --- | --- |
| `data_pipeline/` | Reads Binance trades, sends raw trades to Kafka, builds candles, stores final `1m` candles in QuestDB, sends live candle updates | Python, `kafka-python`, `websocket-client`, `psycopg2`, QuestDB |
| `backend/` | Provides REST API, reads QuestDB, consumes Kafka candle updates, sends Socket.IO updates, validates input, serves Swagger docs | NestJS, TypeScript, KafkaJS, Socket.IO, `pg`, `class-validator`, Swagger |
| `frontend/` | Shows the real-time chart, loads history through REST, listens to Socket.IO updates | React, Vite, TypeScript, Lightweight Charts, Axios, Socket.IO Client |
| Infrastructure | Runs local streaming and storage services | Docker Compose, Kafka, Kafka UI, QuestDB |

## Data Flow

1. `BinanceCombinedProducer` connects to Binance combined trade streams for `TRADING_SYMBOLS`.
2. The producer cleans each trade and sends it to Kafka topic `KAFKA_TOPIC_RAW_TRADES`.
3. `CandleProcessor` reads raw trades and creates candle state per symbol and interval.
4. Open candles are sent on a timer using `CANDLE_UPDATE_INTERVAL_MS` with `is_final=false`.
5. When an interval closes, the candle is sent with `is_final=true`. Final `1m` candles are also saved in QuestDB table `market_candles`.
6. The backend reads `KAFKA_TOPIC_KLINE_STREAM`, emits an internal `candle.update` event, then sends Socket.IO `kline_update` to room `{SYMBOL}_{interval}`.
7. The frontend calls `GET /candles` for history, joins the matching Socket.IO room, and updates the chart with `series.update()`.

## Current Features

| Feature | Description |
| --- | --- |
| Historical candles | `GET /candles?symbol=BTCUSDT&interval=1m&limit=100` returns candles from oldest to newest. |
| Many intervals | Supported intervals are `1m`, `3m`, `5m`, `15m`, `30m`, `1h`, `2h`, `4h`, `6h`, `8h`, `12h`, `1d`, `3d`, `1w`, `1M`. |
| Live candles | Socket.IO event `kline_update` sends both open and final candles. |
| Chart UI | Candlestick chart, volume bars, symbol selector, interval selector, OHLCV tooltip, scroll-to-latest button, EMA/MA legend. |
| API docs | Swagger UI is available at `/api/docs`. |
| Local tools | Kafka UI is at `http://localhost:8080`; QuestDB Console is at `http://localhost:9000`. |

## Main Data Shapes

### Raw Trade Kafka Message

`data_pipeline/producer/binance_producer.py` sends raw trades to `KAFKA_TOPIC_RAW_TRADES`. The Kafka key is the symbol.

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

### Kline Kafka and Socket.IO Message

`CandleProcessor` sends final and open candles to `KAFKA_TOPIC_KLINE_STREAM`. The backend forwards this data through Socket.IO event `kline_update`.

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

### REST Response

`GET /candles` returns this shape:

```json
{
  "success": true,
  "symbol": "BTCUSDT",
  "interval": "1m",
  "count": 100,
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

## Project Rules

| Rule | Reason |
| --- | --- |
| The frontend only talks to NestJS REST and Socket.IO. | The browser should not depend on Kafka, QuestDB, Binance, or model code. |
| The backend does not read Binance streams or build candles from raw trades. | The backend stays focused on API, validation, database reads, and sending live updates. |
| The Python pipeline owns the market data write path. | Streaming state and database writes stay close to the data source. |
| QuestDB stores final `1m` candles in the current flow. | The backend can build larger intervals from `1m` data with `SAMPLE BY`. |
| Intervals must be checked against the allowed list. | The backend places the interval into `SAMPLE BY ${interval}`, so it must be checked first. |
| AI and model services stay outside the API request path. | Training and forecasts should not slow down candle delivery. |

## Repository Layout

```text
NexTick/
|-- backend/
|   |-- src/
|   |   |-- modules/
|   |   |   |-- candles/
|   |   |   |-- database/
|   |   |   `-- kafka/
|   |   |-- common/
|   |   `-- main.ts
|   |-- package.json
|   `-- README.md
|-- data_pipeline/
|   |-- producer/
|   |   `-- binance_producer.py
|   |-- processor/
|   |   `-- candle_processor.py
|   |-- config.py
|   |-- logger_config.py
|   `-- README.md
|-- frontend/
|   |-- src/
|   |   |-- components/
|   |   |-- hooks/
|   |   |-- services/
|   |   |-- types/
|   |   `-- utils/
|   |-- package.json
|   `-- README.md
|-- docs/
|   |-- architecture.md
|   |-- overview.md
|   `-- setup.md
|-- docker-compose.yml
|-- Dockerfile
|-- requirements.txt
`-- README.md
```
