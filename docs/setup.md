# Local Setup and Operations

This is the authoritative guide for configuring, starting, verifying, repairing, and stopping NexTick locally. For system behavior and guarantees, see [System Architecture](architecture.md).

## Prerequisites

- Docker Engine or Docker Desktop with Docker Compose v2.
- Node.js `^20.19.0` or `>=22.12.0` and npm. This requirement comes from the resolved Vite 8 package; NestJS 11 requires Node.js 20 or newer.
- Python 3.10 when running the data pipeline or its tests on the host. The pipeline Docker image uses Python 3.10.
- Network access to Binance WebSocket and REST endpoints and to package registries during installation.
- Available local ports: `9092`, `8080`, `9000`, `8812`, `9009`, `3000`, and `5173`.

Run repository-level Docker and Python commands from the repository root. There is no root `package.json`; run npm commands inside `backend/` or `frontend/`.

## Environment Configuration

Create the three untracked environment files:

```powershell
Copy-Item data_pipeline\.env.example data_pipeline\.env
Copy-Item backend\.env.example backend\.env
Copy-Item frontend\.env.example frontend\.env
```

The pipeline example already contains usable local defaults. The backend and frontend examples deliberately contain blank values and must be filled.

### `data_pipeline/.env`

The checked-in example is the canonical local template. Its default topics, symbols, intervals, Binance endpoints, and startup policy work with Compose. Keep these distinctions in mind:

| Variables | Local behavior |
| --- | --- |
| `QUESTDB_HOST`, `QUESTDB_PORT`, `QUESTDB_USER`, `QUESTDB_PASSWORD`, `QUESTDB_DB_NAME` | Required at import time. Use `localhost:8812` on the host; Compose overrides the host to `questdb`. |
| `KAFKA_BROKER`, `KAFKA_TOPIC_MARKET_TRADES`, `KAFKA_TOPIC_KLINE_STREAM` | Required. Use `localhost:9092` on the host; Compose overrides the broker to `kafka:29092`. Topic values are also consumed by `kafka-setup`. |
| `KAFKA_CONSUMER_GROUP_ID` | Processor group; defaults to `candle-processor-group` if missing or blank. |
| `KAFKA_AUTO_OFFSET_RESET` | `earliest` or `latest`; invalid values fall back to `earliest`. |
| `BINANCE_SOCKET_URL` | Required WebSocket base URL. The producer appends the combined `streams=` query. |
| `TRADING_SYMBOLS` | Comma-separated symbols. Keep it non-empty and align it with frontend choices. |
| `CANDLE_INTERVALS` | Comma-separated processor intervals. Invalid values stop pipeline configuration. |
| `STARTUP_RECONCILE_ENABLED`, `STARTUP_RECONCILE_REQUIRED` | Both default to `true` when missing or blank. Required reconciliation failure blocks processor startup. |
| `STARTUP_RECONCILE_MAX_ATTEMPTS`, `STARTUP_RECONCILE_RETRY_DELAY_SECONDS` | Retry count and initial exponential delay for the one-shot startup service. |
| `STARTUP_RECONCILE_SYMBOLS` | Optional override; blank uses `TRADING_SYMBOLS`. |
| `STARTUP_RECONCILE_DRY_RUN`, `STARTUP_RECONCILE_KEEP_TEMP` | Validate without writes, or retain reconciliation tables for investigation. Both default to `false`. |
| `STARTUP_RECONCILE_BINANCE_REST_URL`, `STARTUP_RECONCILE_TOLERANCE` | REST base URL and numeric verification tolerance. |
| `STARTUP_RECONCILE_BOOTSTRAP_CANDLES` | Empty-symbol bootstrap count, capped in code at 480 one-minute candles. |
| `STARTUP_RECONCILE_WAIT_FOR_OPEN_CANDLE_CLOSE`, `STARTUP_RECONCILE_CLOSE_GRACE_SECONDS` | Wait for the startup minute to close; defaults are `true` and `2` seconds. |
| `STARTUP_BACKFILL_STATE_FILE`, `CANDLE_PROCESSOR_STATE_FILE`, `PROCESSOR_READY_FILE` | Leave blank for host defaults. Compose overrides them to paths in the shared `pipeline_state` volume. |

`STARTUP_RECONCILE_WINDOW_HOURS` is deprecated and ignored if set. Reconciliation uses each symbol's valid QuestDB watermark and an eight-hour maximum range.

The supported interval identifiers are `1m`, `3m`, `5m`, `15m`, `30m`, `1h`, `2h`, `4h`, `6h`, `8h`, `12h`, `1d`, `3d`, `1w`, and `1M`.

### `backend/.env`

Use these local values unless you changed ports, topic names, or credentials:

```dotenv
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

`FRONTEND_URL` is the REST and Socket.IO browser origin. `BACKEND_URL` is used for startup messages and is also allowed by Socket.IO CORS. `KAFKA_TOPIC_KLINE_STREAM` must match the pipeline value.

### `frontend/.env`

```dotenv
VITE_API_URL=http://localhost:3000
VITE_API_HEALTH_URL=http://localhost:3000/health
VITE_SOCKET_URL=http://localhost:3000
VITE_TRADING_SYMBOLS=BTCUSDT,ETHUSDT
VITE_CANDLE_INTERVALS=1m,3m,5m,15m,30m,1h,2h,4h,6h,8h,12h,1d,3d,1w,1M
```

Vite reads these variables when the development server or build starts. Restart Vite after changing them. Keep frontend symbols within `TRADING_SYMBOLS`; keep intervals within both the backend allowlist and pipeline `CANDLE_INTERVALS` if live updates are expected.

## Docker Services

| Service | Lifecycle | Responsibility | Host ports |
| --- | --- | --- | --- |
| `kafka` | Long-running | Single-node KRaft broker | `9092` |
| `kafka-ui` | Long-running | Local topic/consumer inspection | `8080` |
| `kafka-setup` | One-shot | Waits for Kafka and creates both configured topics | None |
| `questdb` | Long-running | Candle storage and console | `9000`, `8812`, `9009` |
| `data-producer` | Long-running | Binance trade ingestion | None |
| `data-backfill` | One-shot | Startup reconciliation and cutover state | None |
| `data-processor` | Long-running | Candle aggregation, kline output, and final `1m` persistence | None |
| `questdb-storage-migrate` | Opt-in `migration` profile | Copies a legacy bind-mounted QuestDB installation into the named volume | None |

The backend and frontend are not defined in `docker-compose.yml`.

## Fresh-Clone Startup

### 1. Start infrastructure and the pipeline

After creating the environment files:

```bash
docker compose up -d kafka kafka-ui kafka-setup questdb data-producer data-backfill data-processor
```

Compose builds the shared Python image automatically when it is absent. Use `--build` only after changing `Dockerfile`, `requirements.txt`, or `data_pipeline/`:

```bash
docker compose up -d --build data-producer data-backfill data-processor
```

Inspect startup:

```bash
docker compose ps -a
docker compose logs -f kafka-setup data-producer data-backfill data-processor
```

Expected steady state:

- `kafka`, `kafka-ui`, `questdb`, `data-producer`, and `data-processor` are running;
- `kafka` and `questdb` are healthy;
- `data-processor` becomes healthy after writing its ready marker;
- `kafka-setup` and `data-backfill` have exited with code `0`.

Startup order is topics/QuestDB, producer plus backfill, then processor. Backfill chooses the next Binance minute boundary, waits for that minute plus its close grace, reconciles through the boundary, and writes the cutover state. A normal startup can therefore wait roughly one minute before the processor starts.

### 2. Start the backend

In a new terminal:

```bash
cd backend
npm ci
npm run start:dev
```

The backend process can start while Kafka or QuestDB is unavailable. It retries each dependency every five seconds; `/health` returns `503` until both are marked available.

### 3. Start the frontend

In another terminal:

```bash
cd frontend
npm ci
npm run dev
```

Open `http://localhost:5173`.

## Local Addresses

| Endpoint | Address |
| --- | --- |
| Frontend | `http://localhost:5173` |
| Backend root | `http://localhost:3000` |
| Backend health | `http://localhost:3000/health` |
| Candle API | `http://localhost:3000/candles` |
| Swagger UI | `http://localhost:3000/api/docs` |
| Kafka UI | `http://localhost:8080` |
| QuestDB Console | `http://localhost:9000` |

## Manual Pipeline Execution

Use this workflow when developing the Python services outside their containers.

Start only Kafka and QuestDB:

```bash
docker compose up -d kafka kafka-ui kafka-setup questdb
python -m venv .venv
```

Activate the environment and install dependencies:

```powershell
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Then preserve this order:

1. Start the producer and wait for its Binance connection message:

   ```powershell
   python -m data_pipeline.producer.binance_producer
   ```

2. In a second activated terminal, run backfill to completion:

   ```powershell
   python -m data_pipeline.backfill.runner
   ```

3. In a third activated terminal, start the processor:

   ```powershell
   python -m data_pipeline.processor.runner
   ```

The backfill runner and processor must resolve the same `STARTUP_BACKFILL_STATE_FILE`. Blank values use the same operating-system temporary directory when both run as the same user. Do not start a manual processor alongside the Compose processor.

## Verification

### Runtime checks

```bash
docker compose ps -a
curl http://localhost:3000/health
curl "http://localhost:3000/candles?symbol=BTCUSDT&interval=1m&limit=5"
```

The health response should report both `questdb` and `kafka` as `true`. The candle response can legitimately contain fewer than five rows during first startup or when the selected symbol has sparse/recent history.

In the QuestDB Console, verify canonical rows:

```sql
SELECT symbol, interval, timestamp, open, high, low, close, volume
FROM market_candles
WHERE symbol = 'BTCUSDT' AND interval = '1m'
ORDER BY timestamp DESC
LIMIT 20;
```

Only final `1m` rows should be persisted by normal processing.

### Tests, lint, and builds

Backend:

```bash
cd backend
npm test
npm run test:e2e
npm run build
```

`npm run lint` is available, but its script includes `--fix` and may modify TypeScript files.

Frontend:

```bash
cd frontend
npm run lint
npm run build
```

There is no frontend automated test script or committed frontend test suite.

Pipeline, from the repository root with its dependencies installed:

```bash
python -m unittest data_pipeline.tests.test_startup_backfill
python -m compileall data_pipeline
```

The existing tests do not start real Kafka, QuestDB, Binance, or a browser. See each component README for the exact coverage boundary.

## Persistent Storage and Lifecycle Commands

Compose declares three named volumes:

| Volume | Contents | Consequence if lost |
| --- | --- | --- |
| `questdb_data` | QuestDB database | All canonical candle history in the local Compose installation is lost |
| `kafka_data` | Broker logs, consumer offsets, and retained topic data | Replay buffer and consumer progress are lost |
| `pipeline_state` | Startup cutover, processor snapshot/retry maps, and ready marker | Processor resumes without its previous active/retry state; a fresh startup backfill is required for a new cutover |

Docker prefixes these names with the Compose project name unless an explicit project name is used.

### Normal pause or service restart

```bash
docker compose stop
docker compose restart data-producer
docker compose restart data-processor
```

These commands retain containers and volumes. Restarting only the processor reuses the existing cutover, local state, and Kafka group offset; it does not run startup backfill again. If an outage approaches or exceeds Kafka's two-hour retention, run the reconciliation workflow below before restarting. Reconciliation itself is capped at eight hours, so longer downtime can still leave an unrepaired gap.

### Recreate containers while preserving data

```bash
docker compose down
docker compose up -d kafka kafka-ui kafka-setup questdb data-producer data-backfill data-processor
```

`docker compose down` removes project containers and the default network but preserves named volumes. The next `up` recreates the one-shot backfill service and establishes a fresh cutover.

### Rebuild pipeline images while preserving data

```bash
docker compose up -d --build data-producer data-backfill data-processor
```

Image/container replacement does not remove named volumes.

### Destructive local reset

> **Warning:** The next command permanently deletes the Compose project's QuestDB history, Kafka data/offsets, and processor/backfill state. It is not a normal startup fix. Back up anything needed first.

```bash
docker compose down --volumes
```

The ignored legacy directory `data/questdb` is a host bind-mount source and is not deleted by `down --volumes`.

## Trailing Reconciliation and Repair

The implemented reconciler repairs only the trailing range after each symbol's newest valid `1m` watermark, capped at 480 minutes. If no valid watermark exists, it bootstraps up to the configured cap. It does not accept an arbitrary start/end range, scan for holes before the newest valid row, or replace a valid-but-incorrect older row.

Reconciliation copies and swaps the full table. Keep the processor stopped so it remains the only database writer. Leave the producer running so new trades continue buffering in Kafka, and keep the operation within Kafka's two-hour local retention window.

1. Stop the processor:

   ```bash
   docker compose stop data-processor
   ```

2. Run a safe dry run using a separate state path so the active cutover is untouched:

   ```bash
   docker compose run --rm -e STARTUP_RECONCILE_DRY_RUN=true -e STARTUP_BACKFILL_STATE_FILE=/tmp/nextick/startup-backfill-dry-run.json data-backfill
   ```

3. If validation succeeds, run the real backfill service. This replaces the eligible range and writes a new authoritative cutover:

   ```bash
   docker compose run --rm -e STARTUP_RECONCILE_DRY_RUN=false data-backfill
   ```

   To limit symbols, add `-e STARTUP_RECONCILE_SYMBOLS=BTCUSDT,ETHUSDT`. To retain staging/backup tables for investigation, add `-e STARTUP_RECONCILE_KEEP_TEMP=true` and clean them manually only after verification.

4. Do not restart the processor if the real run fails, because the runner removes stale cutover state before attempting reconciliation. Resolve the reported Binance or QuestDB error and rerun the same command successfully.

5. Start and verify the processor:

   ```bash
   docker compose start data-processor
   docker compose logs -f data-processor
   ```

   The one-off backfill output is shown directly while each `docker compose run` command executes; `--rm` removes that temporary container after it exits.

The lower-level command `python -m data_pipeline.backfill.reconciler --dry-run` is useful during pipeline development. A non-dry direct reconciler run does **not** write the processor cutover state; prefer `data_pipeline.backfill.runner` or the Compose workflow above for an operational repair.

## Legacy QuestDB Storage Migration

`questdb-storage-migrate` exists for installations created before Compose moved QuestDB from the host bind mount `./data/questdb` to the Docker-managed `questdb_data` volume. New installations do not need it.

The service maps:

- source: repository `data/questdb` to `/source`, read-only;
- target: `questdb_data` to `/target`;
- operation: `cp -a /source/. /target/`, then create `/target/.nextick-storage-migrated`.

The source is preserved. A target marker makes later invocations exit without copying.

> **Warning:** Run this only for a legacy installation and before writing new data to `questdb_data`. If an unmarked target already contains different QuestDB data, the copy can merge or overwrite files. Stop QuestDB first and preserve a backup of both locations when the target state is uncertain.

1. Stop and remove current containers without deleting volumes:

   ```bash
   docker compose down
   ```

2. Confirm that the legacy source exists and contains a `db` directory:

   ```powershell
   Test-Path data\questdb\db
   ```

3. Copy the legacy installation:

   ```bash
   docker compose --profile migration run --rm questdb-storage-migrate
   ```

   Success prints `QuestDB storage migration completed. The source directory remains unchanged.` An already migrated volume prints that migration was already completed.

4. Start QuestDB and inspect its logs:

   ```bash
   docker compose up -d questdb
   docker compose logs questdb
   ```

5. Open `http://localhost:9000` and verify expected tables and row counts, for example:

   ```sql
   SELECT table_name FROM tables();
   SELECT count() FROM market_candles;
   ```

Do not delete `data/questdb` until the named-volume database has been started and its contents independently verified.

## Troubleshooting

### Compose reports a missing environment file

Create `data_pipeline/.env` before any command that includes `kafka-setup` or a Python service. Compose reads this file even though most values have defaults in the checked-in example.

### `data-backfill` exits with code `1`

```bash
docker compose logs data-backfill questdb
```

Check Binance network access, QuestDB health, credentials, and reconciliation validation messages. With `STARTUP_RECONCILE_REQUIRED=true`, the processor correctly remains stopped. Do not delete volumes as a first response.

### Backfill appears slow at a minute boundary

This is expected. It waits until the Binance minute that was open at startup closes and then waits `STARTUP_RECONCILE_CLOSE_GRACE_SECONDS` before fetching it as a closed candle.

### `data-processor` is unhealthy or absent

Check that `data-backfill` exited successfully, then inspect:

```bash
docker compose ps -a
docker compose logs data-processor
```

The health check requires `/tmp/nextick/processor-ready`, which the runner creates only after processor construction succeeds.

### Backend `/health` returns `503`

The body identifies `questdb` and `kafka` availability. Confirm the backend uses host addresses (`localhost:8812` and `localhost:9092`), not Compose-only names, and inspect the backend reconnect logs. The process does not need to be restarted after a transient dependency outage.

### The chart is empty

1. Verify `/health` and request `GET /candles` directly.
2. Confirm the selected frontend symbol is in pipeline `TRADING_SYMBOLS`.
3. Confirm the selected interval is allowed by the backend and included in pipeline `CANDLE_INTERVALS` for live updates.
4. Check that backfill completed and the processor is healthy.
5. Inspect browser console, backend logs, and `data-processor` logs for validation failures.

### The chart stops updating after a Socket.IO reconnect

The current frontend reconnects the transport but does not automatically rejoin active rooms. Reload the page or switch the symbol/interval to rerun the room-join effect. This is a documented implementation limitation, not a reason to reset stored data.

### Kafka topics are missing or mismatched

Check `data_pipeline/.env`, rerun the idempotent setup service, and inspect Kafka UI:

```bash
docker compose up kafka-setup
```

The backend kline topic must match `KAFKA_TOPIC_KLINE_STREAM`; the processor raw-trade topic and `kafka-setup` must share `KAFKA_TOPIC_MARKET_TRADES`.

### QuestDB fails on a Windows bind mount

The supported Compose configuration uses `questdb_data`, a Docker-managed Linux filesystem, because QuestDB uses WAL and memory-mapped files. Do not replace it with a Windows host bind mount. Use the migration profile once if upgrading a legacy bind-mounted installation.

### A local port is already in use

Stop the conflicting process or change both the Compose port mapping and every host-side environment URL that references it. Container-to-container values such as `kafka:29092` and `questdb:8812` do not change when only host ports change.

## Shutdown

Stop the frontend and backend development servers with `Ctrl+C`. To stop Compose services while retaining their containers and data:

```bash
docker compose stop
```

To remove containers and the network while retaining named-volume data:

```bash
docker compose down
```

Use the destructive reset command only when permanent deletion of all local persisted state is intentional.
