import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { formatValidCandle, formatValidCandles } from '../utils/formatters';
import type { FormattedCandle } from '../utils/formatters';
import { getIndicatorData, getIndicatorValues } from '../utils/chartIndicators';
import { subscribeToCandles, joinKlineRoom, leaveKlineRoom } from '../services/socket';
import type { KlineUpdate } from '../services/socket';
import { getHistoricalCandles } from '../services/api';
import { createLogger } from '../utils/logger';
import type { ISeriesApi, IChartApi, CandlestickData, Time } from 'lightweight-charts';
import type { IndicatorSeriesConfig, IndicatorSetting, IndicatorValue } from '../types/chart';
import { CHART_DOWN_COLOR, CHART_UP_COLOR } from '../components/chart/chartConstants';

const logger = createLogger('MarketData');

type RealtimeMergeResult = {
  history: FormattedCandle[];
  requiresFullSeriesSync: boolean;
};

const RECENT_HISTORY_RETRY_DELAYS_MS = [1_000, 2_500, 5_000, 10_000];

const INTERVAL_SECONDS: Record<string, number> = {
  '1m': 60,
  '3m': 3 * 60,
  '5m': 5 * 60,
  '15m': 15 * 60,
  '30m': 30 * 60,
  '1h': 60 * 60,
  '2h': 2 * 60 * 60,
  '4h': 4 * 60 * 60,
  '6h': 6 * 60 * 60,
  '8h': 8 * 60 * 60,
  '12h': 12 * 60 * 60,
  '1d': 24 * 60 * 60,
  '3d': 3 * 24 * 60 * 60,
  '1w': 7 * 24 * 60 * 60,
  '1M': 30 * 24 * 60 * 60,
};

const toCandleSeriesData = (candles: FormattedCandle[]) => (
  candles.map(({ time, open, high, low, close }) => ({
    time,
    open,
    high,
    low,
    close,
  })) as CandlestickData<Time>[]
);

const toVolumeSeriesData = (candles: FormattedCandle[]) => (
  candles.map(({ time, open, close, volume }) => ({
    time,
    open: 0,
    high: volume,
    low: 0,
    close: volume,
    color: close >= open ? CHART_UP_COLOR : CHART_DOWN_COLOR,
  })) as CandlestickData<Time>[]
);

const resetSeriesData = (
  candlestickSeries: ISeriesApi<"Candlestick">,
  volumeSeries: ISeriesApi<"Candlestick">,
  indicatorSeriesRef?: RefObject<IndicatorSeriesConfig[]>,
) => {
  candlestickSeries.setData([]);
  volumeSeries.setData([]);
  indicatorSeriesRef?.current.forEach(({ series }) => series.setData([]));
};

const replaceVolumeCache = (
  volumeByTime: Map<string, number>,
  history: FormattedCandle[],
) => {
  volumeByTime.clear();
  history.forEach((candle) => {
    volumeByTime.set(String(candle.time), candle.volume);
  });
};

const findCandleInsertIndex = (history: FormattedCandle[], time: number) => {
  let low = 0;
  let high = history.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);

    if (history[middle].time < time) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
};

const mergeRealtimeCandle = (
  history: FormattedCandle[],
  candle: FormattedCandle,
): RealtimeMergeResult => {
  const insertIndex = findCandleInsertIndex(history, candle.time);
  const existingCandle = history[insertIndex];

  if (existingCandle?.time === candle.time) {
    return {
      history: [
        ...history.slice(0, insertIndex),
        candle,
        ...history.slice(insertIndex + 1),
      ],
      requiresFullSeriesSync: insertIndex !== history.length - 1,
    };
  }

  return {
    history: [
      ...history.slice(0, insertIndex),
      candle,
      ...history.slice(insertIndex),
    ],
    requiresFullSeriesSync: insertIndex !== history.length,
  };
};

const mergeCandleHistories = (
  currentHistory: FormattedCandle[],
  incomingHistory: FormattedCandle[],
) => {
  const candlesByTime = new Map<number, FormattedCandle>();

  currentHistory.forEach((candle) => {
    candlesByTime.set(candle.time, candle);
  });
  incomingHistory.forEach((candle) => {
    candlesByTime.set(candle.time, candle);
  });

  return [...candlesByTime.values()].sort((left, right) => left.time - right.time);
};

const hasTailHistoryGap = (history: FormattedCandle[], interval: string) => {
  const stepSeconds = INTERVAL_SECONDS[interval];

  if (!stepSeconds || history.length < 2) return false;

  const startIndex = Math.max(1, history.length - 12);

  for (let index = startIndex; index < history.length; index += 1) {
    if (history[index].time - history[index - 1].time > stepSeconds) {
      return true;
    }
  }

  return false;
};

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
  indicatorSyncSettings: IndicatorSetting[] = indicatorSettings,
  onIndicatorValuesChange?: (values: IndicatorValue[]) => void,
  onCandleHistoryChange?: () => void,
  isChartReady: boolean = true,
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
  }, [indicatorSyncSettings, isChartReady, candleHistoryRef, syncIndicatorSeries]);

  useEffect(() => {
    const chart = chartRef.current;
    const candlestickSeries = candlestickSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;

    if (!isChartReady) return;
    if (!candlestickSeries || !volumeSeries || !chart) return;

    let isCancelled = false;
    let historyRepairAttempt = 0;
    let historyRepairInFlight = false;
    let scheduledHistoryRepair: ReturnType<typeof setTimeout> | null = null;

    const syncFullSeries = (history: FormattedCandle[], preserveVisibleRange = true) => {
      const visibleRange = preserveVisibleRange ? chart.timeScale().getVisibleLogicalRange() : null;

      candlestickSeries.setData(toCandleSeriesData(history));
      volumeSeries.setData(toVolumeSeriesData(history));

      if (visibleRange) {
        chart.timeScale().setVisibleLogicalRange(visibleRange);
      }
    };

    const syncRefsAndIndicators = (history: FormattedCandle[]) => {
      candleHistoryRef.current = history;
      latestCandleRef.current = history.at(-1) ?? null;
      replaceVolumeCache(volumeByTimeRef.current, history);
      onCandleHistoryChange?.();
      syncIndicatorSeries(history);
    };

    const fetchAndMergeRecentHistory = async (reason: string) => {
      if (historyRepairInFlight || isCancelled) return;

      historyRepairInFlight = true;

      try {
        const rawCandles = await getHistoricalCandles(symbol, interval, 2000);

        if (isCancelled) return;

        const formattedData = formatValidCandles(rawCandles);

        if (formattedData.length === 0) {
          return;
        }

        const mergedHistory = mergeCandleHistories(candleHistoryRef.current, formattedData);
        syncRefsAndIndicators(mergedHistory);
        syncFullSeries(mergedHistory);

        if (hasTailHistoryGap(mergedHistory, interval)) {
          logger.debug(`Recent history repair still sees a tail gap for ${symbol} [${interval}]`, {
            reason,
            attempt: historyRepairAttempt,
          });
        } else {
          historyRepairAttempt = 0;
          logger.info(`Recent history repaired for ${symbol} [${interval}]`, { reason });
        }
      } catch (error) {
        if (!isCancelled) {
          logger.warn(`Recent history repair failed for ${symbol} [${interval}]`, error);
        }
      } finally {
        historyRepairInFlight = false;

        if (
          !isCancelled &&
          hasTailHistoryGap(candleHistoryRef.current, interval) &&
          historyRepairAttempt < RECENT_HISTORY_RETRY_DELAYS_MS.length
        ) {
          scheduleRecentHistoryRepair(reason);
        }
      }
    };

    const scheduleRecentHistoryRepair = (reason: string) => {
      if (
        scheduledHistoryRepair ||
        historyRepairInFlight ||
        historyRepairAttempt >= RECENT_HISTORY_RETRY_DELAYS_MS.length
      ) {
        return;
      }

      const delay = RECENT_HISTORY_RETRY_DELAYS_MS[historyRepairAttempt];
      historyRepairAttempt += 1;

      scheduledHistoryRepair = setTimeout(() => {
        scheduledHistoryRepair = null;
        void fetchAndMergeRecentHistory(reason);
      }, delay);

      logger.debug(`Scheduled recent history repair for ${symbol} [${interval}]`, {
        reason,
        attempt: historyRepairAttempt,
        delay,
      });
    };

    const fetchHistory = async () => {
      try {
        resetSeriesData(candlestickSeries, volumeSeries, indicatorSeriesRef);
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

        const formattedData = formatValidCandles(rawCandles);
        
        if (formattedData.length === 0) {
          logger.warn(`No valid candle data after formatting for symbol: ${symbol}, interval: ${interval}`);
          return;
        }

        syncFullSeries(formattedData, false);
        syncRefsAndIndicators(formattedData);
        logger.info(`Successfully loaded ${formattedData.length} candles for symbol: ${symbol} [${interval}]`);

        const totalCandles = formattedData.length;
        const OFFSET_RIGHT = 10;
        const VISIBLE_CANDLES = 30;
        const currentBarSpacing = chart.timeScale().options().barSpacing;

        chart.timeScale().setVisibleLogicalRange({
          from: Math.max(0, totalCandles + OFFSET_RIGHT - VISIBLE_CANDLES),
          to: totalCandles + OFFSET_RIGHT,
        });

        chart.timeScale().applyOptions({
          barSpacing: currentBarSpacing,
        });
        
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

      const formatted = formatValidCandle(data);
      
      if (formatted) {
        const mergeResult = mergeRealtimeCandle(candleHistoryRef.current, formatted);
        candleHistoryRef.current = mergeResult.history;
        latestCandleRef.current = mergeResult.history.at(-1) ?? null;
        onCandleHistoryChange?.();

        volumeByTimeRef.current.set(String(formatted.time), formatted.volume);

        if (mergeResult.requiresFullSeriesSync) {
          syncFullSeries(candleHistoryRef.current);

          logger.debug(`Applied out-of-order candle update for ${data.symbol} [${data.interval}]`, {
            updateTime: formatted.time,
            latestTime: candleHistoryRef.current.at(-1)?.time,
          });
        } else {
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
        }

        syncIndicatorSeries(candleHistoryRef.current);

        if (hasTailHistoryGap(candleHistoryRef.current, interval)) {
          scheduleRecentHistoryRepair('tail gap after realtime update');
        }
        
        if (data.is_final) {
          logger.info(`Final candle received for ${data.symbol} [${data.interval}]: O=${data.open}, C=${data.close}, V=${data.volume}`);
        }
      } else {
        logger.warn(`Invalid candle filtered out from socket:`, data);
      }
    };

    const unsubscribe = subscribeToCandles(handleCandleUpdate);

    return () => {
      isCancelled = true;
      if (scheduledHistoryRepair) {
        clearTimeout(scheduledHistoryRepair);
      }
      unsubscribe();
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
