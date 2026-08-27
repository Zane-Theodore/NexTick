export type OrderBookView = 'both' | 'asks' | 'bids';

export type OrderBookConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

export interface RawOrderBookLevel {
  price: number;
  quantity: number;
}

export interface OrderBookLevel extends RawOrderBookLevel {
  cumulativeQuantity: number;
  cumulativeQuote: number;
  depthPercent: number;
}

export interface OrderBookSnapshot {
  asks: RawOrderBookLevel[];
  bids: RawOrderBookLevel[];
  lastUpdateId: number;
}

export interface LastTrade {
  price: number;
  direction: 'up' | 'down';
}
