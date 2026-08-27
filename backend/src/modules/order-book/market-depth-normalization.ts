export interface MarketDepthInput {
  symbol?: unknown;
  last_update_id?: unknown;
  bids?: unknown;
  asks?: unknown;
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface OrderBookUpdate {
  symbol: string;
  lastUpdateId: number;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

export function normalizeOrderBookSymbol(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function getOrderBookRoomKey(symbol: string): string {
  return `order-book:${normalizeOrderBookSymbol(symbol)}`;
}

export function normalizeMarketDepth(
  value: MarketDepthInput,
): OrderBookUpdate | null {
  const symbol = normalizeOrderBookSymbol(value.symbol);
  const lastUpdateId = parseFiniteNumber(value.last_update_id);
  const bids = normalizeLevels(value.bids);
  const asks = normalizeLevels(value.asks);

  if (
    !symbol ||
    !Number.isSafeInteger(lastUpdateId) ||
    lastUpdateId <= 0 ||
    !bids ||
    bids.length === 0 ||
    !asks ||
    asks.length === 0
  ) {
    return null;
  }

  return {
    symbol,
    lastUpdateId,
    bids,
    asks,
  };
}

function normalizeLevels(value: unknown): OrderBookLevel[] | null {
  if (!Array.isArray(value)) return null;

  const levels: OrderBookLevel[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 2) return null;

    const price = parseFiniteNumber(entry[0]);
    const quantity = parseFiniteNumber(entry[1]);
    if (price <= 0 || quantity <= 0) return null;

    levels.push({ price, quantity });
  }

  return levels;
}

function parseFiniteNumber(value: unknown): number {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return Number.NaN;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
