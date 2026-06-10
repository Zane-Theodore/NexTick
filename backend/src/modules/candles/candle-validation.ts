import { CandleDto } from './dto/candle.dto';

export type CandleOhlcv = Pick<
  CandleDto,
  'open' | 'high' | 'low' | 'close' | 'volume'
>;

export function parseCandleNumber(value: unknown): number {
  if (value === null || value === undefined) {
    return Number.NaN;
  }

  if (typeof value === 'string' && value.trim() === '') {
    return Number.NaN;
  }

  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : Number.NaN;
}

export function isValidCandleOhlcv(candle: CandleOhlcv): boolean {
  return (
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close) &&
    Number.isFinite(candle.volume) &&
    candle.open > 0 &&
    candle.high > 0 &&
    candle.low > 0 &&
    candle.close > 0 &&
    candle.volume >= 0 &&
    candle.high >= Math.max(candle.open, candle.close) &&
    candle.low <= Math.min(candle.open, candle.close) &&
    candle.high >= candle.low
  );
}
