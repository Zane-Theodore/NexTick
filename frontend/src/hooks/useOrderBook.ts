import { useEffect, useRef, useState } from 'react';

import {
  joinOrderBookRoom,
  joinMarketTradesRoom,
  leaveOrderBookRoom,
  leaveMarketTradesRoom,
  subscribeToMarketTrades,
  subscribeToMarketTradesSnapshot,
  subscribeToOrderBookSnapshots,
  subscribeToOrderBookUpdates,
  subscribeToSocketStatus,
} from '../services/socket';
import type { MarketTradeUpdate, OrderBookUpdate } from '../services/socket';
import type {
  LastTrade,
  OrderBookConnectionStatus,
  OrderBookSnapshot,
} from '../types/orderBook';
import { loadCachedOrderBook, saveCachedOrderBook } from '../utils/marketDataCache';

export interface UseOrderBookResult {
  snapshot: OrderBookSnapshot | null;
  lastTrade: LastTrade | null;
  status: OrderBookConnectionStatus;
}

export function useOrderBook(symbol: string): UseOrderBookResult {
  const [initialCache] = useState(() => loadCachedOrderBook(symbol));
  const [snapshot, setSnapshot] = useState<OrderBookSnapshot | null>(initialCache?.snapshot ?? null);
  const [lastTrade, setLastTrade] = useState<LastTrade | null>(initialCache?.lastTrade ?? null);
  const [status, setStatus] = useState<OrderBookConnectionStatus>('connecting');
  const lastTradePriceRef = useRef<number | null>(initialCache?.lastTrade?.price ?? null);
  const lastCacheWriteAtRef = useRef(initialCache?.savedAt ?? 0);

  useEffect(() => {
    if (!snapshot) return;

    const now = Date.now();
    if (now - lastCacheWriteAtRef.current < 1_000) return;

    lastCacheWriteAtRef.current = now;
    saveCachedOrderBook(symbol, snapshot, lastTrade);
  }, [lastTrade, snapshot, symbol]);

  useEffect(() => {
    const normalizedSymbol = symbol.trim().toUpperCase();

    const updateSnapshot = (update: OrderBookUpdate) => {
      if (update.symbol !== normalizedSymbol || !isOrderBookUpdate(update)) return;

      setSnapshot({
        asks: update.asks,
        bids: update.bids,
        lastUpdateId: update.lastUpdateId,
      });
    };

    const unsubscribeSnapshot = subscribeToOrderBookSnapshots(updateSnapshot);
    const unsubscribeUpdates = subscribeToOrderBookUpdates(updateSnapshot);
    const unsubscribeStatus = subscribeToSocketStatus(setStatus);
    joinOrderBookRoom(normalizedSymbol);

    return () => {
      unsubscribeSnapshot();
      unsubscribeUpdates();
      unsubscribeStatus();
      leaveOrderBookRoom(normalizedSymbol);
    };
  }, [symbol]);

  useEffect(() => {
    const normalizedSymbol = symbol.trim().toUpperCase();

    const updateLastTrade = (trade: MarketTradeUpdate) => {
      if (
        trade.symbol !== normalizedSymbol
        || !Number.isFinite(trade.price)
        || trade.price <= 0
      ) {
        return;
      }

      const previousPrice = lastTradePriceRef.current;
      lastTradePriceRef.current = trade.price;
      setLastTrade({
        price: trade.price,
        direction: previousPrice === null || trade.price >= previousPrice ? 'up' : 'down',
      });
    };

    const updateFromSnapshot = (trades: MarketTradeUpdate[]) => {
      if (!Array.isArray(trades)) return;

      const latestTrade = trades
        .filter((trade) => trade.symbol === normalizedSymbol)
        .sort((left, right) => right.timestamp - left.timestamp || right.id - left.id)[0];

      if (latestTrade) updateLastTrade(latestTrade);
    };

    const unsubscribeTrades = subscribeToMarketTrades(updateLastTrade);
    const unsubscribeSnapshot = subscribeToMarketTradesSnapshot(updateFromSnapshot);
    joinMarketTradesRoom(normalizedSymbol);

    return () => {
      unsubscribeTrades();
      unsubscribeSnapshot();
      leaveMarketTradesRoom(normalizedSymbol);
    };
  }, [symbol]);

  return { snapshot, lastTrade, status };
}

function isOrderBookUpdate(value: OrderBookUpdate): boolean {
  return (
    typeof value.symbol === 'string'
    && Number.isSafeInteger(value.lastUpdateId)
    && value.lastUpdateId >= 0
    && Array.isArray(value.asks)
    && value.asks.length > 0
    && value.asks.every(isOrderBookLevel)
    && Array.isArray(value.bids)
    && value.bids.length > 0
    && value.bids.every(isOrderBookLevel)
  );
}

function isOrderBookLevel(value: { price: number; quantity: number }): boolean {
  return (
    Number.isFinite(value.price)
    && value.price > 0
    && Number.isFinite(value.quantity)
    && value.quantity > 0
  );
}
