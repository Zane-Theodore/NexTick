# NexTick Setup

This guide shows how to run NexTick locally. The project has no root `package.json`. The backend and frontend install Node packages inside their own folders. The Python pipeline uses the root `requirements.txt`.

## Requirements

| Tool | Why it is needed |
| --- | --- |
| Docker and Docker Compose | Runs Kafka, Kafka UI, QuestDB, the data producer, and the data processor. |
| Node.js and npm | Runs the NestJS backend and Vite frontend. |
| Python 3.10+ | Runs the Python data pipeline if you do not use containers for it. |
| PowerShell, Git Bash, or another shell | Creates `.env` files and runs commands. |

On Windows PowerShell, use `Copy-Item` if `cp` is not available.

## 1. Create Environment Files

From the repository root:

```powershell
Copy-Item data_pipeline\.env.example data_pipeline\.env
Copy-Item backend\.env.example backend\.env
Copy-Item frontend\.env.example frontend\.env
```

On macOS/Linux or Git Bash:

```bash
cp data_pipeline/.env.example data_pipeline/.env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

## 2. Fill the `.env` Files

### `data_pipeline/.env`

Use these values when the Python pipeline runs on your host machine:

```env
QUESTDB_HOST=localhost
QUESTDB_PORT=8812
QUESTDB_USER=admin
QUESTDB_PASSWORD=quest
QUESTDB_DB_NAME=qdb

KAFKA_BROKER=localhost:9092
KAFKA_TOPIC_RAW_TRADES=raw-trades
KAFKA_TOPIC_KLINE_STREAM=kline-stream

BINANCE_SOCKET_URL=wss://stream.binance.com:9443/stream
TRADING_SYMBOLS=BTCUSDT,ETHUSDT
CANDLE_INTERVALS=1m,3m,5m,15m,30m,1h,2h,4h,6h,8h,12h,1d,3d,1w,1M
CANDLE_UPDATE_INTERVAL_MS=500
```

Docker Compose overrides `KAFKA_BROKER=kafka:29092` and `QUESTDB_HOST=questdb` for `data-producer` and `data-processor`, so the file can keep the host values above.

### `backend/.env`

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

The backend connects to QuestDB and Kafka during startup. If those services are not ready, `npm run start:dev` will fail.

### `frontend/.env`

```env
VITE_API_URL=http://localhost:3000
VITE_SOCKET_URL=http://localhost:3000
VITE_TRADING_SYMBOLS=BTCUSDT,ETHUSDT
VITE_CANDLE_INTERVALS=1m,3m,5m,15m,30m,1h,2h,4h,6h,8h,12h,1d,3d,1w,1M
```

`VITE_TRADING_SYMBOLS` and `VITE_CANDLE_INTERVALS` are read directly in `frontend/src/components/chart/chartConstants.ts` with `.split(',')`, so do not leave them empty.

## 3. Start Docker Services and the Data Pipeline

From the repository root:

```bash
docker compose up -d --build kafka kafka-ui kafka-setup questdb data-processor data-producer
```

Services in `docker-compose.yml`:

| Service | Role | Notes |
| --- | --- | --- |
| `kafka` | Local Kafka broker | Exposes `localhost:9092`; internal listener is `kafka:29092`. |
| `kafka-setup` | Creates Kafka topics | Creates `KAFKA_TOPIC_RAW_TRADES` and `KAFKA_TOPIC_KLINE_STREAM`; uses `data_pipeline/.env`. |
| `questdb` | Time-series database | Exposes Console `9000`, PostgreSQL wire `8812`, and ILP `9009`. |
| `data-processor` | Reads raw trades, builds candles, writes QuestDB, sends kline updates | Waits for QuestDB before it starts. |
| `data-producer` | Connects to Binance and sends raw trades | Starts after Kafka setup and the processor. |
| `kafka-ui` | Kafka web UI | Runs at `http://localhost:8080`. |

Check containers:

```bash
docker compose ps
```

View pipeline logs:

```bash
docker compose logs -f data-producer data-processor
```

## 4. Start the Backend

Open a new terminal:

```bash
cd backend
npm install
npm run start:dev
```

Default URLs:

| Service | URL |
| --- | --- |
| Backend API | `http://localhost:3000` |
| Swagger UI | `http://localhost:3000/api/docs` |
| Historical candles | `http://localhost:3000/candles?symbol=BTCUSDT&interval=1m&limit=100` |

Quick check:

```bash
curl "http://localhost:3000/candles?symbol=BTCUSDT&interval=1m&limit=20"
```

If `data` is empty, the pipeline may not have produced and saved a final `1m` candle yet. Wait at least one minute and check the processor logs.

## 5. Start the Frontend

Open a new terminal:

```bash
cd frontend
npm install
npm run dev
```

Vite runs at:

```text
http://localhost:5173
```

The frontend will:

1. Read symbols and intervals from `VITE_TRADING_SYMBOLS` and `VITE_CANDLE_INTERVALS`.
2. Call `GET {VITE_API_URL}/candles?symbol=...&interval=...&limit=1000`.
3. Draw history with `series.setData()`.
4. Join Socket.IO room `{SYMBOL}_{interval}`.
5. Receive `kline_update` and update the chart with `series.update()`.

## 6. Run the Pipeline Without Containers

If you only want Kafka and QuestDB in Docker, start them first:

```bash
docker compose up -d kafka kafka-ui kafka-setup questdb
```

Create a Python virtual environment from the repository root:

```bash
python -m venv .venv
```

Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m data_pipeline.processor.candle_processor
```

Open another terminal, activate the same environment, and run the producer:

```powershell
.\.venv\Scripts\Activate.ps1
python -m data_pipeline.producer.binance_producer
```

macOS/Linux:

```bash
source .venv/bin/activate
pip install -r requirements.txt
python -m data_pipeline.processor.candle_processor
```

Open another terminal:

```bash
source .venv/bin/activate
python -m data_pipeline.producer.binance_producer
```

## Test and Build Commands

Backend:

```bash
cd backend
npm run build
npm run lint
npm run test
npm run test:e2e
```

Frontend:

```bash
cd frontend
npm run build
npm run lint
npm run preview
```

The Python pipeline does not have a test runner in this repository yet. Check it with Kafka logs, QuestDB data, and the backend API.

## Check Data

QuestDB Console:

```text
http://localhost:9000
```

Query final `1m` candles:

```sql
SELECT *
FROM market_candles
WHERE symbol = 'BTCUSDT'
ORDER BY timestamp DESC
LIMIT 20;
```

Query `5m` candles from stored `1m` data:

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

Kafka UI:

```text
http://localhost:8080
```

Topics to check:

| Topic | Data |
| --- | --- |
| `raw-trades` | Clean Binance trades. |
| `kline-stream` | Final and open candles from the processor. |

## Troubleshooting

| Problem | Likely cause | Fix |
| --- | --- | --- |
| Backend fails on startup | Kafka or QuestDB is not ready | Run `docker compose ps`, wait for healthy services, then start the backend again. |
| `GET /candles` returns `data: []` | No final `1m` candle has been saved yet | Wait at least one minute, then check `data-processor` logs and the QuestDB table. |
| Frontend has no symbol or interval options | `frontend/.env` is missing `VITE_TRADING_SYMBOLS` or `VITE_CANDLE_INTERVALS` | Fill comma-separated values and restart Vite. |
| Socket.IO CORS error | `FRONTEND_URL` or `BACKEND_URL` is wrong | Update `backend/.env` and restart the backend. |
| Kafka topic does not exist | `kafka-setup` did not finish, or topic env values are empty | Fill `data_pipeline/.env` and run `docker compose up -d kafka-setup`. |
| Binance producer cannot connect | Network, DNS, or Binance access issue | Check `data-producer` logs. The container uses DNS `8.8.8.8` and `8.8.4.4`. |
| Interval request returns 400 | The interval is not in the backend allowlist | Use one of `1m,3m,5m,15m,30m,1h,2h,4h,6h,8h,12h,1d,3d,1w,1M`. |

## Stop Local Services

Stop containers:

```bash
docker compose down
```

Kafka data is stored in the named volume `kafka_data`. QuestDB data is stored in `data/questdb`. Delete those only if you want to remove local data.
