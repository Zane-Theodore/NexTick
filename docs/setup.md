# NexTick Setup

This guide runs NexTick locally with Docker Compose for Kafka, Kafka UI, QuestDB, and the Python data pipeline, plus local Node processes for the backend and frontend.

The repository has no root `package.json`. Run backend and frontend commands inside their own folders.

## Requirements

| Tool | Required for |
| --- | --- |
| Docker and Docker Compose | Kafka, Kafka UI, QuestDB, `data-producer`, `data-backfill`, and `data-processor`. |
| Node.js and npm | NestJS backend and Vite frontend. |
| Python 3.10+ | Manual data pipeline runs without pipeline containers. |
| PowerShell, Git Bash, or another shell | Copying env files and running commands. |

The Docker image for the pipeline uses `python:3.10-slim`.

## 1. Copy Environment Files

From the repository root, Windows PowerShell:

```powershell
Copy-Item data_pipeline\.env.example data_pipeline\.env
Copy-Item backend\.env.example backend\.env
Copy-Item frontend\.env.example frontend\.env
```

macOS/Linux or Git Bash:

```bash
cp data_pipeline/.env.example data_pipeline/.env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

## 2. Fill Environment Values

`data_pipeline/.env.example` includes local defaults for the Docker pipeline.
`backend/.env.example` and `frontend/.env.example` use blank values. Review and
fill each local `.env` before starting services.

### `data_pipeline/.env`

```env
QUESTDB_HOST=localhost
QUESTDB_PORT=8812
QUESTDB_USER=admin
QUESTDB_PASSWORD=quest
QUESTDB_DB_NAME=qdb

KAFKA_BROKER=localhost:9092
KAFKA_TOPIC_MARKET_TRADES=market-trades
KAFKA_TOPIC_KLINE_STREAM=kline-stream
KAFKA_CONSUMER_GROUP_ID=candle-processor-group
KAFKA_AUTO_OFFSET_RESET=earliest

BINANCE_SOCKET_URL=wss://stream.binance.com:9443/stream
TRADING_SYMBOLS=BTCUSDT,ETHUSDT
CANDLE_INTERVALS=1m,3m,5m,15m,30m,1h,2h,4h,6h,8h,12h,1d,3d,1w,1M

STARTUP_RECONCILE_ENABLED=false
STARTUP_RECONCILE_REQUIRED=true
STARTUP_RECONCILE_WAIT_FOR_OPEN_CANDLE_CLOSE=true
```

Docker Compose overrides `KAFKA_BROKER=kafka:29092` and `QUESTDB_HOST=questdb` inside pipeline containers.

`TRADING_SYMBOLS` and `CANDLE_INTERVALS` should not be blank. The code has defaults only when those variables are unset; a blank value in `.env` overrides the default with an empty list.

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

The backend connects to QuestDB and Kafka during startup.

### `frontend/.env`

```env
VITE_API_URL=http://localhost:3000
VITE_API_HEALTH_URL=http://localhost:3000/health
VITE_SOCKET_URL=http://localhost:3000
VITE_TRADING_SYMBOLS=BTCUSDT,ETHUSDT
VITE_CANDLE_INTERVALS=1m,3m,5m,15m,30m,1h,2h,4h,6h,8h,12h,1d,3d,1w,1M
```

`VITE_TRADING_SYMBOLS` and `VITE_CANDLE_INTERVALS` should be filled so frontend options match the pipeline and backend. If either value is missing or blank, the frontend falls back to `BTCUSDT` and `1m`.

## 3. Start Docker Services

From the repository root:

```bash
docker compose up -d --build kafka kafka-ui kafka-setup questdb data-producer data-backfill data-processor
```

Startup backfill is disabled by default. Set `STARTUP_RECONCILE_ENABLED=true` in
`data_pipeline/.env` before startup to opt in.

Check containers:

```bash
docker compose ps
```

View logs:

```bash
docker compose logs -f kafka-setup data-producer data-backfill data-processor
```

Local service URLs:

| Service | URL |
| --- | --- |
| Kafka UI | `http://localhost:8080` |
| QuestDB Console | `http://localhost:9000` |
| Kafka broker for host apps | `localhost:9092` |
| QuestDB PostgreSQL wire for host apps | `localhost:8812` |
| QuestDB ILP TCP for host apps | `localhost:9009` |

Expected service order:

1. `kafka` becomes healthy.
2. `kafka-setup` creates `market-trades` and `kline-stream`.
3. `questdb` becomes healthy.
4. `data-producer` starts after Kafka topics exist and connects to Binance raw trade streams.
5. `data-backfill` exits without database writes by default. When enabled, it repairs the closed startup candle window and writes a shared watermark.
6. `data-processor` starts after `data-backfill` exits successfully, then consumes buffered klines. It skips final `1m` DB upserts before the watermark only when enabled backfill wrote one.

## 4. Start the Backend

Open a new terminal:

```bash
cd backend
npm install
npm run start:dev
```

Backend URLs:

| URL | Purpose |
| --- | --- |
| `http://localhost:3000` | Backend API root. |
| `http://localhost:3000/health` | Backend health endpoint. |
| `http://localhost:3000/api/docs` | Swagger UI. |
| `http://localhost:3000/candles?symbol=BTCUSDT&interval=1m&limit=100` | Historical candle API. |

Check health:

```bash
curl "http://localhost:3000/health"
```

Check candles:

```bash
curl "http://localhost:3000/candles?symbol=BTCUSDT&interval=1m&limit=20"
```

If `data` is empty, wait until the processor has saved at least one final `1m` candle.

## 5. Start the Frontend

Open a new terminal:

```bash
cd frontend
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

The frontend:

1. Reads symbols from `VITE_TRADING_SYMBOLS`.
2. Reads intervals from `VITE_CANDLE_INTERVALS`.
3. Calls `GET {VITE_API_URL}/candles?symbol=...&interval=...&limit=2000`.
4. Draws history with `setData()`.
5. Joins Socket.IO room `{SYMBOL}_{interval}`.
6. Applies `kline_update` with `update()` for candles and volume.
7. Recalculates visible indicator series from maintained candle history.
8. Checks `VITE_API_HEALTH_URL` for footer status.

## Optional: Run Pipeline Manually

Use this only if you want Kafka and QuestDB in Docker but the Python producer and processor on your host.

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
```

Pipeline syntax check:

```bash
python -m compileall data_pipeline
```

Pipeline operational checks:

```bash
docker compose logs -f data-producer data-backfill data-processor
```

Use Kafka UI to inspect topics:

```text
http://localhost:8080
```

Use QuestDB Console to query stored candles:

```text
http://localhost:9000
```

```sql
SELECT *
FROM market_candles
WHERE symbol = 'BTCUSDT'
ORDER BY timestamp DESC
LIMIT 20;
```

## Reconcile Missing Candles

Use the pipeline reconciler when stored `1m` candles are missing or need to be
filled from Binance REST data. The startup backfill repairs one 24-hour window
through Binance's latest closed minute and writes a watermark so the processor
does not overwrite that window while draining buffered kline updates.

Docker Compose runs `data-backfill` once before `data-processor` starts, but it
does no work unless `STARTUP_RECONCILE_ENABLED=true`. The startup/manual
`data_pipeline.backfill.reconciler` path builds replacement
tables and swaps the bounded target window into `market_candles`. Stop the live
writer before any manual repair workflow that drops, recreates, or migrates
`market_candles`.

```bash
docker compose stop data-processor
python -m data_pipeline.backfill.reconciler
docker compose start data-processor
```

Useful dry-run and inspection modes:

```bash
python -m data_pipeline.backfill.reconciler --dry-run
python -m data_pipeline.backfill.reconciler --symbols BTCUSDT,ETHUSDT
python -m data_pipeline.backfill.reconciler --window-hours 24 --end-lag-minutes 2
python -m data_pipeline.backfill.reconciler --keep-temp
```

If a previous reconcile failed after dropping `market_candles`, run the same
command again. The script restores `market_candles` from the newest
`market_candles_old_*` backup before continuing.

Stored-candle repair uses the manual replacement reconciler above with the live
processor stopped. Docker Compose keeps `data-processor` as the only live
QuestDB writer.

## Troubleshooting

| Problem | Likely cause | Fix |
| --- | --- | --- |
| Kafka is not ready | Broker is still starting or `kafka-setup` has not completed | Run `docker compose ps` and `docker compose logs -f kafka kafka-setup`. |
| Topics are missing | `data_pipeline/.env` topic names are blank or `kafka-setup` did not finish | Fill env values and run `docker compose up -d kafka-setup`. |
| QuestDB is not ready | QuestDB healthcheck has not passed | Check `http://localhost:9000` or `docker compose logs -f questdb`. |
| Backend startup failed | Kafka or QuestDB is unavailable, or env values are blank | Confirm Docker services are healthy and `backend/.env` is filled. |
| `data-producer` does not start | Kafka topics are not ready or Binance WebSocket connection failed | Check `docker compose logs -f kafka-setup data-producer`. |
| Frontend does not load data | Backend is down, `VITE_API_URL` is wrong, or no candles exist yet | Check `/health`, `/candles`, and frontend `.env`; wait for a final `1m` candle. |
| Footer shows `Offline` | `VITE_API_HEALTH_URL` is missing or backend `/health` is unreachable | Set `VITE_API_HEALTH_URL=http://localhost:3000/health` and restart Vite. |
| Socket.IO CORS error | `FRONTEND_URL` or `BACKEND_URL` does not match the browser/backend origin | Update `backend/.env` and restart NestJS. |
| `GET /candles` returns empty data | QuestDB has no final `1m` rows yet | Check `data-processor` logs and query `market_candles`; wait at least one minute after raw trade streaming starts. |
| `market_candles` is missing after reconciliation | A previous manual full repair failed after dropping the live table | Stop `data-processor`, then run `python -m data_pipeline.backfill.reconciler` to restore from the newest `market_candles_old_*` backup. |
| Binance producer cannot connect | Network, DNS, or Binance access issue | Check `data-producer` logs; Compose sets DNS to `8.8.8.8` and `8.8.4.4`. |
| Interval returns 400 | Interval is not in backend `VALID_INTERVALS` | Use one of `1m,3m,5m,15m,30m,1h,2h,4h,6h,8h,12h,1d,3d,1w,1M`. |
| Chart only shows fallback market options | `VITE_TRADING_SYMBOLS` or `VITE_CANDLE_INTERVALS` is blank or undefined | Fill both frontend env values and restart Vite. |

## Stop Local Services

Stop containers:

```bash
docker compose down
```

Kafka data is stored in Docker volume `kafka_data`. QuestDB data is stored under `data/questdb`.
