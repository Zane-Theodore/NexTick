import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class CandlesService {
  private readonly logger = new Logger(CandlesService.name);
  private readonly moduleName = CandlesService.name;

  private readonly VALID_INTERVALS = [
    '1m', '3m', '5m', '15m', '30m', 
    '1h', '2h', '4h', '6h', '8h', '12h', 
    '1d', '3d', '1w', '1M'
  ];

  constructor(private readonly databaseService: DatabaseService) {}

  async getHistoricalCandles(symbol: string = 'BTCUSDT', limit: number = 100, interval: string = '1m') {
    this.logger.log(`[INFO] [${this.moduleName}] Fetching historical candles for symbol: ${symbol}, interval: ${interval}, limit: ${limit}`);

    try {
      if (!this.VALID_INTERVALS.includes(interval)) {
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
              ...row,
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