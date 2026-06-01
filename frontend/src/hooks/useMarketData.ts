import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { formatCandle } from '../utils/formatters';
import type { FormattedCandle } from '../utils/formatters';
import { calculateEMAHistory, calculateMACDHistory, calculateMAHistory, calculateRSIHistory, calculateVolumeMAHistory } from '../utils/indicators';
import { subscribeToCandles, joinKlineRoom, leaveKlineRoom } from '../services/socket';
import type { KlineUpdate } from '../services/socket';
import { getHistoricalCandles } from '../services/api';
import { Logger } from '../utils/logger';
import type { ISeriesApi, IChartApi, CandlestickData, LineData, Time } from 'lightweight-charts';
import type { IndicatorSeriesConfig, IndicatorSetting, IndicatorValue } from '../types/chart';
import { CHART_DOWN_COLOR, CHART_UP_COLOR } from '../components/chart/chartConstants';

const logger = new Logger('MarketData');

export const useMarketData = (
  chartRef: RefObject<IChartApi | null>,
  candlestickSeriesRef: RefObject<ISeriesApi<"Candlestick"> | null>, 
  volumeSeriesRef: RefObject<ISeriesApi<"Candlestick"> | null>,
  symbol: string = 'BTCUSDT',
  interval: string = '1m',
  volumeByTimeRef?: RefObject<Map<string, number>>,
  indicatorSeriesRef?: RefObject<IndicatorSeriesConfig[]>,
  indicatorSettings: IndicatorSetting[] = [],
  onIndicatorValuesChange?: (values: IndicatorValue[]) => void,
  isChartReady: boolean = true
) => {
  const candleHistoryRef = useRef<FormattedCandle[]>([]);

  const syncIndicatorSeries = useCallback((history: FormattedCandle[]) => {
    indicatorSeriesRef?.current.forEach((config) => {
      const indicatorData = getIndicatorData(config, history) as LineData<Time>[];
      config.series.setData(indicatorData);
    });

    const nextValues = getIndicatorValues(indicatorSettings, history);

    onIndicatorValuesChange?.(nextValues);
  }, [indicatorSeriesRef, indicatorSettings, onIndicatorValuesChange]);

  useEffect(() => {
    if (!isChartReady || candleHistoryRef.current.length === 0) return;
    syncIndicatorSeries(candleHistoryRef.current);
  }, [indicatorSettings, isChartReady, syncIndicatorSeries]);

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
        onIndicatorValuesChange?.([]);
        volumeByTimeRef?.current.clear();
        
        const rawCandles = await getHistoricalCandles(symbol, interval, 1000);

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
        syncIndicatorSeries(formattedData);
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
    indicatorSeriesRef,
    onIndicatorValuesChange,
    syncIndicatorSeries,
    isChartReady,
  ]);
};

function getIndicatorData(config: IndicatorSeriesConfig, history: FormattedCandle[]): LineData<Time>[] {
  if (history.length === 0) return [];
  if (config.period !== undefined && config.period <= 0) return [];

  switch (config.kind) {
    case 'ema':
      return calculateEMAHistory(history, config.period ?? 1) as LineData<Time>[];
    case 'ma':
      return calculateMAHistory(history, config.period ?? 1) as LineData<Time>[];
    case 'volume-ma':
      return calculateVolumeMAHistory(history, config.period ?? 1) as LineData<Time>[];
    case 'rsi':
      return calculateRSIHistory(history, config.period ?? 14) as LineData<Time>[];
    case 'macd': {
      const macd = calculateMACDHistory(
        history,
        config.fastPeriod ?? 12,
        config.slowPeriod ?? 26,
        config.signalPeriod ?? 9,
      );
      return macd.macd as LineData<Time>[];
    }
    case 'macd-signal': {
      const macd = calculateMACDHistory(
        history,
        config.fastPeriod ?? 12,
        config.slowPeriod ?? 26,
        config.signalPeriod ?? 9,
      );
      return macd.signal as LineData<Time>[];
    }
    default:
      return [];
  }
}

function getIndicatorValues(settings: IndicatorSetting[], history: FormattedCandle[]): IndicatorValue[] {
  if (history.length === 0) return [];

  return settings.reduce<IndicatorValue[]>((values, setting) => {
    if (!setting.visible) return values;

    if (setting.group === 'macd') {
      const macd = calculateMACDHistory(
        history,
        setting.fastPeriod,
        setting.slowPeriod,
        setting.signalPeriod,
      );
      const macdPoint = macd.macd.at(-1);
      const signalPoint = macd.signal.at(-1);

      if (macdPoint) {
        values.push({
          id: `${setting.id}-macd`,
          group: setting.group,
          kind: 'macd',
          label: setting.label,
          value: macdPoint.value,
          color: setting.macdColor,
        });
      }

      if (signalPoint) {
        values.push({
          id: `${setting.id}-signal`,
          group: setting.group,
          kind: 'macd-signal',
          label: `${setting.label} Signal`,
          value: signalPoint.value,
          color: setting.signalColor,
        });
      }

      return values;
    }

    const config: Omit<IndicatorSeriesConfig, 'series'> = {
      id: setting.id,
      group: setting.group,
      kind: setting.group,
      label: setting.label,
      period: setting.period,
      color: setting.color,
    };
    const indicatorData = getIndicatorData(config as IndicatorSeriesConfig, history);
    const lastPoint = indicatorData.at(-1);

    if (lastPoint) {
      values.push({
        id: setting.id,
        group: setting.group,
        kind: setting.group,
        label: setting.label,
        period: setting.period,
        value: lastPoint.value,
        color: setting.color,
      });
    }

    return values;
  }, []);
}
