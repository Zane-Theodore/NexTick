import axios from 'axios';
import { Logger } from '../utils/logger';

const API_URL = import.meta.env.VITE_API_URL;
const logger = new Logger('API');

export const getHistoricalCandles = async (
  symbol: string = 'BTCUSDT',
  interval: string = '1m',
  limit: number = 1000
) => {
  try {
    const { data } = await axios.get(`${API_URL}/candles`, {
      params: { symbol, interval, limit }
    });
    return data.data;
  } catch (error) {
    logger.error(`Failed to fetch historical candles for symbol: ${symbol}, interval: ${interval}`, error);
    throw error;
  }
};