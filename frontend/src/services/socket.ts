import { io } from 'socket.io-client';

export const socket = io('http://localhost:3000', {
  transports: ['websocket', 'polling'],
  withCredentials: true,
  autoConnect: true,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5,
});

/**
 * Subscribe to real-time candle updates for a specific symbol and interval
 * @param symbol Trading symbol (e.g., 'BTCUSDT')
 * @param interval Candle interval (e.g., '1m', '5m', '1h')
 * @param callback Function to call when candle updates are received
 */
export const subscribeToCandles = (
  symbol: string,
  interval: string,
  callback: (candle: any) => void
) => {
  const eventKey = `candle.update.${symbol}.${interval}`;
  socket.on(eventKey, callback);
  
  return () => {
    socket.off(eventKey, callback);
  };
};

/**
 * Subscribe to all candle updates (all symbols and intervals)
 * @param callback Function to call when candle updates are received
 */
export const subscribeToAllCandles = (callback: (candle: any) => void) => {
  socket.on('candle.update', callback);
  
  return () => {
    socket.off('candle.update', callback);
  };
};