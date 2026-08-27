export type MarketTradeSide = 'buy' | 'sell';

export interface MarketTradeInput {
  symbol?: unknown;
  trade_id?: unknown;
  timestamp?: unknown;
  price?: unknown;
  quantity?: unknown;
  is_buyer_maker?: unknown;
}

export interface MarketTradeUpdate {
  symbol: string;
  id: number;
  timestamp: number;
  price: number;
  quantity: number;
  quoteQuantity: number;
  side: MarketTradeSide;
}

export function normalizeMarketTradeSymbol(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function getMarketTradesRoomKey(symbol: string): string {
  return `market-trades:${normalizeMarketTradeSymbol(symbol)}`;
}

export function normalizeMarketTrade(
  value: MarketTradeInput,
): MarketTradeUpdate | null {
  const symbol = normalizeMarketTradeSymbol(value.symbol);
  const id = parseFiniteNumber(value.trade_id);
  const timestamp = parseFiniteNumber(value.timestamp);
  const price = parseFiniteNumber(value.price);
  const quantity = parseFiniteNumber(value.quantity);

  if (
    !symbol ||
    !Number.isSafeInteger(id) ||
    id < 0 ||
    !Number.isSafeInteger(timestamp) ||
    timestamp <= 0 ||
    price <= 0 ||
    quantity <= 0 ||
    typeof value.is_buyer_maker !== 'boolean'
  ) {
    return null;
  }

  const quoteQuantity = price * quantity;
  if (!Number.isFinite(quoteQuantity) || quoteQuantity <= 0) {
    return null;
  }

  return {
    symbol,
    id,
    timestamp,
    price,
    quantity,
    quoteQuantity,
    side: value.is_buyer_maker ? 'sell' : 'buy',
  };
}

function parseFiniteNumber(value: unknown): number {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return Number.NaN;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
