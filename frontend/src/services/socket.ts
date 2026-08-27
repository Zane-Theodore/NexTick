import { io } from 'socket.io-client';
import type { MarketTrade } from '../types/marketTrades';
import type { OrderBookSnapshot } from '../types/orderBook';
import type { MarketCandle } from '../utils/formatters';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL;
const klineRoomSubscriptions = new Map<string, number>();
const marketTradesRoomSubscriptions = new Map<string, number>();
const orderBookRoomSubscriptions = new Map<string, number>();

export const socket = io(SOCKET_URL, {
  transports: ['websocket', 'polling'],
  withCredentials: true,
  autoConnect: true,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5,
});

const getRoomKey = (symbol: string, interval: string) => `${symbol.toUpperCase()}_${interval}`;
const getMarketTradesRoomKey = (symbol: string) => symbol.trim().toUpperCase();

socket.on('connect', () => {
  klineRoomSubscriptions.forEach((_count, roomKey) => {
    const separatorIndex = roomKey.lastIndexOf('_');
    socket.emit('join_kline_room', {
      symbol: roomKey.slice(0, separatorIndex),
      interval: roomKey.slice(separatorIndex + 1),
    });
  });

  marketTradesRoomSubscriptions.forEach((_count, symbol) => {
    socket.emit('join_market_trades_room', { symbol });
  });

  orderBookRoomSubscriptions.forEach((_count, symbol) => {
    socket.emit('join_order_book_room', { symbol });
  });
});

export const joinKlineRoom = (symbol: string, interval: string) => {
  const roomKey = getRoomKey(symbol, interval);
  const currentCount = klineRoomSubscriptions.get(roomKey) ?? 0;

  klineRoomSubscriptions.set(roomKey, currentCount + 1);
  if (currentCount > 0) return;

  if (socket.connected) {
    socket.emit('join_kline_room', { symbol, interval });
  }
};

export const leaveKlineRoom = (symbol: string, interval: string) => {
  const roomKey = getRoomKey(symbol, interval);
  const currentCount = klineRoomSubscriptions.get(roomKey) ?? 0;

  if (currentCount <= 0) return;

  if (currentCount > 1) {
    klineRoomSubscriptions.set(roomKey, currentCount - 1);
    return;
  }

  klineRoomSubscriptions.delete(roomKey);
  if (socket.connected) {
    socket.emit('leave_kline_room', { symbol, interval });
  }
};

export type KlineUpdate = MarketCandle & {
  is_final: boolean;
};

export const subscribeToCandles = (callback: (candle: KlineUpdate) => void) => {
  socket.on('kline_update', callback);
  
  return () => {
    socket.off('kline_update', callback);
  };
};

export type MarketTradeUpdate = MarketTrade & { symbol: string };

export const joinMarketTradesRoom = (symbol: string) => {
  const roomKey = getMarketTradesRoomKey(symbol);
  const currentCount = marketTradesRoomSubscriptions.get(roomKey) ?? 0;

  marketTradesRoomSubscriptions.set(roomKey, currentCount + 1);
  if (currentCount > 0) return;

  if (socket.connected) {
    socket.emit('join_market_trades_room', { symbol: roomKey });
  }
};

export const leaveMarketTradesRoom = (symbol: string) => {
  const roomKey = getMarketTradesRoomKey(symbol);
  const currentCount = marketTradesRoomSubscriptions.get(roomKey) ?? 0;

  if (currentCount <= 0) return;

  if (currentCount > 1) {
    marketTradesRoomSubscriptions.set(roomKey, currentCount - 1);
    return;
  }

  marketTradesRoomSubscriptions.delete(roomKey);
  if (socket.connected) {
    socket.emit('leave_market_trades_room', { symbol: roomKey });
  }
};

export const subscribeToMarketTrades = (
  callback: (trade: MarketTradeUpdate) => void,
) => {
  socket.on('market_trade', callback);

  return () => {
    socket.off('market_trade', callback);
  };
};

export const subscribeToMarketTradesSnapshot = (
  callback: (trades: MarketTradeUpdate[]) => void,
) => {
  socket.on('market_trades_snapshot', callback);

  return () => {
    socket.off('market_trades_snapshot', callback);
  };
};

export type SocketConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

export const subscribeToSocketStatus = (
  callback: (status: SocketConnectionStatus) => void,
) => {
  const handleConnect = () => callback('live');
  const handleDisconnect = () => callback(socket.active ? 'reconnecting' : 'offline');
  const handleConnectError = () => callback(socket.active ? 'reconnecting' : 'offline');
  const handleReconnectAttempt = () => callback('reconnecting');
  const handleReconnectFailed = () => callback('offline');

  socket.on('connect', handleConnect);
  socket.on('disconnect', handleDisconnect);
  socket.on('connect_error', handleConnectError);
  socket.io.on('reconnect_attempt', handleReconnectAttempt);
  socket.io.on('reconnect_failed', handleReconnectFailed);
  callback(socket.connected ? 'live' : socket.active ? 'connecting' : 'offline');

  return () => {
    socket.off('connect', handleConnect);
    socket.off('disconnect', handleDisconnect);
    socket.off('connect_error', handleConnectError);
    socket.io.off('reconnect_attempt', handleReconnectAttempt);
    socket.io.off('reconnect_failed', handleReconnectFailed);
  };
};

export type OrderBookUpdate = OrderBookSnapshot & { symbol: string };

export const joinOrderBookRoom = (symbol: string) => {
  const roomKey = getMarketTradesRoomKey(symbol);
  const currentCount = orderBookRoomSubscriptions.get(roomKey) ?? 0;

  orderBookRoomSubscriptions.set(roomKey, currentCount + 1);
  if (currentCount > 0) return;

  if (socket.connected) {
    socket.emit('join_order_book_room', { symbol: roomKey });
  }
};

export const leaveOrderBookRoom = (symbol: string) => {
  const roomKey = getMarketTradesRoomKey(symbol);
  const currentCount = orderBookRoomSubscriptions.get(roomKey) ?? 0;

  if (currentCount <= 0) return;

  if (currentCount > 1) {
    orderBookRoomSubscriptions.set(roomKey, currentCount - 1);
    return;
  }

  orderBookRoomSubscriptions.delete(roomKey);
  if (socket.connected) {
    socket.emit('leave_order_book_room', { symbol: roomKey });
  }
};

export const subscribeToOrderBookSnapshots = (
  callback: (snapshot: OrderBookUpdate) => void,
) => {
  socket.on('order_book_snapshot', callback);

  return () => {
    socket.off('order_book_snapshot', callback);
  };
};

export const subscribeToOrderBookUpdates = (
  callback: (snapshot: OrderBookUpdate) => void,
) => {
  socket.on('order_book_update', callback);

  return () => {
    socket.off('order_book_update', callback);
  };
};
