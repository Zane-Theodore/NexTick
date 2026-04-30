import { Logger } from './logger';

const logger = new Logger('Formatters');
const timezoneOffsetSeconds = new Date().getTimezoneOffset() * 60;

export const formatCandle = (candle: any) => {
  if (!candle || typeof candle !== 'object' || !candle.timestamp) {
    return null;
  }

  const { open, high, low, close, timestamp } = candle;

  if (typeof open !== 'number' || typeof high !== 'number' || 
      typeof low !== 'number' || typeof close !== 'number' ||
      isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) {
    logger.error(`Invalid candle data received`, { open, high, low, close, timestamp });
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