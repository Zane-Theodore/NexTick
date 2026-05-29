export const INDICATOR_CONFIG = [
  { period: 7, color: '#f5d90a', mutedColor: '#f5d90a80' },
  { period: 25, color: '#ff4ecd', mutedColor: '#ff4ecd80' },
  { period: 99, color: '#00d4ff', mutedColor: '#00d4ff80' },
] as const;

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
