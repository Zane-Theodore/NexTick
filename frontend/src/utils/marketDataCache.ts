import type { LastTrade, OrderBookSnapshot, RawOrderBookLevel } from '../types/orderBook';
import type { MarketTrade } from '../types/marketTrades';

interface CachedOrderBook {
  savedAt: number;
  snapshot: OrderBookSnapshot;
  lastTrade: LastTrade | null;
}

interface CachedMarketTrades {
  savedAt: number;
  trades: MarketTrade[];
}

const CACHE_VERSION = 'v2';
const CACHE_MAX_AGE_MS = 5 * 60 * 1_000;

export function loadCachedOrderBook(symbol: string): CachedOrderBook | null {
  const value = readCache(getCacheKey('order-book', symbol));
  if (!isRecord(value) || !isFreshTimestamp(value.savedAt) || !isOrderBookSnapshot(value.snapshot)) {
    return null;
  }

  return {
    savedAt: value.savedAt,
    snapshot: value.snapshot,
    lastTrade: isLastTrade(value.lastTrade) ? value.lastTrade : null,
  };
}

export function saveCachedOrderBook(
  symbol: string,
  snapshot: OrderBookSnapshot,
  lastTrade: LastTrade | null,
) {
  writeCache(getCacheKey('order-book', symbol), {
    savedAt: Date.now(),
    snapshot,
    lastTrade,
  } satisfies CachedOrderBook);
}

export function loadCachedMarketTrades(symbol: string): CachedMarketTrades | null {
  const value = readCache(getCacheKey('market-trades', symbol));
  if (!isRecord(value) || !isFreshTimestamp(value.savedAt) || !Array.isArray(value.trades)) {
    return null;
  }

  return {
    savedAt: value.savedAt,
    trades: value.trades.filter(isMarketTrade),
  };
}

export function saveCachedMarketTrades(symbol: string, trades: MarketTrade[]) {
  writeCache(getCacheKey('market-trades', symbol), {
    savedAt: Date.now(),
    trades,
  } satisfies CachedMarketTrades);
}

function getCacheKey(kind: string, symbol: string) {
  return `nextick:${kind}:${CACHE_VERSION}:${symbol.trim().toUpperCase()}`;
}

function readCache(key: string): unknown {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const value = storage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

function writeCache(key: string, value: unknown) {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Cached market data is an optional fast-start optimization.
  }
}

function getStorage() {
  if (typeof window === 'undefined') return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isFreshTimestamp(value: unknown): value is number {
  return (
    typeof value === 'number'
    && Number.isFinite(value)
    && value <= Date.now() + 5_000
    && Date.now() - value <= CACHE_MAX_AGE_MS
  );
}

function isOrderBookSnapshot(value: unknown): value is OrderBookSnapshot {
  return (
    isRecord(value)
    && typeof value.lastUpdateId === 'number'
    && Array.isArray(value.asks)
    && value.asks.length > 0
    && value.asks.every(isRawOrderBookLevel)
    && Array.isArray(value.bids)
    && value.bids.length > 0
    && value.bids.every(isRawOrderBookLevel)
  );
}

function isRawOrderBookLevel(value: unknown): value is RawOrderBookLevel {
  return (
    isRecord(value)
    && isPositiveNumber(value.price)
    && isPositiveNumber(value.quantity)
  );
}

function isLastTrade(value: unknown): value is LastTrade {
  return (
    isRecord(value)
    && isPositiveNumber(value.price)
    && (value.direction === 'up' || value.direction === 'down')
  );
}

function isMarketTrade(value: unknown): value is MarketTrade {
  return (
    isRecord(value)
    && typeof value.id === 'number'
    && isPositiveNumber(value.price)
    && isPositiveNumber(value.quantity)
    && isPositiveNumber(value.quoteQuantity)
    && isPositiveNumber(value.timestamp)
    && (value.side === 'buy' || value.side === 'sell')
  );
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
