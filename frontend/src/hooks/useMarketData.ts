import { useEffect } from 'react';
import { formatCandle } from '../utils/formatters';
import { subscribeToCandles, joinKlineRoom, leaveKlineRoom } from '../services/socket';
import { getHistoricalCandles } from '../services/api';
import { Logger } from '../utils/logger';
import type { ISeriesApi, IChartApi, CandlestickData, Time } from 'lightweight-charts';

const logger = new Logger('MarketData');

export const useMarketData = (
  chart: IChartApi | null,
  candlestickSeries: ISeriesApi<"Candlestick"> | null, 
  symbol: string = 'BTCUSDT',
  interval: string = '1m'
) => {
  useEffect(() => {
    if (!candlestickSeries || !chart) return;

    const fetchHistory = async () => {
      try {
        candlestickSeries.setData([]); 
        
        const rawCandles = await getHistoricalCandles(symbol, interval, 1000);

        if (!rawCandles || rawCandles.length === 0) {
          logger.warn(`No candle data received from API for symbol: ${symbol}, interval: ${interval}`);
          return;
        }

        const formattedData = rawCandles
          .map(formatCandle)
          .filter((candle: ReturnType<typeof formatCandle>): candle is Exclude<ReturnType<typeof formatCandle>, null> => {
            return candle !== null && 
                   candle.open > 0 && 
                   candle.high > 0 && 
                   candle.low > 0 && 
                   candle.close > 0;
          });
        
        if (formattedData.length === 0) {
          logger.warn(`No valid candle data after formatting for symbol: ${symbol}, interval: ${interval}`);
          return;
        }

        candlestickSeries.setData(formattedData as CandlestickData<Time>[]);
        logger.info(`Successfully loaded ${formattedData.length} candles for symbol: ${symbol} [${interval}]`);

        const totalCandles = formattedData.length;
        const OFFSET_RIGHT = 10;
        const VISIBLE_CANDLES = 30;

        chart.timeScale().setVisibleLogicalRange({
          from: Math.max(0, totalCandles + OFFSET_RIGHT - VISIBLE_CANDLES),
          to: totalCandles + OFFSET_RIGHT,
        });
        
        // Join room to receive real-time updates after data is loaded
        joinKlineRoom(symbol, interval);
        logger.info(`Joined kline room: ${symbol}_${interval}`);
        
      } catch (error) {
        logger.error(`Failed to fetch historical data for symbol: ${symbol}, interval: ${interval}`, error);
      }
    };

    fetchHistory();

    const handleCandleUpdate = (data: any) => {
      const formatted = formatCandle(data);
      
      if (formatted && formatted.open > 0 && formatted.high > 0 && formatted.low > 0 && formatted.close > 0) {
        candlestickSeries.update(formatted as CandlestickData<Time>);
        
        if (data.is_final) {
          logger.info(`Final candle received for ${data.symbol} [${data.interval}]: O=${data.open}, C=${data.close}, V=${data.volume}`);
        }
      } else {
        if (formatted) {
            logger.warn(`Zero-drop candle filtered out from socket:`, data);
        }
      }
    };

    // Subscribe to kline updates via room pattern
    const unsubscribe = subscribeToCandles(handleCandleUpdate);

    return () => {
      unsubscribe();
      // Leave room when component unmounts or dependencies change
      leaveKlineRoom(symbol, interval);
      logger.info(`Left kline room: ${symbol}_${interval}`);
    };
  }, [chart, candlestickSeries, symbol, interval]);
};