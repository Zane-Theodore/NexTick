import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class CandlesService {
  private readonly logger = new Logger(CandlesService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async getHistoricalCandles(symbol: string = 'BTCUSDT', limit: number = 100) {
    this.logger.log(`[GET_HISTORICAL_CANDLES] Fetching historical candles for symbol: ${symbol} with limit: ${limit}`);

    try {
      const safeSymbol = symbol.toLowerCase().replace(/[^a-z0-9]/g, '');
      const tableName = `${safeSymbol}_1m_candles`;

      const query = `
        SELECT * FROM ${tableName} 
        ORDER BY timestamp DESC 
        LIMIT $1;
      `;
      
      const parameters = [limit];
      
      const result = await this.databaseService.query(query, parameters);

      const candles = result.rows ? result.rows.reverse() : [];

      this.logger.log(`[GET_HISTORICAL_CANDLES_SUCCESS] Retrieved ${candles.length} candles for symbol: ${symbol}`);
      return candles;
      
    } catch (error) {
      this.logger.error(`[GET_HISTORICAL_CANDLES_ERROR] Failed to fetch historical candles for symbol: ${symbol}. Error: ${error}`);
      throw error;
    }
  }
}