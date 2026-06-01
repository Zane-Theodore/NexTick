import type { IndicatorSetting } from '../../types/chart';

export const DEFAULT_INDICATOR_SETTINGS: IndicatorSetting[] = [
  { id: 'ema-7', group: 'ema', label: 'EMA', visible: true, period: 7, color: '#f5d90a' },
  { id: 'ema-25', group: 'ema', label: 'EMA', visible: true, period: 25, color: '#ff4ecd' },
  { id: 'ema-99', group: 'ema', label: 'EMA', visible: true, period: 99, color: '#00d4ff' },
  { id: 'ma-7', group: 'ma', label: 'MA', visible: true, period: 7, color: '#d9e3f0' },
  { id: 'ma-25', group: 'ma', label: 'MA', visible: true, period: 25, color: '#9ca3af' },
  { id: 'ma-99', group: 'ma', label: 'MA', visible: true, period: 99, color: '#64748b' },
  { id: 'volume-ma-20', group: 'volume-ma', label: 'Vol MA', visible: true, period: 20, color: '#f59e0b' },
  { id: 'rsi-14', group: 'rsi', label: 'RSI', visible: false, period: 14, color: '#a78bfa' },
  {
    id: 'macd',
    group: 'macd',
    label: 'MACD',
    visible: false,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    macdColor: '#38bdf8',
    signalColor: '#f97316',
  },
];

export const MAIN_CHART_DEFAULT_STRETCH_FACTOR = 85;
export const VOLUME_CHART_DEFAULT_STRETCH_FACTOR = 15;

export const CHART_UP_COLOR = '#26a69a';
export const CHART_DOWN_COLOR = '#ef5350';
export const CHART_DEFAULT_BAR_SPACING = 12;
export const CHART_MIN_BAR_SPACING = 10;
export const CHART_MAX_BAR_SPACING = 80;

export const SUPPORTED_SYMBOLS = import.meta.env.VITE_TRADING_SYMBOLS.split(',').map((symbol: string) => symbol.trim());
export const SUPPORTED_INTERVALS = import.meta.env.VITE_CANDLE_INTERVALS.split(',').map((interval: string) => interval.trim());

const INTERVAL_UNITS: Record<string, string> = {
  m: 'minute',
  h: 'hour',
  d: 'day',
  w: 'week',
  M: 'month',
};

export const formatIntervalLabel = (interval: string): string => {
  const match = interval.match(/^(\d+)([mhdwM])$/);

  if (!match) {
    return interval;
  }

  const [, rawValue, unitKey] = match;
  const value = Number(rawValue);
  const unit = INTERVAL_UNITS[unitKey];

  if (!unit || !Number.isFinite(value)) {
    return interval;
  }

  return `${value} ${unit}${value === 1 ? '' : 's'}`;
};
