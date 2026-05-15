# NexTick Frontend - Real-Time Trading Chart UI

[![React](https://img.shields.io/badge/React-19.2+-61dafb.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0+-3178c6.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8.0+-646cff.svg)](https://vite.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.2+-06b6d4.svg)](https://tailwindcss.com/)

A modern, performant React-based trading chart interface for real-time cryptocurrency candlestick visualization. Built with Vite for instant development server startup and optimized production builds.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Folder Structure](#folder-structure)
- [Technology Stack](#technology-stack)
- [Installation](#installation)
- [Running Locally](#running-locally)
- [Build Commands](#build-commands)
- [Component Structure](#component-structure)
- [State Management](#state-management)
- [API Integration](#api-integration)
- [WebSocket Integration](#websocket-integration)
- [Styling Approach](#styling-approach)
- [Performance](#performance)
- [Testing](#testing)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

## Overview

The NexTick frontend is a responsive, real-time trading chart application that:

- **Displays candlestick charts** using `lightweight-charts` for professional-grade visualization
- **Supports multiple symbols** (BTCUSDT, ETHUSDT, BNBUSDT, XRPUSDT) with symbol switching
- **Offers flexible timeframes** (1m, 5m, 15m, 1h, 4h, 1d) with interval selection
- **Streams live updates** via WebSocket for real-time price changes
- **Fetches historical data** via REST API for chart initialization
- **Styled with Tailwind CSS** for responsive, utility-first design
- **Optimized for speed** with Vite's lightning-fast development and build tools

## Architecture

### Component Hierarchy

```
App.tsx
  └── MainLayout
       ├── Header
       │   ├── Symbol Selector (BTCUSDT, ETHUSDT, ...)
       │   └── Interval Selector (1m, 5m, 15m, ...)
       ├── TradingChart
       │   ├── Chart Container
       │   ├── Candlestick Series
       │   ├── Time Scale
       │   ├── Price Scale
       │   └── Interactive Controls
       └── Footer
           └── Status Info
```

### Data Flow

```
API Request (Historical Data)
         │
         ▼
┌─────────────────────────┐
│  services/api.ts        │
│  getHistoricalCandles() │
└────────┬────────────────┘
         │
         ▼ axios GET /candles
    Backend API
    (Port 3000)
         │
         ▼
     QuestDB
   (Historical Data)
         │
         ▼
┌──────────────────────┐
│  CandlesData[]       │
│  Array of candles    │
└────────┬─────────────┘
         │
         ▼
┌──────────────────────────────┐
│  formatters/formatCandle()   │
│  Transform to chart format   │
└────────┬─────────────────────┘
         │
         ▼
┌────────────────────────────────┐
│  TradingChart Component        │
│  Set initial chart data        │
│  Display candlesticks          │
└────────────────────────────────┘

WebSocket Connection (Real-Time Updates)
         │
         ▼
┌──────────────────────────┐
│  services/socket.ts      │
│  Socket.IO Connection    │
│  Port 3000               │
└────────┬─────────────────┘
         │
         ├─ socket.emit('join_kline_room')
         │
         └─ socket.on('kline_update')
                     │
                     ▼
            ┌───────────────────┐
            │  CandleUpdate     │
            │  Real-time data   │
            └────────┬──────────┘
                     │
                     ▼
            ┌──────────────────────┐
            │  useMarketData Hook  │
            │  Update chart series │
            └──────────────────────┘
```

## Folder Structure

```
frontend/
├── src/
│   ├── main.tsx                         # React entry point
│   ├── App.tsx                          # Root component
│   ├── index.css                        # Global Tailwind styles
│   │
│   ├── components/
│   │   ├── chart/
│   │   │   └── TradingChart.tsx         # Main chart component
│   │   │                                # • Creates lightweight-charts instance
│   │   │                                # • Manages chart configuration
│   │   │                                # • Handles symbol/interval changes
│   │   │                                # • Renders candlestick series
│   │   │                                # • Implements loading states
│   │   │
│   │   └── layout/
│   │       ├── MainLayout.tsx           # Page layout wrapper
│   │       │                            # • Provides structure
│   │       │                            # • Contains Header/Footer
│   │       │                            # • Full-height layout
│   │       │
│   │       ├── Header.tsx               # Top navigation bar
│   │       │                            # • Logo/title
│   │       │                            # • Symbol selector dropdown
│   │       │                            # • Interval selector buttons
│   │       │
│   │       └── Footer.tsx               # Bottom info section
│   │                                    # • Status indicators
│   │                                    # • Connection status
│   │
│   ├── hooks/
│   │   └── useMarketData.ts             # React hook for data management
│   │                                    # • Fetches historical candles
│   │                                    # • Joins WebSocket room
│   │                                    # • Handles live updates
│   │                                    # • Manages chart viewport
│   │                                    # • Cleanup on unmount
│   │
│   ├── services/
│   │   ├── api.ts                       # REST API client
│   │   │                                # • axios instance
│   │   │                                # • getHistoricalCandles()
│   │   │                                # • Error handling
│   │   │
│   │   └── socket.ts                    # Socket.IO client
│   │                                    # • WebSocket connection
│   │                                    # • joinKlineRoom()
│   │                                    # • leaveKlineRoom()
│   │                                    # • subscribeToCandles()
│   │
│   ├── types/
│   │   ├── api.ts                       # API response types
│   │   ├── candle.ts                    # Candle data types
│   │   └── socket.ts                    # WebSocket event types
│   │
│   ├── utils/
│   │   ├── formatters.ts                # Data transformation
│   │   │                                # • formatCandle() - Convert API → Chart format
│   │   │                                # • Timestamp conversion
│   │   │                                # • Number formatting
│   │   │
│   │   ├── logger.ts                    # Structured logging
│   │   │                                # • Logger class
│   │   │                                # • Console with prefix
│   │   │
│   │   └── constants.ts                 # App-wide constants
│   │                                    # • Supported symbols
│   │                                    # • Supported intervals
│   │                                    # • API URLs
│   │
│   └── assets/                          # Static files
│       └── ...
│
├── public/                              # Static assets served at root
│   └── index.html (via vite)
│
├── index.html                           # HTML entry point
│
├── vite.config.ts                       # Vite configuration
│                                        # • React plugin
│                                        # • Port configuration
│                                        # • Build settings
│
├── tailwind.config.js                   # Tailwind CSS configuration
│                                        # • Custom theme
│                                        # • Content paths
│                                        # • Plugins
│
├── postcss.config.js                    # PostCSS configuration
│                                        # • Tailwind processor
│
├── tsconfig.json                        # TypeScript config
├── tsconfig.app.json                    # App-specific TS config
├── tsconfig.node.json                   # Build tools TS config
│
├── package.json                         # Dependencies and scripts
├── eslint.config.js                     # ESLint configuration
│
├── dist/                                # Build output (generated)
└── README.md                            # This file
```

## Technology Stack

### Core Framework

| Technology | Version | Purpose |
|-----------|---------|---------|
| **React** | 19.2+ | UI library with hooks |
| **TypeScript** | 6.0+ | Type-safe JavaScript |
| **Vite** | 8.0+ | Build tool & dev server |

### UI & Styling

| Package | Purpose |
|---------|---------|
| **Tailwind CSS** | Utility-first CSS framework |
| **lightweight-charts** | Professional candlestick charts |

### HTTP & Real-Time

| Package | Purpose |
|---------|---------|
| **axios** | HTTP client for REST API |
| **Socket.IO Client** | WebSocket communication |

### Development

| Package | Purpose |
|---------|---------|
| **ESLint** | Code quality |
| **Prettier** | Code formatting |
| **TypeScript ESLint** | Type-aware linting |

## Installation

### Prerequisites

- Node.js 18+
- npm, yarn, or pnpm
- Backend running on `http://localhost:3000`

### Install Dependencies

```bash
cd frontend

# Using npm
npm install

# Using yarn
yarn install

# Using pnpm
pnpm install
```

### Verify Installation

```bash
# Check dependencies
npm list

# Check TypeScript
npx tsc --version

# Check Vite
npx vite --version
```

## Running Locally

### Development Mode (Hot Module Replacement)

```bash
cd frontend

npm run dev

# Output:
# VITE v8.0.10  ready in XXX ms
# 
# ➜  Local:   http://localhost:5173/
# ➜  press h to show help
```

**Features:**
- Hot Module Replacement (HMR) - Changes reflect instantly
- Source maps for debugging
- Fast refresh on file changes
- Full error overlays

### Open in Browser

Navigate to `http://localhost:5173`

Expected behavior:
1. Chart loads with candlestick visualization
2. Default symbol: BTCUSDT, interval: 1m
3. Historical candles populate from API
4. Real-time updates appear as candles change

### Production Preview

```bash
# Build production bundle
npm run build

# Preview production build
npm run preview

# Opens http://localhost:4173
```

## Build Commands

### Development Build

```bash
npm run dev
```

- Starts Vite dev server on port 5173
- Enables HMR
- Source maps included
- No optimization

### Production Build

```bash
npm run build

# Outputs to dist/
# • JavaScript bundled and minified
# • CSS compiled and optimized
# • Assets fingerprinted
# • TypeScript compiled to optimized JS
```

**Output structure:**
```
dist/
├── index.html           # Entry point
├── assets/
│   ├── index-[hash].js  # Main bundle
│   ├── index-[hash].css # Styles
│   └── ...
└── ...
```

### Type Checking

```bash
# Compile TypeScript without output
npm run build -- --mode check

# Or use tsc directly
npx tsc --noEmit
```

### Code Linting

```bash
# Check for linting issues
npm run lint

# Fix auto-fixable issues
npm run lint -- --fix
```

## Component Structure

### TradingChart Component

Main component that renders the interactive candlestick chart.

**Location**: `src/components/chart/TradingChart.tsx`

**Props**: None (uses local state)

**State**:
```typescript
chartInstance: IChartApi | null         // lightweight-charts instance
series: ISeriesApi<"Candlestick"> | null // Candlestick series
symbol: string                          // Current trading symbol
interval: string                        // Current candle interval
loading: boolean                        // Loading indicator
```

**Key Functions**:
- `handleSymbolChange()` - Switch symbol and reload data
- `handleIntervalChange()` - Change candle interval
- `useMarketData()` - Hook for API and WebSocket integration

**Supported Symbols**: BTCUSDT, ETHUSDT, BNBUSDT, XRPUSDT

**Supported Intervals**: 1m, 5m, 15m, 1h, 4h, 1d

### MainLayout Component

Page layout wrapper providing consistent structure.

**Location**: `src/components/layout/MainLayout.tsx`

**Features**:
- Header with controls
- Main content area (children)
- Footer with status
- Dark theme (dark-themed trading interface)

### Header Component

Top navigation with controls.

**Location**: `src/components/layout/Header.tsx`

**Features**:
- Symbol dropdown selector
- Interval button group
- Responsive design

### useMarketData Hook

Custom React hook for data fetching and WebSocket management.

**Location**: `src/hooks/useMarketData.ts`

**Parameters**:
```typescript
chart: IChartApi | null              // Lightweight-charts instance
candlestickSeries: ISeriesApi<"Candlestick"> | null
symbol: string                       // e.g., 'BTCUSDT'
interval: string                     // e.g., '1m'
```

**Responsibilities**:
1. Fetch historical candles from API
2. Format and validate data
3. Set chart data
4. Join WebSocket room
5. Subscribe to real-time updates
6. Update chart on new candles
7. Cleanup on unmount

**Key Flow**:
```typescript
useEffect(() => {
  // 1. Fetch historical data
  const rawCandles = await getHistoricalCandles(symbol, interval, 1000)
  
  // 2. Format for chart
  const formattedData = rawCandles.map(formatCandle).filter(...)
  
  // 3. Set chart data
  candlestickSeries.setData(formattedData)
  
  // 4. Join WebSocket room
  joinKlineRoom(symbol, interval)
  
  // 5. Subscribe to updates
  subscribeToCandles((candle) => {
    // Update chart with new candle
  })
  
  // 6. Cleanup on unmount
  return () => {
    leaveKlineRoom(symbol, interval)
  }
}, [symbol, interval, chart, candlestickSeries])
```

## State Management

### Current Approach

The application uses **React hooks** for state management:

- **`useState`** - Component-level state (symbol, interval, loading)
- **`useEffect`** - Side effects (data fetching, subscriptions)
- **`useRef`** - DOM references (chart container, chart instance)

### State Flow

```
TradingChart Component
├── chartInstance (useRef) → Lightweight-charts instance
├── series (useRef) → Candlestick series
├── symbol (useState) → Current symbol
├── interval (useState) → Current interval
├── loading (useState) → Loading state
│
└── useMarketData Hook
    ├── Fetches API data
    ├── Manages WebSocket subscription
    └── Updates chart series
```

### Global State (Future Enhancement)

For larger applications, consider:
- **React Context** - App-wide state (user preferences, theme)
- **Zustand** - Lightweight state management
- **Redux** - Complex state with devtools
- **Jotai** - Primitive state atoms

## API Integration

### REST API Client

**File**: `src/services/api.ts`

**Configuration**:
```typescript
const API_URL = 'http://localhost:3000'  // Backend URL
```

**Functions**:

#### getHistoricalCandles()

Fetch historical candlestick data.

```typescript
const candles = await getHistoricalCandles(
  symbol: 'BTCUSDT',     // Trading symbol
  interval: '1m',        // Candle interval
  limit: 1000           // Number of candles
)

// Returns: Array of candles with OHLCV data
```

**Request**:
```http
GET http://localhost:3000/candles?symbol=BTCUSDT&interval=1m&limit=1000
```

**Response**:
```json
{
  "success": true,
  "symbol": "BTCUSDT",
  "interval": "1m",
  "count": 1000,
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
    // ... more candles
  ]
}
```

**Error Handling**:
```typescript
try {
  const data = await getHistoricalCandles('BTCUSDT', '1m', 100)
} catch (error) {
  logger.error('Failed to fetch candles', error)
  // Show error UI
}
```

### Error Handling

**Axios interceptors** (can be added):
```typescript
api.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 400) {
      // Bad request (invalid symbol/interval)
    } else if (error.response?.status === 500) {
      // Server error
    }
    return Promise.reject(error)
  }
)
```

## WebSocket Integration

### Socket.IO Connection

**File**: `src/services/socket.ts`

**Configuration**:
```typescript
const socket = io('http://localhost:3000', {
  transports: ['websocket', 'polling'],    // WebSocket with fallback
  withCredentials: true,
  autoConnect: true,                       // Auto-reconnect
  reconnection: true,
  reconnectionDelay: 1000,                 // Start at 1s
  reconnectionDelayMax: 5000,              // Max 5s
  reconnectionAttempts: 5,
})
```

### Functions

#### joinKlineRoom()

Subscribe to real-time updates for a symbol/interval.

```typescript
joinKlineRoom('BTCUSDT', '1m')

// Client emits:
// socket.emit('join_kline_room', { symbol: 'BTCUSDT', interval: '1m' })
```

#### leaveKlineRoom()

Unsubscribe from updates.

```typescript
leaveKlineRoom('BTCUSDT', '1m')

// Client emits:
// socket.emit('leave_kline_room', { symbol: 'BTCUSDT', interval: '1m' })
```

#### subscribeToCandles()

Listen for real-time candle updates.

```typescript
const unsubscribe = subscribeToCandles((candle) => {
  console.log(`${candle.symbol}: ${candle.close}`)
  // Update chart
})

// Returns cleanup function
return () => {
  unsubscribe()  // Remove listener
}
```

### Real-Time Update Flow

```typescript
// 1. Join room after loading historical data
joinKlineRoom('BTCUSDT', '1m')

// 2. Listen for updates
const unsubscribe = subscribeToCandles((candle) => {
  // Update chart series
  series.update(candle)
  
  // If candle is final, adjust chart viewport
  if (candle.is_final) {
    // New candle started, scroll to show it
  }
})

// 3. Cleanup on unmount
return () => {
  leaveKlineRoom('BTCUSDT', '1m')
  unsubscribe()
}
```

### Connection Management

**Auto-reconnect**: Socket.IO handles reconnection automatically
- Waits 1s, then 2s, 4s, 5s, 5s...
- Stops after 5 attempts

**Manual reconnect** (if needed):
```typescript
if (!socket.connected) {
  socket.connect()
}
```

**Check connection**:
```typescript
socket.on('connect', () => {
  console.log('Connected to backend')
})

socket.on('disconnect', (reason) => {
  console.log('Disconnected:', reason)
})
```

## Styling Approach

### Tailwind CSS

**Framework**: Utility-first CSS with component classes

**Configuration**:
```javascript
// tailwind.config.js
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

### Global Styles

**File**: `src/index.css`

```css
@import "tailwindcss";

html, body {
  background-color: #131722;    /* Dark trading theme */
  overflow-x: hidden;           /* No horizontal scroll */
}

::-webkit-scrollbar {
  width: 8px;                   /* Thin scrollbar */
}

::-webkit-scrollbar-track {
  background: #131722;          /* Dark background */
}

::-webkit-scrollbar-thumb {
  background: #2B2B43;          /* Dark gray thumb */
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: #3f3f5a;          /* Lighter on hover */
}
```

### Component Styling

**Class-based** (recommended):
```typescript
<div className="flex h-screen flex-col bg-gray-900 text-white">
  <header className="border-b border-gray-800 p-4">
    <h1 className="text-2xl font-bold">NexTick</h1>
  </header>
</div>
```

**Responsive classes**:
```typescript
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  {/* Responsive grid layout */}
</div>
```

### Dark Theme

All components should use:
- Dark backgrounds: `bg-slate-900`, `bg-gray-950`
- Light text: `text-gray-100`, `text-white`
- Accent colors: `text-blue-400`, `border-gray-700`

## Performance

### Optimization Techniques

#### 1. Chart Performance

**lightweight-charts** is optimized for rendering thousands of candles:
- Only renders visible range
- Efficient incremental updates
- WebGL acceleration (where available)

```typescript
// Efficient update without full redraw
series.update(newCandle)

// Efficient viewport adjustment
chart.timeScale().setVisibleLogicalRange({ from, to })
```

#### 2. React Rendering

**Memoization**:
```typescript
import { memo } from 'react'

const TradingChart = memo(({ symbol, interval }) => {
  // Component only re-renders if props change
})

export default TradingChart
```

**useCallback** for stable function references:
```typescript
const handleSymbolChange = useCallback((symbol: string) => {
  // Only recreated if dependencies change
}, [dependency])
```

#### 3. Bundle Optimization

**Vite code splitting**:
```typescript
// Dynamic imports for route splitting
const ChartPage = lazy(() => import('./pages/Chart'))
```

**Tree shaking**:
- ESM imports enable unused code removal
- Unused CSS is not included in build

### Build Output

**Typical bundle sizes**:
- `index.html` - ~2 KB
- `index-[hash].js` - ~200 KB (minified)
- `index-[hash].css` - ~50 KB (minified)

## Testing

### Unit Testing (TODO)

Recommended approach:
```typescript
import { render, screen } from '@testing-library/react'
import TradingChart from './TradingChart'

describe('TradingChart', () => {
  it('renders chart container', () => {
    render(<TradingChart />)
    expect(screen.getByRole('region')).toBeInTheDocument()
  })
})
```

### Integration Testing

Test API and WebSocket integration:
```typescript
// Mock services
jest.mock('../services/api')
jest.mock('../services/socket')

describe('useMarketData', () => {
  it('fetches data and updates chart', async () => {
    // Setup mocks
    // Render hook
    // Assert chart was updated
  })
})
```

### End-to-End Testing (TODO)

```bash
npm install --save-dev cypress

# Write E2E tests
# npx cypress open
```

## Deployment

### Static Site Hosting

The built frontend is a static SPA (Single Page Application).

**Deploy to**:
- **Netlify** - `npm run build` → Deploy `dist/` folder
- **Vercel** - `npm run build` → Deploy `dist/` folder
- **GitHub Pages** - Build and push to gh-pages branch
- **AWS S3 + CloudFront** - Upload dist/ and configure CDN
- **Nginx/Apache** - Serve dist/ folder with SPA routing

### Build for Production

```bash
npm run build

# Creates dist/ folder with optimized bundle
```

### SPA Routing

Configure server to serve `index.html` for all routes:

**Nginx**:
```nginx
location / {
  try_files $uri $uri/ /index.html;
}
```

**Apache**:
```apache
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
</IfModule>
```

### Environment Configuration

Create `.env` file for API URLs:

```env
VITE_API_URL=http://localhost:3000
VITE_WS_URL=http://localhost:3000
```

Access in code:
```typescript
const API_URL = import.meta.env.VITE_API_URL
```

### Docker Deployment

```dockerfile
# Build stage
FROM node:18-alpine AS builder
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .
RUN npm run build

# Serve stage
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

## Troubleshooting

### Server Won't Start

**Error**: Port 5173 already in use

```bash
# Use different port
npm run dev -- --port 3001

# Or kill process
lsof -i :5173
kill -9 <PID>
```

### Blank Page After Load

**Check 1**: Backend is running
```bash
curl http://localhost:3000/
```

**Check 2**: Browser console for errors
- Press F12 → Console tab
- Check for network errors or JavaScript errors

**Check 3**: API is accessible
```bash
curl "http://localhost:3000/candles?symbol=BTCUSDT"
```

### Chart Not Displaying

**Issue**: Historical data not loaded

```bash
# Check network tab in DevTools
# Look for GET /candles request
# Check response status and data

# Check browser console for errors
# Verify symbol is valid: BTCUSDT, ETHUSDT, etc.
```

### WebSocket Connection Failed

**In browser console**:
```javascript
// Check socket connection
console.log(socket.connected)

// Check for connection errors
socket.on('connect_error', (error) => {
  console.error('Connection error:', error)
})
```

**Verify backend**:
```bash
curl -i http://localhost:3000/

# Should respond with 200 OK
```

### Real-Time Updates Not Showing

**Check**:
1. WebSocket room was joined: Check logs
2. Backend is emitting updates: Check backend logs
3. Socket is connected: Check browser console

```typescript
// Debug - log all socket events
socket.onAny((event, ...args) => {
  console.log(event, args)
})
```

### Build Fails with TypeScript Errors

```bash
# Check TypeScript
npm run build

# Fix errors or suppress
npx tsc --noEmit
```

### Hot Reload Not Working

**Vite HMR** should work automatically in dev mode.

If not:
```bash
# Kill dev server
npm run dev

# Restart dev server
npm run dev

# Clear browser cache (Ctrl+Shift+Delete)
```

---

For system-wide documentation, see [Root README](../README.md)  
For backend API details, see [Backend README](../backend/README.md)
