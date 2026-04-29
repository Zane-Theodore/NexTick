import axios from 'axios';

const API_URL = 'http://localhost:3000';

export const getHistoricalCandles = async (symbol: string = 'BTCUSDT', limit: number = 1000) => {
  try {
    const { data } = await axios.get(`${API_URL}/candles`, {
      params: { symbol, limit }
    });
    return data.data;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
};