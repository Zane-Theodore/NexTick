import { Injectable } from '@nestjs/common';
import { CandleDto } from './dto/candle.dto';
import { KlineUpdateDto } from './dto/kline-update.dto';
import { AppLogger } from '../../common/logger';
import { isValidCandleOhlcv, parseCandleNumber } from './candle-validation';

@Injectable()
export class RecentCandlesCacheService {
  private readonly logger = new AppLogger(RecentCandlesCacheService.name);
  private readonly maxCandlesPerRoom = 500;
  private readonly candlesByRoom = new Map<string, KlineUpdateDto[]>();

  upsert(candle: KlineUpdateDto): void {
    const normalizedCandle = this.normalizeCandle(candle);

    if (!normalizedCandle) {
      this.logger.warning('Invalid realtime candle skipped from cache', {
        symbol: candle.symbol,
        interval: candle.interval,
        timestamp: candle.timestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      });
      return;
    }

    const roomKey = this.getRoomKey(
      normalizedCandle.symbol,
      normalizedCandle.interval,
    );
    const cachedCandles = this.candlesByRoom.get(roomKey) ?? [];
    const existingIndex = cachedCandles.findIndex(
      (cachedCandle) => cachedCandle.timestamp === normalizedCandle.timestamp,
    );

    if (existingIndex >= 0) {
      cachedCandles[existingIndex] = normalizedCandle;
    } else {
      cachedCandles.push(normalizedCandle);
    }

    cachedCandles.sort((left, right) => {
      return (
        new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
      );
    });

    this.candlesByRoom.set(
      roomKey,
      cachedCandles.slice(-this.maxCandlesPerRoom),
    );
  }

  getKlineUpdates(symbol: string, interval: string): KlineUpdateDto[] {
    const roomKey = this.getRoomKey(symbol, interval);
    return [...(this.candlesByRoom.get(roomKey) ?? [])];
  }

  mergeWithHistory(
    history: CandleDto[],
    symbol: string,
    interval: string,
    limit: number,
  ): CandleDto[] {
    const candlesByTimestamp = new Map<string, CandleDto>();

    history.forEach((candle) => {
      candlesByTimestamp.set(candle.timestamp, candle);
    });

    this.getKlineUpdates(symbol, interval).forEach((candle) => {
      if (isValidCandleOhlcv(candle)) {
        candlesByTimestamp.set(candle.timestamp, {
          timestamp: candle.timestamp,
          symbol: candle.symbol,
          interval: candle.interval,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        });
      } else {
        this.logger.warning('Invalid candle skipped from merge', {
          symbol: candle.symbol,
          interval: candle.interval,
          timestamp: candle.timestamp,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        });
      }
    });

    return [...candlesByTimestamp.values()]
      .sort((left, right) => {
        return (
          new Date(left.timestamp).getTime() -
          new Date(right.timestamp).getTime()
        );
      })
      .slice(-limit);
  }

  private getRoomKey(symbol: string, interval: string): string {
    return `${symbol.toUpperCase()}_${interval}`;
  }

  private normalizeCandle(candle: KlineUpdateDto): KlineUpdateDto | null {
    const timestamp = new Date(candle.timestamp);

    if (Number.isNaN(timestamp.getTime())) {
      return null;
    }

    const normalizedCandle = {
      ...candle,
      symbol: String(candle.symbol ?? '').toUpperCase(),
      interval: String(candle.interval ?? ''),
      timestamp: timestamp.toISOString(),
      open: parseCandleNumber(candle.open),
      high: parseCandleNumber(candle.high),
      low: parseCandleNumber(candle.low),
      close: parseCandleNumber(candle.close),
      volume: parseCandleNumber(candle.volume),
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
}
