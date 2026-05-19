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

interface RawCandle {
  timestamp?: string | number | Date;
  symbol?: string;
  interval?: string;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
  volume?: unknown;
}

export const formatCandle = (candle: unknown): FormattedCandle | null => {
  if (!candle || typeof candle !== 'object' || !('timestamp' in candle) || !candle.timestamp) {
    return null;
  }

  const rawCandle = candle as RawCandle;
  const { timestamp, symbol, interval } = rawCandle;
  if (timestamp === undefined) {
    return null;
  }

  const open = Number(rawCandle.open);
  const high = Number(rawCandle.high);
  const low = Number(rawCandle.low);
  const close = Number(rawCandle.close);
  const volume = Number(rawCandle.volume ?? 0);

  if (!Number.isFinite(open) || !Number.isFinite(high) ||
      !Number.isFinite(low) || !Number.isFinite(close) ||
      !Number.isFinite(volume)) {
    logger.error(`Invalid candle data received`, {
      open: rawCandle.open,
      high: rawCandle.high,
      low: rawCandle.low,
      close: rawCandle.close,
      volume: rawCandle.volume,
      timestamp,
      symbol,
      interval,
    });
    return null;
  }
  
  const utcSeconds = Math.floor(new Date(timestamp).getTime() / 1000);
  
  return {
    time: utcSeconds,
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

export type ChartTime = number | string | { year: number; month: number; day: number };

const parseChartTime = (time: ChartTime): Date | null => {
  if (typeof time === 'number') {
    return new Date(time * 1000);
  }

  if (typeof time === 'string') {
    return new Date(time);
  }

  return new Date(time.year, time.month - 1, time.day);
};

export const formatTimeScaleTick = (time: ChartTime): string => {
  const date = parseChartTime(time);

  if (!date || isNaN(date.getTime())) {
    return '';
  }

  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
};

export const formatTimeScaleCrosshair = (time: ChartTime): string => {
  const date = parseChartTime(time);

  if (!date || isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

export const formatTooltipTime = (time: ChartTime): string => {
  const date = parseChartTime(time);

  if (!date || isNaN(date.getTime())) {
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
