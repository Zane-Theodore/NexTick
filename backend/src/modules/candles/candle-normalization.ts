import { CandleDto } from './dto/candle.dto';
import { KlineUpdateDto } from './dto/kline-update.dto';
import { isValidCandleOhlcv, parseCandleNumber } from './candle-validation';

export type KlineUpdateInput = Partial<
  Pick<
    KlineUpdateDto,
    | 'timestamp'
    | 'symbol'
    | 'interval'
    | 'open'
    | 'high'
    | 'low'
    | 'close'
    | 'volume'
    | 'is_final'
  >
>;

function toText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }

  return '';
}

export function normalizeCandleSymbol(value: unknown): string {
  return toText(value).toUpperCase();
}

export function sanitizeCandleSymbol(value: string): string {
  return normalizeCandleSymbol(value).replace(/[^A-Z0-9]/g, '');
}

export function getCandleRoomKey(symbol: string, interval: string): string {
  return `${normalizeCandleSymbol(symbol)}_${interval}`;
}

export function normalizeTimestampToIso(value: unknown): string | null {
  const timestamp = new Date(toText(value));

  if (Number.isNaN(timestamp.getTime())) {
    return null;
  }

  return timestamp.toISOString();
}

export function compareTimestampAsc<T extends { timestamp: string }>(
  left: T,
  right: T,
): number {
  return (
    new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
  );
}

export function normalizeKlineUpdate(
  value: KlineUpdateInput,
): KlineUpdateDto | null {
  const timestamp = normalizeTimestampToIso(value.timestamp);

  if (!timestamp) {
    return null;
  }

  const normalizedCandle = {
    timestamp,
    symbol: normalizeCandleSymbol(value.symbol),
    interval: toText(value.interval),
    open: parseCandleNumber(value.open),
    high: parseCandleNumber(value.high),
    low: parseCandleNumber(value.low),
    close: parseCandleNumber(value.close),
    volume: parseCandleNumber(value.volume),
    is_final: value.is_final === true,
  };

  if (
    !normalizedCandle.symbol ||
    !normalizedCandle.interval ||
    !isValidCandleOhlcv(normalizedCandle)
  ) {
    return null;
  }

  return normalizedCandle;
}

export function klineUpdateToCandleDto(candle: KlineUpdateDto): CandleDto {
  return {
    timestamp: candle.timestamp,
    symbol: candle.symbol,
    interval: candle.interval,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  };
}
