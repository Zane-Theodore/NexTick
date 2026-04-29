import { useEffect } from 'react';
import { formatCandle } from '../utils/formatters';
import { socket } from '../services/socket';
import { getHistoricalCandles } from '../services/api';
import type { ISeriesApi, IChartApi } from 'lightweight-charts';

export const useMarketData = (
  chart: IChartApi | null,
  candlestickSeries: ISeriesApi<"Candlestick"> | null, 
  symbol: string = 'BTCUSDT'
) => {
  useEffect(() => {
    if (!candlestickSeries || !chart) return;

    const fetchHistory = async () => {
      try {
        const rawCandles = await getHistoricalCandles(symbol, 1000);
        candlestickSeries.setData(rawCandles.map(formatCandle));

        chart.timeScale().fitContent(); 
      } catch (error) {
        console.error('Error fetching historical data:', error);
      }
    };

    fetchHistory();

    const handleUpdate = (data: any) => {
      const formatted = formatCandle(data);
      if (formatted) candlestickSeries.update(formatted);
    };

    socket.on('candle.updating', handleUpdate);
    socket.on('candle.created', handleUpdate);

    return () => {
      socket.off('candle.updating', handleUpdate);
      socket.off('candle.created', handleUpdate);
    };
  }, [chart, candlestickSeries, symbol]);
};