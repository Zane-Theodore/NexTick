import axios from 'axios';
import { Logger } from '../utils/logger';
import type { MarketCandle } from '../utils/formatters';

export const API_URL = import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? '';
export const API_HEALTH_URL = import.meta.env.VITE_API_HEALTH_URL?.replace(/\/$/, '') ?? '';
const logger = new Logger('API');

interface CandlesResponse {
  success: boolean;
  symbol: string;
  interval: string;
  count: number;
  data: MarketCandle[];
}

export const getHistoricalCandles = async (
  symbol: string = 'BTCUSDT',
  interval: string = '1m',
  limit: number = 2000
): Promise<MarketCandle[]> => {
  if (!API_URL) {
    throw new Error('VITE_API_URL is not configured');
  }

  try {
    const { data } = await axios.get<CandlesResponse>(`${API_URL}/candles`, {
      params: { symbol, interval, limit }
    });
    return data.data;
  } catch (error) {
    logger.error(`Failed to fetch historical candles for symbol: ${symbol}, interval: ${interval}`, error);
    throw error;
  }
};
