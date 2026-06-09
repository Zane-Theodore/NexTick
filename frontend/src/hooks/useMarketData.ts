import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { formatCandle } from '../utils/formatters';
import type { FormattedCandle } from '../utils/formatters';
import { getIndicatorData, getIndicatorValues } from '../utils/chartIndicators';
import { subscribeToCandles, joinKlineRoom, leaveKlineRoom } from '../services/socket';
import type { KlineUpdate } from '../services/socket';
import { getHistoricalCandles } from '../services/api';
import { Logger } from '../utils/logger';
import type { ISeriesApi, IChartApi, CandlestickData, Time } from 'lightweight-charts';
import type { IndicatorSeriesConfig, IndicatorSetting, IndicatorValue } from '../types/chart';
import { CHART_DOWN_COLOR, CHART_UP_COLOR } from '../components/chart/chartConstants';

const logger = new Logger('MarketData');

export const useMarketData = (
  chartRef: RefObject<IChartApi | null>,
  candlestickSeriesRef: RefObject<ISeriesApi<"Candlestick"> | null>, 
  volumeSeriesRef: RefObject<ISeriesApi<"Candlestick"> | null>,
  symbol: string = 'BTCUSDT',
  interval: string = '1m',
  volumeByTimeRef: RefObject<Map<string, number>>,
  latestCandleRef: RefObject<FormattedCandle | null>,
  candleHistoryRef: RefObject<FormattedCandle[]>,
  indicatorSeriesRef?: RefObject<IndicatorSeriesConfig[]>,
  indicatorSettings: IndicatorSetting[] = [],
  onIndicatorValuesChange?: (values: IndicatorValue[]) => void,
  onCandleHistoryChange?: () => void,
  isChartReady: boolean = true
) => {
  const indicatorSettingsRef = useRef<IndicatorSetting[]>(indicatorSettings);
  const onIndicatorValuesChangeRef = useRef(onIndicatorValuesChange);

  useEffect(() => {
    indicatorSettingsRef.current = indicatorSettings;
  }, [indicatorSettings]);

  useEffect(() => {
    onIndicatorValuesChangeRef.current = onIndicatorValuesChange;
  }, [onIndicatorValuesChange]);

  const syncIndicatorSeries = useCallback((history: FormattedCandle[]) => {
    indicatorSeriesRef?.current.forEach((config) => {
      const indicatorData = getIndicatorData(config, history);
      config.series.setData(indicatorData);
    });

    const nextValues = getIndicatorValues(indicatorSettingsRef.current, history);

    onIndicatorValuesChangeRef.current?.(nextValues);
  }, [indicatorSeriesRef]);

  useEffect(() => {
    if (!isChartReady || candleHistoryRef.current.length === 0) return;
    syncIndicatorSeries(candleHistoryRef.current);
  }, [indicatorSettings, isChartReady, candleHistoryRef, syncIndicatorSeries]);

  useEffect(() => {
    const chart = chartRef.current;
    const candlestickSeries = candlestickSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;

    if (!isChartReady) return;
    if (!candlestickSeries || !volumeSeries || !chart) return;

    let isCancelled = false;

    const fetchHistory = async () => {
      try {
        candlestickSeries.setData([]); 
        volumeSeries.setData([]);
        indicatorSeriesRef?.current.forEach(({ series: indicatorSeries }) => indicatorSeries.setData([]));
        candleHistoryRef.current = [];
        latestCandleRef.current = null;
        onCandleHistoryChange?.();
        onIndicatorValuesChangeRef.current?.([]);
        volumeByTimeRef.current.clear();
        
        const rawCandles = await getHistoricalCandles(symbol, interval, 2000);

        if (isCancelled) return;

        if (!rawCandles || rawCandles.length === 0) {
          logger.warn(`No candle data received from API for symbol: ${symbol}, interval: ${interval}`);
          return;
        }

        const formattedData: FormattedCandle[] = rawCandles
          .map(formatCandle)
          .filter((candle: ReturnType<typeof formatCandle>): candle is FormattedCandle => {
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

        const candleData = formattedData.map(({ time, open, high, low, close }) => ({
          time,
          open,
          high,
          low,
          close,
        })) as CandlestickData<Time>[];

        const volumeData = formattedData.map(({ time, open, close, volume }) => ({
          time,
          open: 0,
          high: volume,
          low: 0,
          close: volume,
          color: close >= open ? CHART_UP_COLOR : CHART_DOWN_COLOR,
        })) as CandlestickData<Time>[];

        candlestickSeries.setData(candleData);
        volumeSeries.setData(volumeData);
        candleHistoryRef.current = formattedData;
        latestCandleRef.current = formattedData.at(-1) ?? null;
        onCandleHistoryChange?.();
        syncIndicatorSeries(formattedData);
        formattedData.forEach((candle) => {
          volumeByTimeRef.current.set(String(candle.time), candle.volume);
        });
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
        if (isCancelled) return;
        logger.error(`Failed to fetch historical data for symbol: ${symbol}, interval: ${interval}`, error);
      }
    };

    fetchHistory();

    const handleCandleUpdate = (data: KlineUpdate) => {
      if (data.symbol?.toUpperCase() !== symbol.toUpperCase() || data.interval !== interval) {
        return;
      }

      const formatted = formatCandle(data);
      
      if (formatted && formatted.open > 0 && formatted.high > 0 && formatted.low > 0 && formatted.close > 0) {
        const lastCandle = candleHistoryRef.current.at(-1);

        if (lastCandle && formatted.time < lastCandle.time) {
          logger.debug(`Ignored stale candle update for ${data.symbol} [${data.interval}]`, {
            updateTime: formatted.time,
            lastTime: lastCandle.time,
          });
          return;
        }

        candleHistoryRef.current = lastCandle?.time === formatted.time
          ? [...candleHistoryRef.current.slice(0, -1), formatted]
          : [...candleHistoryRef.current, formatted];
        latestCandleRef.current = formatted;
        onCandleHistoryChange?.();

        volumeByTimeRef.current.set(String(formatted.time), formatted.volume);
        candlestickSeries.update({
          time: formatted.time as Time,
          open: formatted.open,
          high: formatted.high,
          low: formatted.low,
          close: formatted.close,
        });
        volumeSeries.update({
          time: formatted.time as Time,
          open: 0,
          high: formatted.volume,
          low: 0,
          close: formatted.volume,
          color: formatted.close >= formatted.open ? CHART_UP_COLOR : CHART_DOWN_COLOR,
        });

        syncIndicatorSeries(candleHistoryRef.current);
        
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
      isCancelled = true;
      unsubscribe();
      // Leave room when component unmounts or dependencies change
      leaveKlineRoom(symbol, interval);
      logger.info(`Left kline room: ${symbol}_${interval}`);
    };
  }, [
    chartRef,
    candlestickSeriesRef,
    volumeSeriesRef,
    symbol,
    interval,
    volumeByTimeRef,
    latestCandleRef,
    candleHistoryRef,
    indicatorSeriesRef,
    syncIndicatorSeries,
    onCandleHistoryChange,
    isChartReady,
  ]);
};
