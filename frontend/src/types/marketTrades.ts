export type MarketTradeSide = 'buy' | 'sell';

export type MarketTradesConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

export interface MarketTrade {
  id: number;
  price: number;
  quantity: number;
  quoteQuantity: number;
  timestamp: number;
  side: MarketTradeSide;
}
