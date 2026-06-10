import { Injectable, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CandleDto } from './dto/candle.dto';
import { VALID_INTERVALS } from './enum/candle-interval.enum';
import { AppLogger } from '../../common/logger';
import { RecentCandlesCacheService } from './recent-candles-cache.service';
import { isValidCandleOhlcv, parseCandleNumber } from './candle-validation';

type HistoricalCandleRow = {
  timestamp: string | Date;
  symbol: string;
  interval: string;
  open: number | string | null;
  high: number | string | null;
  low: number | string | null;
  close: number | string | null;
  volume: number | string | null;
};

type HistoricalCandlesQueryResult = {
  rows?: HistoricalCandleRow[];
};

@Injectable()
export class CandlesService {
  private readonly logger = new AppLogger(CandlesService.name);
  private readonly intervalMs: Record<string, number> = {
    '1m': 60_000,
    '3m': 3 * 60_000,
    '5m': 5 * 60_000,
    '15m': 15 * 60_000,
    '30m': 30 * 60_000,
    '1h': 60 * 60_000,
    '2h': 2 * 60 * 60_000,
    '4h': 4 * 60 * 60_000,
    '6h': 6 * 60 * 60_000,
    '8h': 8 * 60 * 60_000,
    '12h': 12 * 60 * 60_000,
    '1d': 24 * 60 * 60_000,
    '3d': 3 * 24 * 60 * 60_000,
    '1w': 7 * 24 * 60 * 60_000,
    '1M': 30 * 24 * 60 * 60_000,
  };

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly recentCandlesCache: RecentCandlesCacheService,
  ) {}

  private normalizeQuestDbTimestamp(value: string | Date): string {
    if (value instanceof Date) {
      return new Date(
        Date.UTC(
          value.getFullYear(),
          value.getMonth(),
          value.getDate(),
          value.getHours(),
          value.getMinutes(),
          value.getSeconds(),
          value.getMilliseconds(),
        ),
      ).toISOString();
    }

    const timestamp = value.trim();
    const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(timestamp);
    return new Date(hasTimezone ? timestamp : `${timestamp}Z`).toISOString();
  }

  private toQuestDbTimestamp(value: Date): string {
    return value
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d{3}Z$/, '');
  }

  async getHistoricalCandles(
    symbol: string = 'BTCUSDT',
    limit: number = 100,
    interval: string = '1m',
  ): Promise<CandleDto[]> {
    this.logger.info('Fetching historical candles', {
      symbol,
      interval,
      limit,
    });

    try {
      if (!(VALID_INTERVALS as readonly string[]).includes(interval)) {
        throw new BadRequestException(
          `Invalid time interval requested: ${interval}`,
        );
      }

      const safeSymbol = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const stepMs = this.intervalMs[interval];
      const requestedWindowMs = Math.max(stepMs * limit * 2, 24 * 60 * 60_000);
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - requestedWindowMs);
      const startTimestamp = this.toQuestDbTimestamp(startTime);
      const endTimestamp = this.toQuestDbTimestamp(endTime);
      this.logger.info('Resolved historical candle query window', {
        symbol: safeSymbol,
        interval,
        limit,
        startTimestamp,
        endTimestamp,
      });

      const query = `
        WITH deduped_1m AS (
          SELECT
            timestamp,
            symbol,
            interval,
            last(open) AS open,
            last(high) AS high,
            last(low) AS low,
            last(close) AS close,
            last(volume) AS volume
          FROM market_candles
          WHERE symbol = $1
            AND interval = '1m'
            AND timestamp >= $2
            AND timestamp < $3
            AND open > 0
            AND high > 0
            AND low > 0
            AND close > 0
            AND volume >= 0
            AND high >= open
            AND high >= close
            AND low <= open
            AND low <= close
            AND high >= low
          SAMPLE BY 1m ALIGN TO CALENDAR
        )
        SELECT 
          timestamp,
          symbol,
          '${interval}' AS interval,
          first(open) AS open,
          max(high) AS high,
          min(low) AS low,
          last(close) AS close,
          sum(volume) AS volume
        FROM deduped_1m
        SAMPLE BY ${interval} ALIGN TO CALENDAR
        ORDER BY timestamp DESC
        LIMIT $4;
      `;

      const parameters = [safeSymbol, startTimestamp, endTimestamp, limit];

      const result = (await this.databaseService.query(
        query,
        parameters,
      )) as HistoricalCandlesQueryResult;

      const candles = result.rows
        ? [...result.rows]
            .reverse()
            .map((row) => {
              return {
                symbol: row.symbol,
                interval: row.interval,
                open: parseCandleNumber(row.open),
                high: parseCandleNumber(row.high),
                low: parseCandleNumber(row.low),
                close: parseCandleNumber(row.close),
                volume: parseCandleNumber(row.volume),
                timestamp: this.normalizeQuestDbTimestamp(row.timestamp),
              };
            })
            .filter((candle) => {
              const isValid = isValidCandleOhlcv(candle);

              if (!isValid) {
                this.logger.warning(
                  'Invalid OHLC candle filtered from history response',
                  {
                    symbol: safeSymbol,
                    interval,
                    candle,
                  },
                );
              }

              return isValid;
            })
        : [];

      const candlesWithRealtimeTail = this.recentCandlesCache.mergeWithHistory(
        candles,
        safeSymbol,
        interval,
        limit,
      );

      this.detectHistoryGaps(candlesWithRealtimeTail, safeSymbol, interval);

      this.logger.info(
        `Successfully aggregated ${candlesWithRealtimeTail.length} [${interval}] candles for ${symbol}`,
      );
      return candlesWithRealtimeTail;
    } catch (error) {
      this.logger.failure('Failed to fetch historical candles', error, {
        symbol,
        interval,
      });
      throw error;
    }
  }

  private detectHistoryGaps(
    candles: CandleDto[],
    symbol: string,
    interval: string,
  ) {
    const stepMs = this.intervalMs[interval];

    if (!stepMs || candles.length < 2) {
      return;
    }

    const missing: Array<{ expected: string; actual: string }> = [];
    const duplicates: string[] = [];
    let previousTime = new Date(candles[0].timestamp).getTime();

    for (let index = 1; index < candles.length; index += 1) {
      const currentTime = new Date(candles[index].timestamp).getTime();
      const delta = currentTime - previousTime;

      if (delta === 0) {
        duplicates.push(candles[index].timestamp);
      } else if (delta !== stepMs) {
        missing.push({
          expected: new Date(previousTime + stepMs).toISOString(),
          actual: candles[index].timestamp,
        });
      }

      previousTime = currentTime;
    }

    if (duplicates.length > 0) {
      this.logger.warning(
        'Duplicate candle open_time detected in history response',
        {
          symbol,
          interval,
          duplicateCount: duplicates.length,
          samples: duplicates.slice(0, 5),
        },
      );
    }

    if (missing.length > 0) {
      this.logger.warning('Missing candles detected in history response', {
        symbol,
        interval,
        missingGapCount: missing.length,
        samples: missing.slice(0, 5),
      });
    }
  }
}
