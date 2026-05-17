import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL;
export const socket = io(SOCKET_URL, {
  transports: ['websocket', 'polling'],
  withCredentials: true,
  autoConnect: true,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5,
});

/**
 * Join a room to receive real-time kline updates for a specific symbol and interval
 * @param symbol Trading symbol (e.g., 'BTCUSDT')
 * @param interval Candle interval (e.g., '1m', '5m', '1h')
 */
export const joinKlineRoom = (symbol: string, interval: string) => {
  socket.emit('join_kline_room', { symbol, interval });
};

/**
 * Leave a room to stop receiving real-time kline updates for a specific symbol and interval
 * @param symbol Trading symbol (e.g., 'BTCUSDT')
 * @param interval Candle interval (e.g., '1m', '5m', '1h')
 */
export const leaveKlineRoom = (symbol: string, interval: string) => {
  socket.emit('leave_kline_room', { symbol, interval });
};

/**
 * Subscribe to real-time candle updates via Room Pattern
 * Must call joinKlineRoom() before using this
 * @param callback Function to call when candle updates are received
 */
export const subscribeToCandles = (callback: (candle: any) => void) => {
  socket.on('kline_update', callback);
  
  return () => {
    socket.off('kline_update', callback);
  };
};