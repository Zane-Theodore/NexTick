import { useEffect, useRef, useState } from 'react';

import {
  joinMarketTradesRoom,
  leaveMarketTradesRoom,
  subscribeToMarketTrades,
  subscribeToMarketTradesSnapshot,
  subscribeToSocketStatus,
} from '../services/socket';
import type { MarketTradeUpdate } from '../services/socket';
import type {
  MarketTrade,
  MarketTradesConnectionStatus,
} from '../types/marketTrades';
import { loadCachedMarketTrades, saveCachedMarketTrades } from '../utils/marketDataCache';

const MAX_STORED_TRADES = 160;

export interface UseMarketTradesResult {
  trades: MarketTrade[];
  status: MarketTradesConnectionStatus;
}

export function useMarketTrades(symbol: string): UseMarketTradesResult {
  const [initialCache] = useState(() => loadCachedMarketTrades(symbol));
  const [trades, setTrades] = useState<MarketTrade[]>(initialCache?.trades ?? []);
  const [status, setStatus] = useState<MarketTradesConnectionStatus>('connecting');
  const pendingTradesRef = useRef<MarketTrade[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const lastCacheWriteAtRef = useRef(initialCache?.savedAt ?? 0);

  useEffect(() => {
    if (trades.length === 0) return;

    const now = Date.now();
    if (now - lastCacheWriteAtRef.current < 1_000) return;

    lastCacheWriteAtRef.current = now;
    saveCachedMarketTrades(symbol, trades);
  }, [symbol, trades]);

  useEffect(() => {
    let isDisposed = false;
    const normalizedSymbol = symbol.trim().toUpperCase();

    const flushPendingTrades = () => {
      animationFrameRef.current = null;
      if (isDisposed || pendingTradesRef.current.length === 0) return;

      const incomingTrades = pendingTradesRef.current.splice(0).reverse();
      setTrades((currentTrades) => mergeMarketTrades(incomingTrades, currentTrades));
    };

    const queueTrade = (trade: MarketTradeUpdate) => {
      if (trade.symbol !== normalizedSymbol || !isMarketTradeUpdate(trade)) return;

      pendingTradesRef.current.push(trade);
      if (animationFrameRef.current === null) {
        animationFrameRef.current = window.requestAnimationFrame(flushPendingTrades);
      }
    };

    const handleSnapshot = (snapshot: MarketTradeUpdate[]) => {
      if (isDisposed || !Array.isArray(snapshot)) return;

      const matchingTrades = snapshot.filter((trade) => (
        trade.symbol === normalizedSymbol && isMarketTradeUpdate(trade)
      ));
      setTrades((currentTrades) => mergeMarketTrades(matchingTrades, currentTrades));
    };

    const unsubscribeTrades = subscribeToMarketTrades(queueTrade);
    const unsubscribeSnapshot = subscribeToMarketTradesSnapshot(handleSnapshot);
    const unsubscribeStatus = subscribeToSocketStatus(setStatus);
    joinMarketTradesRoom(normalizedSymbol);

    return () => {
      isDisposed = true;
      unsubscribeTrades();
      unsubscribeSnapshot();
      unsubscribeStatus();
      leaveMarketTradesRoom(normalizedSymbol);
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      pendingTradesRef.current = [];
    };
  }, [symbol]);

  return { trades, status };
}

function mergeMarketTrades(...tradeGroups: MarketTrade[][]) {
  const tradesById = new Map<number, MarketTrade>();

  tradeGroups.forEach((trades) => {
    trades.forEach((trade) => tradesById.set(trade.id, trade));
  });

  return [...tradesById.values()]
    .sort((left, right) => right.timestamp - left.timestamp || right.id - left.id)
    .slice(0, MAX_STORED_TRADES);
}

function isMarketTradeUpdate(value: MarketTradeUpdate): boolean {
  return (
    typeof value.symbol === 'string'
    && Number.isSafeInteger(value.id)
    && value.id >= 0
    && Number.isFinite(value.price)
    && value.price > 0
    && Number.isFinite(value.quantity)
    && value.quantity > 0
    && Number.isFinite(value.quoteQuantity)
    && value.quoteQuantity > 0
    && Number.isSafeInteger(value.timestamp)
    && value.timestamp > 0
    && (value.side === 'buy' || value.side === 'sell')
  );
}
