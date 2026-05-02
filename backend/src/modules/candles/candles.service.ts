import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class CandlesService {
  private readonly logger = new Logger();
  private readonly moduleName = CandlesService.name;

  constructor(private readonly databaseService: DatabaseService) {}

  async getHistoricalCandles(symbol: string = 'BTCUSDT', limit: number = 100, interval: string = '1m') {
    this.logger.log(`[INFO] [${this.moduleName}] Fetching historical candles for symbol: ${symbol}, interval: ${interval}, limit: ${limit}`);

    try {
      const safeSymbol = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');

      // Query from unified candles table
      const query = `
        SELECT 
          timestamp,
          symbol,
          interval,
          open,
          high,
          low,
          close,
          volume
        FROM candles
        WHERE symbol = $1 AND interval = $2
        ORDER BY timestamp DESC
        LIMIT $3;
      `;
      
      const parameters = [safeSymbol, interval, limit];
      
      const result = await this.databaseService.query(query, parameters);

      const candles = result.rows ? result.rows.reverse() : [];

      this.logger.log(`[INFO] [${this.moduleName}] Retrieved ${candles.length} candles for ${symbol} [${interval}]`);
      return candles;
      
    } catch (error) {
      this.logger.error(`[ERROR] [${this.moduleName}] Failed to fetch historical candles for symbol: ${symbol}, interval: ${interval}`);
      throw error;
    }
  }
}