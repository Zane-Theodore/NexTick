import { Injectable } from '@nestjs/common';
import {
  getMarketTradesRoomKey,
  MarketTradeUpdate,
} from './market-trade-normalization';

const MAX_TRADES_PER_SYMBOL = 160;

@Injectable()
export class RecentMarketTradesCacheService {
  private readonly tradesByRoom = new Map<string, MarketTradeUpdate[]>();

  upsert(trade: MarketTradeUpdate): void {
    const roomKey = getMarketTradesRoomKey(trade.symbol);
    const trades = this.tradesByRoom.get(roomKey) ?? [];
    const existingIndex = trades.findIndex(
      (cachedTrade) => cachedTrade.id === trade.id,
    );

    if (existingIndex >= 0) {
      trades[existingIndex] = trade;
    } else {
      trades.push(trade);
    }

    trades.sort(
      (left, right) => right.timestamp - left.timestamp || right.id - left.id,
    );
    this.tradesByRoom.set(roomKey, trades.slice(0, MAX_TRADES_PER_SYMBOL));
  }

  getRecent(symbol: string): MarketTradeUpdate[] {
    return [...(this.tradesByRoom.get(getMarketTradesRoomKey(symbol)) ?? [])];
  }
}
