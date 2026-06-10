import { Injectable } from '@nestjs/common';
import { CandleDto } from './dto/candle.dto';
import { KlineUpdateDto } from './dto/kline-update.dto';

@Injectable()
export class RecentCandlesCacheService {
  private readonly maxCandlesPerRoom = 500;
  private readonly candlesByRoom = new Map<string, KlineUpdateDto[]>();

  upsert(candle: KlineUpdateDto): void {
    const roomKey = this.getRoomKey(candle.symbol, candle.interval);
    const cachedCandles = this.candlesByRoom.get(roomKey) ?? [];
    const normalizedCandle = this.normalizeCandle(candle);
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

  private normalizeCandle(candle: KlineUpdateDto): KlineUpdateDto {
    return {
      ...candle,
      symbol: candle.symbol.toUpperCase(),
      timestamp: new Date(candle.timestamp).toISOString(),
    };
  }
}
