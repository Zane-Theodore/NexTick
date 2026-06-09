import { io } from 'socket.io-client';
import type { MarketCandle } from '../utils/formatters';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL;
const roomSubscriptions = new Map<string, number>();

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

export const joinKlineRoom = (symbol: string, interval: string) => {
  const roomKey = getRoomKey(symbol, interval);
  const currentCount = roomSubscriptions.get(roomKey) ?? 0;

  roomSubscriptions.set(roomKey, currentCount + 1);
  if (currentCount > 0) return;

  socket.emit('join_kline_room', { symbol, interval });
};

export const leaveKlineRoom = (symbol: string, interval: string) => {
  const roomKey = getRoomKey(symbol, interval);
  const currentCount = roomSubscriptions.get(roomKey) ?? 0;

  if (currentCount <= 0) return;

  if (currentCount > 1) {
    roomSubscriptions.set(roomKey, currentCount - 1);
    return;
  }

  roomSubscriptions.delete(roomKey);
  socket.emit('leave_kline_room', { symbol, interval });
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
