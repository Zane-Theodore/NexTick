import { Logger } from './logger';

const logger = new Logger('Formatters');

export interface FormattedCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export const formatCandle = (candle: any): FormattedCandle | null => {
  if (!candle || typeof candle !== 'object' || !candle.timestamp) {
    return null;
  }

  const { timestamp, symbol, interval } = candle;
  const open = Number(candle.open);
  const high = Number(candle.high);
  const low = Number(candle.low);
  const close = Number(candle.close);
  const volume = Number(candle.volume ?? 0);

  if (!Number.isFinite(open) || !Number.isFinite(high) ||
      !Number.isFinite(low) || !Number.isFinite(close) ||
      !Number.isFinite(volume)) {
    logger.error(`Invalid candle data received`, {
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      timestamp,
      symbol,
      interval,
    });
    return null;
  }
  
  const utcSeconds = Math.floor(new Date(timestamp).getTime() / 1000);
  
  return {
    time: utcSeconds as any,
    open,
    high,
    low,
    close,
    volume,
  };
};

export const formatChartValue = (value: number): string => {
  return new Intl.NumberFormat('vi-VN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

export const formatTooltipTime = (time: number | string): string => {
  const date = typeof time === 'number'
    ? new Date(time * 1000)
    : new Date(time);

  if (isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('vi-VN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
};
