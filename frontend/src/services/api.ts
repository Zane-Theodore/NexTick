import axios from 'axios';
import { Logger } from '../utils/logger';

const API_URL = 'http://localhost:3000';
const logger = new Logger('API');

export const getHistoricalCandles = async (symbol: string = 'BTCUSDT', limit: number = 1000) => {
  try {
    const { data } = await axios.get(`${API_URL}/candles`, {
      params: { symbol, limit }
    });
    return data.data;
  } catch (error) {
    logger.error(`Failed to fetch historical candles for symbol: ${symbol}`, error);
    throw error;
  }
};