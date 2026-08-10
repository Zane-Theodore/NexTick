import { Injectable } from '@nestjs/common';
import { CandleDto } from './dto/candle.dto';
import { KlineUpdateDto } from './dto/kline-update.dto';
import { createLogger } from '../../common/logger';
import { isValidCandleOhlcv } from './candle-validation';
import {
  compareTimestampAsc,
  getCandleRoomKey,
  klineUpdateToCandleDto,
  normalizeKlineUpdate,
} from './candle-normalization';

@Injectable()
export class RecentCandlesCacheService {
  private readonly logger = createLogger(RecentCandlesCacheService.name);
  private readonly maxCandlesPerRoom = 500;
  private readonly candlesByRoom = new Map<string, KlineUpdateDto[]>();

  upsert(candle: KlineUpdateDto): void {
    const normalizedCandle = normalizeKlineUpdate(candle);

    if (!normalizedCandle) {
      this.logger.warn('Invalid realtime candle skipped from cache', {
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
      if (cachedCandles[existingIndex].is_final && !normalizedCandle.is_final) {
        return;
      }

      cachedCandles[existingIndex] = normalizedCandle;
    } else {
      cachedCandles.push(normalizedCandle);
    }

    cachedCandles.sort(compareTimestampAsc);

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
        candlesByTimestamp.set(
          candle.timestamp,
          klineUpdateToCandleDto(candle),
        );
      } else {
        this.logger.warn('Invalid candle skipped from merge', {
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
      .sort(compareTimestampAsc)
      .slice(-limit);
  }

  private getRoomKey(symbol: string, interval: string): string {
    return getCandleRoomKey(symbol, interval);
  }
}
