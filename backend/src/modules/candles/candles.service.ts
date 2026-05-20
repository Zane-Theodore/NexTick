import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CandleDto } from './dto/candle.dto';
import { VALID_INTERVALS } from './enum/candle-interval.enum';

@Injectable()
export class CandlesService {
  private readonly logger = new Logger(CandlesService.name);
  private readonly moduleName = CandlesService.name;

  constructor(private readonly databaseService: DatabaseService) {}

  async getHistoricalCandles(symbol: string = 'BTCUSDT', limit: number = 100, interval: string = '1m'): Promise<CandleDto[]> {
    this.logger.log(`[INFO] [${this.moduleName}] Fetching historical candles for symbol: ${symbol}, interval: ${interval}, limit: ${limit}`);

    try {
      if (!(VALID_INTERVALS as readonly string[]).includes(interval)) {
        throw new BadRequestException(`Invalid time interval requested: ${interval}`);
      }

      const safeSymbol = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');

      const query = `
        SELECT 
          timestamp,
          symbol,
          '${interval}' AS interval,
          first(open) AS open,
          max(high) AS high,
          min(low) AS low,
          last(close) AS close,
          sum(volume) AS volume
        FROM market_candles
        WHERE symbol = $1 AND interval = '1m'
        SAMPLE BY ${interval} ALIGN TO CALENDAR
        ORDER BY timestamp DESC
        LIMIT $2;
      `;

      const parameters = [safeSymbol, limit];

      const result = await this.databaseService.query(query, parameters);

      const candles = result.rows
        ? result.rows.reverse().map((row) => {
            const localDate = new Date(row.timestamp);

            const utcTime =
              localDate.getTime() - localDate.getTimezoneOffset() * 60000;

            return {
              symbol: row.symbol,
              interval: row.interval,
              open: Number(row.open),
              high: Number(row.high),
              low: Number(row.low),
              close: Number(row.close),
              volume: Number(row.volume),
              timestamp: new Date(utcTime).toISOString(),
            };
          })
        : [];

      this.logger.log(`[INFO] [${this.moduleName}] Successfully aggregated ${candles.length} [${interval}] candles for ${symbol}`);
      return candles;
      
    } catch (error) {
      this.logger.error(`[ERROR] [${this.moduleName}] Failed to fetch historical candles for symbol: ${symbol}, interval: ${interval}`, error);
      throw error;
    }
  }
}
