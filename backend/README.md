# NexTick Backend - NestJS REST API & WebSocket Server

[![TypeScript](https://img.shields.io/badge/TypeScript-6.0+-3178c6.svg)](https://www.typescriptlang.org/)
[![NestJS](https://img.shields.io/badge/NestJS-11.0+-ea2845.svg)](https://nestjs.com/)
[![Jest](https://img.shields.io/badge/Jest-Testing-c16d7a.svg)](https://jestjs.io/)

A scalable, production-grade REST API and WebSocket server built with NestJS for real-time cryptocurrency trading data. Provides both historical candlestick data and real-time streaming updates with multi-room WebSocket support.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Folder Structure](#folder-structure)
- [Environment Variables](#environment-variables)
- [Installation](#installation)
- [Running Locally](#running-locally)
- [Development Commands](#development-commands)
- [API Endpoints](#api-endpoints)
- [WebSocket Events](#websocket-events)
- [Database Integration](#database-integration)
- [Event Emitter Pattern](#event-emitter-pattern)
- [Authentication & Authorization](#authentication--authorization)
- [Testing](#testing)
- [Debugging](#debugging)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

## Overview

The NexTick backend is a high-performance API server that:

- **Serves historical candlestick data** via REST API with flexible time intervals
- **Streams real-time candle updates** via WebSocket with room-based subscriptions
- **Connects to QuestDB** for sub-millisecond time-series queries
- **Consumes Kafka events** from the data pipeline for real-time candle data
- **Emits events** via Socket.IO to connected frontend clients
- **Handles CORS** for frontend cross-origin requests
- **Validates input** with strong TypeScript typing

## Architecture

### Module Structure

```
src/
├── main.ts                          # Application bootstrap
├── app.module.ts                    # Root module with DI container
├── app.controller.ts                # Health check endpoint
├── app.service.ts
├── common/                          # Shared utilities
│   ├── decorators/
│   ├── filters/                     # Exception filters
│   ├── guards/                      # Authentication guards
│   └── middleware/
│
└── modules/
    ├── candles/                     # Candlestick data API
    │   ├── candles.controller.ts    # GET /candles endpoint
    │   ├── candles.service.ts       # Business logic
    │   ├── candles.gateway.ts       # WebSocket handler
    │   ├── candles.module.ts        # Module definition
    │   ├── dto/                     # Request/response DTOs
    │   └── entities/                # Database models
    │
    ├── kafka/                       # Message broker integration
    │   ├── kafka.service.ts         # Kafka consumer logic
    │   ├── kafka.module.ts          # Kafka configuration
    │   └── interfaces/              # Type definitions
    │
    └── database/                    # Data persistence
        ├── database.service.ts      # PostgreSQL/QuestDB queries
        ├── database.module.ts       # Database connection pooling
        └── schemas/                 # SQL table definitions
```

### Data Flow

```
Kafka Topic: kline_stream
     │
     ▼
┌──────────────────────────┐
│  KafkaService            │
│  - Consumer              │
│  - Message validation    │
│  - Event emission        │
└────────────┬─────────────┘
             │ candle.update event
             ▼
┌──────────────────────────┐
│  CandlesGateway          │
│  - WebSocket handler     │
│  - Room management       │
│  - Event broadcasting    │
└──────────────────────────┘
             │
             ▼ kline_update
     Connected Clients
        (Frontend)

REST API Request: GET /candles?symbol=BTCUSDT
     │
     ▼
┌──────────────────────────┐
│  CandlesController       │
│  - Request validation    │
│  - Query parsing         │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│  CandlesService          │
│  - Interval validation   │
│  - Data transformation   │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│  DatabaseService         │
│  - PostgreSQL pool       │
│  - SQL execution         │
└────────────┬─────────────┘
             │
             ▼
         QuestDB
      (time-series DB)
```

## Folder Structure

```
backend/
├── src/
│   ├── main.ts                         # Bootstrap function
│   ├── app.module.ts                   # Root module configuration
│   ├── app.controller.ts               # Main controller (GET /)
│   ├── app.service.ts                  # Main service
│   │
│   ├── modules/
│   │   │
│   │   ├── candles/
│   │   │   ├── candles.controller.ts   # Route: GET /candles
│   │   │   │                           # Query params: symbol, interval, limit
│   │   │   │                           # Response: { success, symbol, interval, count, data }
│   │   │   │
│   │   │   ├── candles.service.ts      # getHistoricalCandles()
│   │   │   │                           # Validates intervals
│   │   │   │                           # Aggregates 1m candles by interval
│   │   │   │                           # Returns reversed/sorted candles
│   │   │   │
│   │   │   ├── candles.gateway.ts      # WebSocket @WebSocketGateway()
│   │   │   │                           # @SubscribeMessage('join_kline_room')
│   │   │   │                           # @SubscribeMessage('leave_kline_room')
│   │   │   │                           # @OnEvent('candle.update')
│   │   │   │                           # Broadcasts to room: {SYMBOL}_{INTERVAL}
│   │   │   │
│   │   │   ├── candles.module.ts       # Module imports + providers
│   │   │   │
│   │   │   └── candles.controller.spec.ts
│   │   │
│   │   ├── kafka/
│   │   │   ├── kafka.service.ts        # Kafka consumer for kline_stream topic
│   │   │   │                           # Parses JSON candle messages
│   │   │   │                           # Emits candle.update event
│   │   │   │
│   │   │   └── kafka.module.ts         # Module with KafkaService provider
│   │   │
│   │   ├── database/
│   │   │   ├── database.service.ts     # PostgreSQL client pool
│   │   │   │                           # query(sql, params) method
│   │   │   │                           # Connection lifecycle hooks
│   │   │   │
│   │   │   └── database.module.ts      # Module with DatabaseService export
│   │   │
│   │   └── common/                     # Shared across modules
│   │       ├── decorators/
│   │       ├── filters/
│   │       └── guards/
│   │
│   └── common/                         # Global utilities
│       └── ...
│
├── test/
│   ├── app.e2e-spec.ts                 # End-to-end tests
│   └── jest-e2e.json                   # Jest E2E configuration
│
├── dist/                               # Compiled output (generated)
├── coverage/                           # Test coverage (generated)
│
├── package.json                        # Dependencies and scripts
├── tsconfig.json                       # TypeScript configuration
├── tsconfig.build.json                 # Build-specific TS config
├── nest-cli.json                       # NestJS CLI config
├── eslint.config.mjs                   # ESLint configuration
├── jest.config.js                      # Jest testing configuration (inline in package.json)
│
└── README.md                           # This file
```

## Environment Variables

### Required Variables

Create `.env` file in project root:

```env
# Kafka Configuration
KAFKA_BROKER=kafka:29092                    # Broker addresses (comma-separated)
KAFKA_SERVER=kafka:29092                    # Server address for producer
KAFKA_CLIENT_ID=nextick-backend             # Client identifier
KAFKA_GROUP_ID=nextick-candle-consumer      # Consumer group
KAFKA_TOPIC_KLINE_STREAM=kline_stream       # Topic for candle updates

# QuestDB Configuration
QUESTDB_USER=admin                          # Database user
QUESTDB_PASSWORD=quest                      # Database password
QUESTDB_HOST=questdb                        # Database host
QUESTDB_DB_NAME=qdb                         # Database name
QUESTDB_PORT=8812                           # PostgreSQL protocol port
QUESTDB_POOL_MAX=10                         # Connection pool size
QUESTDB_POOL_TIMEOUT=30000                  # Connection timeout (ms)
QUESTDB_POOL_IDLE_TIMEOUT=60000             # Idle connection timeout (ms)

# Server Configuration
PORT=3000                                   # Express server port (optional, defaults to 3000)
NODE_ENV=development                        # development | production
```

### Environment-Specific Configuration

**Development** (`.env.development`):
```env
NODE_ENV=development
KAFKA_BROKER=localhost:9092
QUESTDB_HOST=localhost
QUESTDB_PORT=8812
PORT=3000
```

**Production** (`.env.production`):
```env
NODE_ENV=production
KAFKA_BROKER=kafka-prod-1:9092,kafka-prod-2:9092
QUESTDB_HOST=questdb-prod.internal
QUESTDB_PORT=8812
PORT=80
```

## Installation

### Prerequisites

- Node.js 18+
- npm or yarn
- Kafka running and accessible
- QuestDB running and accessible
- `.env` file configured

### Install Dependencies

```bash
cd backend

# Using npm
npm install

# Using yarn
yarn install

# Using pnpm
pnpm install
```

### Verify Installation

```bash
# Check all dependencies are installed
npm list

# Verify TypeScript compiles
npm run build

# Check linting passes
npm run lint
```

## Running Locally

### Development Mode (Hot Reload)

```bash
# Terminal 1: Start Kafka and QuestDB
cd ..  # Back to NexTick root
docker-compose up

# Terminal 2: Start backend
cd backend
npm run start:dev

# Expected output:
# [Nest] PID    01/15/2024, 10:30:00 AM     LOG [NestFactory] Starting Nest application...
# [Nest] PID    01/15/2024, 10:30:02 AM     LOG [InstanceLoader] KafkaModule dependencies initialized
# [Nest] PID    01/15/2024, 10:30:02 AM     LOG [InstanceLoader] CandlesModule dependencies initialized
# [Nest] PID    01/15/2024, 10:30:02 AM     LOG [NestApplication] Nest application successfully started
# [Nest] PID    01/15/2024, 10:30:02 AM     LOG Listening on port 3000
```

### Production Mode (Compiled)

```bash
# Build
npm run build

# Start
npm run start:prod

# Or use Node directly
node dist/main
```

### Health Check

```bash
# Verify server is running
curl http://localhost:3000/

# Expected response:
# "Hello World!"
```

## Development Commands

### Build & Compilation

```bash
# Build TypeScript to JavaScript
npm run build

# Build in watch mode
npm run build -- --watch
```

### Development Server

```bash
# Start with auto-reload
npm run start:dev

# Start with debugger attached
npm run start:debug

# Start production build
npm run start:prod
```

### Code Quality

```bash
# Run ESLint and fix issues
npm run lint

# Format code with Prettier
npm run format

# Check code without fixing
npm run lint -- --no-fix
```

### Testing

```bash
# Run all unit tests
npm test

# Run tests in watch mode
npm test:watch

# Run tests with coverage report
npm test:cov

# Run E2E tests
npm run test:e2e

# Debug tests
npm run test:debug
```

## API Endpoints

### GET /candles

Retrieve historical candlestick data for a trading symbol at specified interval.

**Request:**
```http
GET /candles?symbol=BTCUSDT&interval=1m&limit=100
```

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `symbol` | string | ✅ Yes | - | Trading symbol (e.g., BTCUSDT, ETHUSDT) |
| `interval` | string | ❌ No | `1m` | Candle interval (see valid values below) |
| `limit` | number | ❌ No | `100` | Number of candles to return (max reasonable: 1000) |

**Valid Intervals:**
```
1m   5m   15m  30m  1h   2h   4h   6h   8h   12h  1d   3d   1w   1M
```

**Response (200 OK):**
```json
{
  "success": true,
  "symbol": "BTCUSDT",
  "interval": "1m",
  "count": 100,
  "data": [
    {
      "timestamp": "2024-01-15T10:00:00.000Z",
      "symbol": "BTCUSDT",
      "interval": "1m",
      "open": 45000.00,
      "high": 45500.00,
      "low": 44900.00,
      "close": 45200.00,
      "volume": 125.5
    },
    // ... 99 more candles
  ]
}
```

**Error Responses:**

```json
// 400 Bad Request - Missing symbol
{
  "statusCode": 400,
  "message": "Missing required query parameter: symbol (e.g., ?symbol=BTCUSDT)"
}

// 400 Bad Request - Invalid interval
{
  "statusCode": 400,
  "message": "Invalid time interval requested: 3m"
}

// 500 Internal Server Error - Database error
{
  "statusCode": 500,
  "message": "Internal server error"
}
```

**Example Requests:**

```bash
# Basic request
curl "http://localhost:3000/candles?symbol=BTCUSDT"

# With custom interval
curl "http://localhost:3000/candles?symbol=ETHUSDT&interval=5m"

# With limit
curl "http://localhost:3000/candles?symbol=BNBUSDT&interval=1h&limit=50"
```

**JavaScript/TypeScript:**
```typescript
import { getHistoricalCandles } from './services/api'

const candles = await getHistoricalCandles('BTCUSDT', '1m', 100)
```

### GET / (Health Check)

Simple endpoint to verify server is running.

```bash
curl http://localhost:3000/

# Response: "Hello World!"
```

## WebSocket Events

### Socket.IO Server Configuration

**Default Port**: 3000 (same as HTTP API)  
**Default Transports**: WebSocket + polling (fallback)  
**CORS Origins**: 
- `http://localhost:3000` (dev)
- `http://localhost:5173` (frontend dev)

### Client Connection

```typescript
import { io } from 'socket.io-client'

const socket = io('http://localhost:3000', {
  transports: ['websocket', 'polling'],
  withCredentials: true,
  autoConnect: true,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5,
})

socket.on('connect', () => {
  console.log('Connected to backend', socket.id)
})

socket.on('disconnect', (reason) => {
  console.log('Disconnected:', reason)
})
```

### Emit: join_kline_room

Subscribe to real-time candle updates for a specific symbol and interval.

**Event Name**: `join_kline_room`

**Payload:**
```typescript
interface JoinRoomPayload {
  symbol: string      // e.g., 'BTCUSDT'
  interval: string    // e.g., '1m', '5m', '1h'
}
```

**Usage:**
```typescript
socket.emit('join_kline_room', {
  symbol: 'BTCUSDT',
  interval: '1m'
})

// Server response logged to console
// "[INFO] [CandlesGateway] Client {socketId} joined room: BTCUSDT_1m"
```

**Notes:**
- Client joins a room named `{SYMBOL}_{INTERVAL}` (e.g., `BTCUSDT_1m`)
- Only candle updates for that symbol/interval are received
- Multiple rooms can be joined simultaneously
- Rooms persist until explicitly left or connection closes

### Emit: leave_kline_room

Unsubscribe from real-time candle updates for a specific symbol and interval.

**Event Name**: `leave_kline_room`

**Payload:**
```typescript
interface LeaveRoomPayload {
  symbol: string      // Must match joined room
  interval: string    // Must match joined room
}
```

**Usage:**
```typescript
socket.emit('leave_kline_room', {
  symbol: 'BTCUSDT',
  interval: '1m'
})
```

### On: kline_update

Receive real-time candle updates from subscribed rooms.

**Event Name**: `kline_update`

**Payload:**
```typescript
interface CandleUpdate {
  symbol: string              // e.g., 'BTCUSDT'
  interval: string            // e.g., '1m'
  timestamp: string           // ISO 8601 timestamp
  open: number                // Opening price
  high: number                // High price
  low: number                 // Low price
  close: number               // Closing price
  volume: number              // Trading volume
  is_final: boolean            // true = candle closed, false = candle updating
}
```

**Usage:**
```typescript
socket.on('kline_update', (candle: CandleUpdate) => {
  console.log(`${candle.symbol} [${candle.interval}]: ${candle.close}`)
  
  if (candle.is_final) {
    console.log('Candle closed, update chart')
  } else {
    console.log('Candle updating, live refresh')
  }
})
```

### Complete Example: Real-Time Chart Updates

```typescript
import { io } from 'socket.io-client'

const socket = io('http://localhost:3000', {
  transports: ['websocket'],
})

// Subscribe to BTC 1-minute candles
socket.emit('join_kline_room', {
  symbol: 'BTCUSDT',
  interval: '1m'
})

// Receive updates
socket.on('kline_update', (candle) => {
  // Update your chart
  updateChart(candle)
})

// Switch to ETH 5-minute candles
socket.emit('leave_kline_room', { symbol: 'BTCUSDT', interval: '1m' })
socket.emit('join_kline_room', { symbol: 'ETHUSDT', interval: '5m' })

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  socket.emit('leave_kline_room', { symbol: 'ETHUSDT', interval: '5m' })
  socket.disconnect()
})
```

## Database Integration

### Connection Management

**Service**: `DatabaseService` (modules/database/database.service.ts)

```typescript
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool: Pool  // PostgreSQL connection pool

  async onModuleInit() {
    // Called when app starts
    // Creates connection pool to QuestDB
  }

  async onModuleDestroy() {
    // Called when app shuts down
    // Closes all connections gracefully
  }

  async query(sqlText: string, params?: any[]) {
    // Executes SQL with parameterized queries
    // Returns: { rows: any[], rowCount: number, ... }
  }
}
```

### Connection Pool Configuration

```typescript
// From environment variables
const pool = new Pool({
  user: 'admin',              // QUESTDB_USER
  host: 'questdb',            // QUESTDB_HOST
  database: 'qdb',            // QUESTDB_DB_NAME
  password: 'quest',          // QUESTDB_PASSWORD
  port: 8812,                 // QUESTDB_PORT
  max: 10,                    // QUESTDB_POOL_MAX (max connections)
  connectionTimeoutMillis: 30000,     // QUESTDB_POOL_TIMEOUT
  idleTimeoutMillis: 60000,           // QUESTDB_POOL_IDLE_TIMEOUT
})
```

### Query Examples

**Get historical candles with aggregation:**

```typescript
// Called by CandlesService.getHistoricalCandles()
const query = `
  SELECT 
    timestamp,
    symbol,
    '${interval}' AS interval,
    first(open) AS open,
    max(high) AS high,
    min(low) AS low,
    last(close) AS close,
    sum(volume) AS volume
  FROM market_candles
  WHERE symbol = $1 AND interval = '1m'
  SAMPLE BY ${interval} ALIGN TO CALENDAR
  ORDER BY timestamp DESC
  LIMIT $2;
`

const result = await this.databaseService.query(query, ['BTCUSDT', 100])
// result.rows = [{ timestamp, symbol, interval, open, high, low, close, volume }, ...]
```

**QuestDB Aggregation Function:**

- `SAMPLE BY` - Resample data to new interval (e.g., `5m`, `1h`)
- `ALIGN TO CALENDAR` - Align to calendar boundaries
- `first()` - Get first value in interval
- `last()` - Get last value in interval
- `max()` - Get maximum value
- `min()` - Get minimum value
- `sum()` - Get sum of values

### Table Schema

**Table**: `market_candles`

Created by data pipeline processor, structure:

```sql
CREATE TABLE IF NOT EXISTS market_candles (
  timestamp TIMESTAMP NOT NULL,
  symbol SYMBOL NOT NULL,
  interval SYMBOL NOT NULL,
  open DOUBLE NOT NULL,
  high DOUBLE NOT NULL,
  low DOUBLE NOT NULL,
  close DOUBLE NOT NULL,
  volume DOUBLE NOT NULL,
  is_final BOOLEAN NOT NULL
) TIMESTAMP (timestamp) PARTITION BY DAY WAL;
```

**Indexes**:
- Primary: `timestamp` (designated timestamp column)
- Partitioned by: `DAY` (daily partitions)
- WAL: Write-ahead logging enabled

## Event Emitter Pattern

### Module Integration

The backend uses NestJS `EventEmitterModule` for inter-component communication:

```typescript
// app.module.ts
@Module({
  imports: [
    EventEmitterModule.forRoot(),  // Enable event emitter
    KafkaModule,                   // Kafka consumer
    CandlesModule,                 // WebSocket gateway
  ],
})
export class AppModule {}
```

### Kafka to Gateway Flow

1. **KafkaService** consumes from Kafka topic `kline_stream`
2. **KafkaService** validates message format
3. **KafkaService** emits NestJS event: `candle.update`
4. **CandlesGateway** listens to `candle.update` event
5. **CandlesGateway** broadcasts to Socket.IO room

```typescript
// kafka.service.ts
async initKlineStreamConsumer() {
  await this.klineStreamConsumer.run({
    eachMessage: async ({ message }) => {
      const candleData = JSON.parse(message.value.toString())
      
      // Validate fields
      if (!candleData.symbol || !candleData.close) {
        logger.error('Invalid candle data')
        return
      }
      
      // Emit event for WebSocket gateway
      this.eventEmitter.emit('candle.update', candleData)
    },
  })
}

// candles.gateway.ts
@OnEvent('candle.update')
handleCandleUpdateEvent(candleData: any) {
  const roomName = `${candleData.symbol}_${candleData.interval}`
  
  // Broadcast to all clients in room
  this.server.to(roomName).emit('kline_update', candleData)
}
```

### Event Types

| Event | Payload | Source | Subscriber |
|-------|---------|--------|-----------|
| `candle.update` | CandleData object | KafkaService | CandlesGateway |

## Authentication & Authorization

**Current Status**: No authentication implemented

- All endpoints are public
- All WebSocket connections are accepted
- All symbols are accessible

**For Production**, implement:

```typescript
// Example: Add JWT authentication

// 1. Create auth guard
@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    // Validate JWT token
    return true
  }
}

// 2. Apply to routes
@Controller('candles')
@UseGuards(JwtAuthGuard)
export class CandlesController {
  @Get()
  getCandles() { ... }
}

// 3. Secure WebSocket
@WebSocketGateway()
@UseGuards(JwtAuthGuard)
export class CandlesGateway {
  // ...
}
```

## Testing

### Test Structure

```
test/
├── app.e2e-spec.ts          # End-to-end tests
└── jest-e2e.json            # Jest configuration for E2E
```

### Unit Tests

Run tests for individual services and controllers:

```bash
npm test

# Example output:
# PASS  src/modules/database/database.service.spec.ts
# PASS  src/modules/candles/candles.service.spec.ts
# ...
```

### Test Coverage

```bash
npm run test:cov

# Generates coverage report in ./coverage/
# Open coverage/index.html to view detailed report
```

### End-to-End Tests

```bash
# Requires running services (Kafka, QuestDB)
npm run test:e2e
```

### Writing Tests

**Example Service Test:**

```typescript
import { Test, TestingModule } from '@nestjs/testing'
import { CandlesService } from './candles.service'
import { DatabaseService } from '../database/database.service'

describe('CandlesService', () => {
  let service: CandlesService
  let databaseService: DatabaseService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CandlesService,
        {
          provide: DatabaseService,
          useValue: {
            query: jest.fn(),
          },
        },
      ],
    }).compile()

    service = module.get<CandlesService>(CandlesService)
    databaseService = module.get<DatabaseService>(DatabaseService)
  })

  it('should fetch historical candles', async () => {
    const mockCandles = [
      { timestamp: '2024-01-15T10:00:00Z', open: 45000, close: 45200 },
    ]

    jest.spyOn(databaseService, 'query').mockResolvedValue({
      rows: mockCandles,
    })

    const result = await service.getHistoricalCandles('BTCUSDT', 100, '1m')

    expect(result).toEqual(mockCandles)
    expect(databaseService.query).toHaveBeenCalled()
  })
})
```

## Debugging

### VS Code Debugger Setup

**Launch Configuration** (`.vscode/launch.json`):

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "NestJS Debug",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/backend/node_modules/.bin/nest",
      "args": ["start", "--debug", "--watch"],
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    }
  ]
}
```

### Start Debugger

```bash
# Terminal 1: Start with debug flag
npm run start:debug

# Terminal 2 (VS Code): Click Debug icon or press F5
# Debugger will attach to port 9229
```

### Debug Commands

```bash
# Start with debugger listening on port 9229
npm run start:debug

# Or manually with node
node --inspect-brk -r tsconfig-paths/register -r ts-node/register \
  node_modules/.bin/jest --runInBand
```

### Common Debugging Scenarios

**Issue**: WebSocket not connecting
```typescript
// Add logging to gateway
@OnGatewayConnection()
handleConnection(client: Socket) {
  console.log(`Client connected: ${client.id}`, {
    address: client.handshake.address,
    transports: client.handshake.headers['upgrade'],
  })
}
```

**Issue**: Database query failing
```typescript
// Enable debug logging in DatabaseService
this.logger.debug('Executing query:', {
  sql: sqlText,
  params,
})
```

**Issue**: Kafka message not processing
```typescript
// Check Kafka service logs
docker-compose logs -f data-producer
docker-compose logs -f data-processor
```

## Deployment

### Docker Build

```bash
# Build Docker image with backend
docker build -t nextick-backend:latest -f Dockerfile.backend .

# Or use Docker Compose
docker-compose up -d backend
```

### Environment Variables for Production

```env
NODE_ENV=production
PORT=3000
KAFKA_BROKER=kafka-prod-1:9092,kafka-prod-2:9092,kafka-prod-3:9092
KAFKA_CLIENT_ID=nextick-backend-prod
QUESTDB_HOST=questdb.prod.internal
QUESTDB_PORT=8812
QUESTDB_POOL_MAX=20
```

### Running in Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nextick-backend
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nextick-backend
  template:
    metadata:
      labels:
        app: nextick-backend
    spec:
      containers:
      - name: backend
        image: nextick-backend:latest
        ports:
        - containerPort: 3000
        env:
        - name: KAFKA_BROKER
          value: kafka:9092
        - name: QUESTDB_HOST
          value: questdb
        livenessProbe:
          httpGet:
            path: /
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 10
```

### Health Checks

```bash
# HTTP endpoint
curl http://localhost:3000/

# Kubernetes liveness probe
curl -f http://localhost:3000/ || exit 1

# Check Kafka connection (via logs)
npm run start:prod 2>&1 | grep -i "kafka.*initialized"
```

## Troubleshooting

### Server Won't Start

**Error**: "ECONNREFUSED - Kafka not available"

```bash
# Verify Kafka is running
docker-compose ps kafka

# Check Kafka logs
docker-compose logs kafka

# Verify port 9092 is accessible
netstat -an | grep 9092

# Restart Kafka
docker-compose restart kafka
```

**Error**: "Database connection failed"

```bash
# Verify QuestDB is running
docker-compose ps questdb

# Test connection
psql -h localhost -U admin -d qdb -c "SELECT 1"

# Check env variables
grep QUESTDB .env
```

### WebSocket Not Connecting

**In browser console**: "Connection failed" or timeout

```typescript
// Check backend is running and listening on 3000
curl http://localhost:3000/

// Check CORS configuration in main.ts
app.enableCors({
  origin: 'http://localhost:5173',  // Frontend URL
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  credentials: true,
})

// Check Socket.IO configuration
@WebSocketGateway({
  cors: { 
    origin: ['http://localhost:3000', 'http://localhost:5173'],
  },
  transports: ['websocket', 'polling'],
})
```

### No Data from API

```bash
# Check QuestDB has data
curl -G 'http://localhost:9000/api/rest' \
  --data-urlencode "query=SELECT COUNT(*) FROM market_candles"

# Check Kafka has candle messages
docker-compose logs data-processor | grep "published"

# Check backend is consuming Kafka
npm run start:dev 2>&1 | grep -i "candle"
```

### Port Already in Use

```bash
# Find process using port 3000
lsof -i :3000

# Kill process
kill -9 <PID>

# Or use different port
PORT=3001 npm run start:dev
```

### Memory Leaks or Performance Issues

```bash
# Run with memory profiling
node --inspect=0.0.0.0:9229 dist/main

# Connect Chrome DevTools
# chrome://inspect -> Connect to localhost:9229

# Check heap snapshot in DevTools
```

---

For system-wide documentation, see [Root README](../README.md)  
For frontend integration details, see [Frontend README](../frontend/README.md)
