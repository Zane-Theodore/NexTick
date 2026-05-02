import { Logger } from './logger';

const logger = new Logger('Formatters');
const timezoneOffsetSeconds = new Date().getTimezoneOffset() * 60;

export interface FormattedCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export const formatCandle = (candle: any): FormattedCandle | null => {
  if (!candle || typeof candle !== 'object' || !candle.timestamp) {
    return null;
  }

  const { open, high, low, close, timestamp, symbol, interval } = candle;

  if (typeof open !== 'number' || typeof high !== 'number' || 
      typeof low !== 'number' || typeof close !== 'number' ||
      isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) {
    logger.error(`Invalid candle data received`, { open, high, low, close, timestamp, symbol, interval });
    return null;
  }
  
  const utcSeconds = Math.floor(new Date(timestamp).getTime() / 1000);
  
  return {
    time: (utcSeconds - timezoneOffsetSeconds) as any,
    open,
    high,
    low,
    close,
  };
};