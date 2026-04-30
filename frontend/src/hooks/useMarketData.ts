import { useEffect } from 'react';
import { formatCandle } from '../utils/formatters';
import { socket } from '../services/socket';
import { getHistoricalCandles } from '../services/api';
import { Logger } from '../utils/logger';
import type { ISeriesApi, IChartApi } from 'lightweight-charts';

const logger = new Logger('MarketData');

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
          logger.warn(`No candle data received from API for symbol: ${symbol}`);
          return;
        }

        const formattedData = rawCandles
          .map(formatCandle)
          .filter((candle: ReturnType<typeof formatCandle>): candle is Exclude<ReturnType<typeof formatCandle>, null> => candle !== null);
        
        if (formattedData.length === 0) {
          logger.warn(`No valid candle data after formatting for symbol: ${symbol}`);
          return;
        }

        candlestickSeries.setData(formattedData);
        logger.info(`Successfully loaded ${formattedData.length} candles for symbol: ${symbol}`);

        const totalCandles = formattedData.length;
        const OFFSET_RIGHT = 10;
        const VISIBLE_CANDLES = 30;

        chart.timeScale().setVisibleLogicalRange({
          from: Math.max(0, totalCandles + OFFSET_RIGHT - VISIBLE_CANDLES),
          to: totalCandles + OFFSET_RIGHT,
        });
        
      } catch (error) {
        logger.error(`Failed to fetch historical data for symbol: ${symbol}`, error);
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
          logger.info(`Final candle received for ${data.symbol}: Open=${data.open}, Close=${data.close}, Volume=${data.volume}`);
        }
      } else {
        logger.warn(`Invalid candle data received from socket update`, data);
      }
    };

    // Single unified event listener for all candle updates (both final and updating)
    socket.on('candle.update', handleCandleUpdate);

    return () => {
      socket.off('candle.update', handleCandleUpdate);
    };
  }, [chart, candlestickSeries, symbol]);
};