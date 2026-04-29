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
        candlestickSeries.setData([]); 
        
        const rawCandles = await getHistoricalCandles(symbol, 1000);

        if (!rawCandles || rawCandles.length === 0) {
          console.warn('No candle data received from API');
          return;
        }

        console.log('Dữ liệu API:', rawCandles[0]);

        const formattedData = rawCandles
          .map(formatCandle)
          .filter((candle: ReturnType<typeof formatCandle>): candle is Exclude<ReturnType<typeof formatCandle>, null> => candle !== null);
        
        if (formattedData.length === 0) {
          console.warn('No valid candle data after formatting');
          return;
        }

        candlestickSeries.setData(formattedData);

        const totalCandles = formattedData.length;
        chart.timeScale().setVisibleLogicalRange({
          from: Math.max(0, totalCandles - 50),
          to: totalCandles,
        });
      } catch (error) {
        console.error('Error fetching historical data:', error);
      }
    };

    fetchHistory();

    const handleUpdate = (data: any) => {
      const formatted = formatCandle(data);
      if (formatted) {
        candlestickSeries.update(formatted);
      } else {
        console.warn('Skipped invalid candle data from socket update');
      }
    };

    socket.on('candle.updating', handleUpdate);
    socket.on('candle.created', handleUpdate);

    return () => {
      socket.off('candle.updating', handleUpdate);
      socket.off('candle.created', handleUpdate);
    };
  }, [chart, candlestickSeries, symbol]);
};