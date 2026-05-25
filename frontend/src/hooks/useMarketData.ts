import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { formatCandle } from '../utils/formatters';
import type { FormattedCandle } from '../utils/formatters';
import { calculateEMAHistory, calculateMAHistory, calculateNextEMA, calculateNextMA } from '../utils/indicators';
import { subscribeToCandles, joinKlineRoom, leaveKlineRoom } from '../services/socket';
import type { KlineUpdate } from '../services/socket';
import { getHistoricalCandles } from '../services/api';
import { Logger } from '../utils/logger';
import type { ISeriesApi, IChartApi, CandlestickData, HistogramData, LineData, Time } from 'lightweight-charts';

const logger = new Logger('MarketData');

export type IndicatorKind = 'ema' | 'ma';

export interface IndicatorSeriesConfig {
  kind: IndicatorKind;
  period: number;
  series: ISeriesApi<"Line">;
}

export interface IndicatorValue {
  kind: IndicatorKind;
  period: number;
  value: number;
}

interface EmaRuntimeState {
  lastTime: Time;
  lastValue: number;
  previousValue: number | null;
}

export const useMarketData = (
  chartRef: RefObject<IChartApi | null>,
  candlestickSeriesRef: RefObject<ISeriesApi<"Candlestick"> | null>, 
  volumeSeriesRef: RefObject<ISeriesApi<"Histogram"> | null>,
  symbol: string = 'BTCUSDT',
  interval: string = '1m',
  volumeByTimeRef?: RefObject<Map<string, number>>,
  indicatorSeriesRef?: RefObject<IndicatorSeriesConfig[]>,
  onIndicatorValuesChange?: (values: IndicatorValue[]) => void,
  isChartReady: boolean = true
) => {
  const emaStateByPeriodRef = useRef<Map<number, EmaRuntimeState>>(new Map());
  const candleHistoryRef = useRef<FormattedCandle[]>([]);

  useEffect(() => {
    const chart = chartRef.current;
    const candlestickSeries = candlestickSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;

    if (!isChartReady) return;
    if (!candlestickSeries || !volumeSeries || !chart) return;

    const fetchHistory = async () => {
      try {
        candlestickSeries.setData([]); 
        volumeSeries.setData([]);
        indicatorSeriesRef?.current.forEach(({ series: indicatorSeries }) => indicatorSeries.setData([]));
        emaStateByPeriodRef.current.clear();
        candleHistoryRef.current = [];
        onIndicatorValuesChange?.([]);
        volumeByTimeRef?.current.clear();
        
        const rawCandles = await getHistoricalCandles(symbol, interval, 1000);

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
          value: volume,
          color: close >= open ? '#26a69a80' : '#ef535080',
        })) as HistogramData<Time>[];

        candlestickSeries.setData(candleData);
        volumeSeries.setData(volumeData);
        candleHistoryRef.current = formattedData;
        const indicatorValues = indicatorSeriesRef?.current.map(({ kind, period, series: indicatorSeries }) => {
          const indicatorData = kind === 'ema'
            ? calculateEMAHistory(formattedData, period) as LineData<Time>[]
            : calculateMAHistory(formattedData, period) as LineData<Time>[];
          indicatorSeries.setData(indicatorData);

          const lastPoint = indicatorData.at(-1);
          const previousPoint = indicatorData.length > 1 ? indicatorData[indicatorData.length - 2] : null;

          if (kind === 'ema' && lastPoint) {
            emaStateByPeriodRef.current.set(period, {
              lastTime: lastPoint.time,
              lastValue: lastPoint.value,
              previousValue: previousPoint?.value ?? null,
            });
          }

          return {
            kind,
            period,
            value: lastPoint?.value ?? 0,
          };
        }) ?? [];
        onIndicatorValuesChange?.(indicatorValues);
        formattedData.forEach((candle) => {
          volumeByTimeRef?.current.set(String(candle.time), candle.volume);
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
        logger.error(`Failed to fetch historical data for symbol: ${symbol}, interval: ${interval}`, error);
      }
    };

    fetchHistory();

    const handleCandleUpdate = (data: KlineUpdate) => {
      const formatted = formatCandle(data);
      
      if (formatted && formatted.open > 0 && formatted.high > 0 && formatted.low > 0 && formatted.close > 0) {
        const lastCandle = candleHistoryRef.current.at(-1);
        candleHistoryRef.current = lastCandle?.time === formatted.time
          ? [...candleHistoryRef.current.slice(0, -1), formatted]
          : [...candleHistoryRef.current, formatted];

        volumeByTimeRef?.current.set(String(formatted.time), formatted.volume);
        candlestickSeries.update({
          time: formatted.time as Time,
          open: formatted.open,
          high: formatted.high,
          low: formatted.low,
          close: formatted.close,
        });
        volumeSeries.update({
          time: formatted.time as Time,
          value: formatted.volume,
          color: formatted.close >= formatted.open ? '#26a69a80' : '#ef535080',
        });

        const indicatorValues = indicatorSeriesRef?.current.reduce<IndicatorValue[]>((values, { kind, period, series: indicatorSeries }) => {
          const time = formatted.time as Time;
          const emaState = kind === 'ema' ? emaStateByPeriodRef.current.get(period) : undefined;
          const previousEma = emaState?.lastTime === time
            ? emaState.previousValue ?? emaState.lastValue
            : emaState?.lastValue ?? formatted.close;
          const nextValue = kind === 'ema'
            ? calculateNextEMA(formatted.close, previousEma, period)
            : calculateNextMA(candleHistoryRef.current, period);

          if (nextValue === null) {
            return values;
          }

          indicatorSeries.update({
            time,
            value: nextValue,
          });

          if (kind === 'ema') {
            emaStateByPeriodRef.current.set(period, {
              lastTime: time,
              lastValue: nextValue,
              previousValue: emaState?.lastTime === time ? emaState.previousValue : emaState?.lastValue ?? null,
            });
          }

          values.push({
            kind,
            period,
            value: nextValue,
          });

          return values;
        }, []) ?? [];
        onIndicatorValuesChange?.(indicatorValues);
        
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
  }, [
    chartRef,
    candlestickSeriesRef,
    volumeSeriesRef,
    symbol,
    interval,
    volumeByTimeRef,
    indicatorSeriesRef,
    onIndicatorValuesChange,
    isChartReady,
  ]);
};
