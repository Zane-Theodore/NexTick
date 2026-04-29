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

        const formattedData = rawCandles
          .map(formatCandle)
          .filter((candle: ReturnType<typeof formatCandle>): candle is Exclude<ReturnType<typeof formatCandle>, null> => candle !== null);
        
        if (formattedData.length === 0) {
          console.warn('No valid candle data after formatting');
          return;
        }

        candlestickSeries.setData(formattedData);

        const totalCandles = formattedData.length;
        const OFFSET_RIGHT = 10;
        const VISIBLE_CANDLES = 30;

        chart.timeScale().setVisibleLogicalRange({
          from: Math.max(0, totalCandles + OFFSET_RIGHT - VISIBLE_CANDLES),
          to: totalCandles + OFFSET_RIGHT,
        });
        
      } catch (error) {
        console.error('Error fetching historical data:', error);
      }
    };

    fetchHistory();

    const handleCandleUpdate = (data: any) => {
      const formatted = formatCandle(data);
      if (formatted) {
        // Lightweight-charts automatically handles:
        // - If timestamp matches existing candle: updates the body
        // - If timestamp is new: creates a new candle
        candlestickSeries.update(formatted);
        
        // Log for debugging (only for final candles)
        if (data.is_final) {
          console.log(`[Candle FINAL] ${data.symbol} @ ${data.timestamp} - O:${data.open}, C:${data.close}, V:${data.volume}`);
        }
      } else {
        console.warn('Skipped invalid candle data from socket update', data);
      }
    };

    // Single unified event listener for all candle updates (both final and updating)
    socket.on('candle.update', handleCandleUpdate);

    return () => {
      socket.off('candle.update', handleCandleUpdate);
    };
  }, [chart, candlestickSeries, symbol]);
};