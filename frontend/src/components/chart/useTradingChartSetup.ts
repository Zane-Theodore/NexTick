import { useEffect, useRef } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { createChart, CandlestickSeries, ColorType, LineSeries } from 'lightweight-charts';
import type { AutoscaleInfoProvider, CandlestickData, IChartApi, ISeriesApi, LineData, LogicalRange, MouseEventParams, Time } from 'lightweight-charts';

import type { ChartPaneLayout, IndicatorSeriesConfig, IndicatorSetting, IndicatorValue, LegendData, VisiblePriceExtrema } from '../../types/chart';
import type { FormattedCandle } from '../../utils/formatters';
import {
  formatChartValue,
  formatTimeScaleCrosshair,
  formatTimeScaleTick,
} from '../../utils/formatters';
import {
  CHART_DEFAULT_BAR_SPACING,
  CHART_DOWN_COLOR,
  CHART_MAX_BAR_SPACING,
  CHART_MIN_BAR_SPACING,
  CHART_UP_COLOR,
  MAIN_CHART_DEFAULT_STRETCH_FACTOR,
  VOLUME_CHART_DEFAULT_STRETCH_FACTOR,
} from './chartConstants';

interface UseTradingChartSetupParams {
  chartContainerRef: RefObject<HTMLDivElement | null>;
  chartInstanceRef: RefObject<IChartApi | null>;
  candlestickSeriesRef: RefObject<ISeriesApi<"Candlestick"> | null>;
  volumeSeriesRef: RefObject<ISeriesApi<"Candlestick"> | null>;
  indicatorSeriesRef: RefObject<IndicatorSeriesConfig[]>;
  volumeByTimeRef: RefObject<Map<string, number>>;
  latestCandleRef: RefObject<FormattedCandle | null>;
  candleHistoryRef: RefObject<FormattedCandle[]>;
  indicatorSettings: IndicatorSetting[];
  marketDataVersion: number;
  setIsChartReady: Dispatch<SetStateAction<boolean>>;
  setLegendData: Dispatch<SetStateAction<LegendData | null>>;
  setHoverIndicatorValues: Dispatch<SetStateAction<IndicatorValue[] | null>>;
  setPaneLayouts: Dispatch<SetStateAction<ChartPaneLayout[]>>;
  setVisiblePriceExtrema: Dispatch<SetStateAction<VisiblePriceExtrema | null>>;
}

export function useTradingChartSetup({
  chartContainerRef,
  chartInstanceRef,
  candlestickSeriesRef,
  volumeSeriesRef,
  indicatorSeriesRef,
  volumeByTimeRef,
  latestCandleRef,
  candleHistoryRef,
  indicatorSettings,
  marketDataVersion,
  setIsChartReady,
  setLegendData,
  setHoverIndicatorValues,
  setPaneLayouts,
  setVisiblePriceExtrema,
}: UseTradingChartSetupParams) {
  const lastViewedLegendDataRef = useRef<LegendData | null>(null);
  const isPointerInsideChartRef = useRef(false);
  const isLegendLockedToHoveredCandleRef = useRef(false);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: '#0b0f16' },
        textColor: '#d1d4dc',
        attributionLogo: false,
        panes: {
          separatorColor: '#3f4654',
          separatorHoverColor: 'transparent',
          enableResize: true,
        },
      },
      crosshair: {
        mode: 0,
        vertLine: {
          width: 1,
          color: '#f1f5f9',
          style: 3,
          labelBackgroundColor: '#3f4654',
        },
        horzLine: {
          width: 1,
          color: '#f1f5f9',
          style: 3,
          labelBackgroundColor: '#3f4654',
        },
      },
      handleScale: {
        axisPressedMouseMove: {
          time: true,
          price: false,
        },
      },
      rightPriceScale: {
        autoScale: true,
        alignLabels: true,
        borderVisible: true,
        borderColor: '#6b7280',
        scaleMargins: {
          top: 0.1,
          bottom: 0.14,
        },
      },
      grid: {
        vertLines: { color: '#202632' },
        horzLines: { color: '#202632' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 10,
        barSpacing: CHART_DEFAULT_BAR_SPACING,
        minBarSpacing: CHART_MIN_BAR_SPACING,
        maxBarSpacing: CHART_MAX_BAR_SPACING,
        tickMarkFormatter: formatTimeScaleTick,
        borderColor: '#6b7280',
      },
      localization: {
        priceFormatter: formatChartValue,
        timeFormatter: formatTimeScaleCrosshair,
      },
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: CHART_UP_COLOR,
      downColor: CHART_DOWN_COLOR,
      borderVisible: false,
      wickUpColor: CHART_UP_COLOR,
      wickDownColor: CHART_DOWN_COLOR,
      priceLineVisible: false,
      lastValueVisible: true,
    });

    const volumeSeries = chart.addSeries(CandlestickSeries, {
      upColor: CHART_UP_COLOR,
      downColor: CHART_DOWN_COLOR,
      borderVisible: false,
      wickVisible: false,
      priceScaleId: 'right',
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: {
        type: 'volume',
      },
      autoscaleInfoProvider: ((original) => {
        const autoscaleInfo = original();

        if (!autoscaleInfo?.priceRange) return autoscaleInfo;

        return {
          ...autoscaleInfo,
          priceRange: {
            minValue: 0,
            maxValue: Math.max(autoscaleInfo.priceRange.maxValue, 1),
          },
          margins: {
            above: 0.14,
            below: 0,
          },
        };
      }) satisfies AutoscaleInfoProvider,
    }, 1);

    chart.priceScale('right', 1).applyOptions({
      autoScale: true,
      alignLabels: true,
      borderVisible: true,
      borderColor: '#6b7280',
      scaleMargins: {
        top: 0.14,
        bottom: 0,
      },
    });

    const panes = chart.panes();
    panes[0]?.setStretchFactor(MAIN_CHART_DEFAULT_STRETCH_FACTOR);
    panes[1]?.setStretchFactor(VOLUME_CHART_DEFAULT_STRETCH_FACTOR);
    let paneLayoutFrameId: number | null = null;
    let isDisposed = false;
    const updatePaneLayouts = () => {
      if (isDisposed) return;
      setPaneLayouts(getPaneLayouts(chart));
      paneLayoutFrameId = null;
    };
    const updateVisiblePriceExtrema = () => {
      if (isDisposed || !chartContainerRef.current) return;
      setVisiblePriceExtrema(getVisiblePriceExtrema({
        chart,
        candlestickSeries,
        history: candleHistoryRef.current,
        width: chartContainerRef.current.clientWidth,
        height: chartContainerRef.current.clientHeight,
      }));
    };
    const schedulePaneLayoutUpdate = () => {
      if (isDisposed) return;
      if (paneLayoutFrameId !== null) {
        cancelAnimationFrame(paneLayoutFrameId);
      }
      paneLayoutFrameId = requestAnimationFrame(() => {
        updatePaneLayouts();
        updateVisiblePriceExtrema();
      });
    };
    schedulePaneLayoutUpdate();

    chartInstanceRef.current = chart;
    candlestickSeriesRef.current = candlestickSeries;
    volumeSeriesRef.current = volumeSeries;
    indicatorSeriesRef.current = [];
    setIsChartReady(true);

    const handleCrosshair = (param: MouseEventParams<Time>) => {
      if (!param.point || param.point.x < 0 || param.point.y < 0) {
        isPointerInsideChartRef.current = false;
        isLegendLockedToHoveredCandleRef.current = false;
        setHoverIndicatorValues(null);
        const latestLegendData = latestCandleRef.current
          ? getLegendDataFromCandle(latestCandleRef.current)
          : null;
        lastViewedLegendDataRef.current = latestLegendData;
        setLegendData(latestLegendData);
        return;
      }

      isPointerInsideChartRef.current = true;
      const candleData = param.time
        ? param.seriesData.get(candlestickSeries) as (CandlestickData<Time> & { volume?: number }) | undefined
        : undefined;

      const hoveredIndicators = indicatorSeriesRef.current.reduce<IndicatorValue[]>((values, { id, group, kind, label, period, color, series }) => {
        const lineData = param.seriesData.get(series) as LineData<Time> | undefined;

        if (lineData) {
          values.push({
            id,
            group,
            kind,
            label,
            period,
            value: lineData.value,
            color,
          });
        }

        return values;
      }, []);

      if (candleData && candleData.open !== undefined) {
        const volume = volumeByTimeRef.current.get(String(candleData.time)) ?? Number(candleData.volume ?? 0);
        const legendData = getLegendDataFromSeries(candleData, volume);

        lastViewedLegendDataRef.current = legendData;
        isLegendLockedToHoveredCandleRef.current = true;
        setLegendData(legendData);
      } else if (latestCandleRef.current) {
        const legendData = getLegendDataFromCandle(latestCandleRef.current);

        lastViewedLegendDataRef.current = legendData;
        isLegendLockedToHoveredCandleRef.current = false;
        setLegendData(legendData);
      }

      setHoverIndicatorValues(hoveredIndicators.length > 0 ? hoveredIndicators : null);
    };
    chart.subscribeCrosshairMove(handleCrosshair);

    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 0 || entries[0].target !== chartContainerRef.current) return;
      chart.applyOptions({
        width: entries[0].contentRect.width,
        height: entries[0].contentRect.height,
      });
      schedulePaneLayoutUpdate();
    });
    resizeObserver.observe(chartContainerRef.current);

    const handleVisibleLogicalRangeChange = () => updateVisiblePriceExtrema();
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleLogicalRangeChange);

    const handlePaneResizeEnd = schedulePaneLayoutUpdate;
    window.addEventListener('mouseup', handlePaneResizeEnd);
    window.addEventListener('pointerup', handlePaneResizeEnd);

    return () => {
      isDisposed = true;
      if (paneLayoutFrameId !== null) {
        cancelAnimationFrame(paneLayoutFrameId);
      }
      chart.unsubscribeCrosshairMove(handleCrosshair);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleLogicalRangeChange);
      resizeObserver.disconnect();
      window.removeEventListener('mouseup', handlePaneResizeEnd);
      window.removeEventListener('pointerup', handlePaneResizeEnd);
      setIsChartReady(false);
      setPaneLayouts([]);
      setVisiblePriceExtrema(null);
      chartInstanceRef.current = null;
      candlestickSeriesRef.current = null;
      volumeSeriesRef.current = null;
      indicatorSeriesRef.current = [];
      chart.remove();
    };
  }, [
    candlestickSeriesRef,
    chartContainerRef,
    chartInstanceRef,
    candleHistoryRef,
    indicatorSeriesRef,
    latestCandleRef,
    setHoverIndicatorValues,
    setIsChartReady,
    setLegendData,
    setPaneLayouts,
    setVisiblePriceExtrema,
    volumeByTimeRef,
    volumeSeriesRef,
  ]);

  useEffect(() => {
    const latestCandle = latestCandleRef.current;

    if (!latestCandle) {
      lastViewedLegendDataRef.current = null;
      isLegendLockedToHoveredCandleRef.current = false;
      setLegendData(null);
      return;
    }

    const isViewingOlderHoveredCandle = (
      isPointerInsideChartRef.current
      && isLegendLockedToHoveredCandleRef.current
      && !isSameLegendTime(lastViewedLegendDataRef.current, latestCandle)
    );

    if (isViewingOlderHoveredCandle) {
      return;
    }

    const legendData = getLegendDataFromCandle(latestCandle);
    lastViewedLegendDataRef.current = legendData;
    setLegendData(legendData);
  }, [latestCandleRef, marketDataVersion, setLegendData]);

  useEffect(() => {
    const chart = chartInstanceRef.current;
    const candlestickSeries = candlestickSeriesRef.current;
    const chartContainer = chartContainerRef.current;

    if (!chart || !candlestickSeries || !chartContainer) {
      setVisiblePriceExtrema(null);
      return;
    }

    setVisiblePriceExtrema(getVisiblePriceExtrema({
      chart,
      candlestickSeries,
      history: candleHistoryRef.current,
      width: chartContainer.clientWidth,
      height: chartContainer.clientHeight,
    }));
  }, [
    candlestickSeriesRef,
    candleHistoryRef,
    chartContainerRef,
    chartInstanceRef,
    marketDataVersion,
    setVisiblePriceExtrema,
  ]);

  useEffect(() => {
    const chart = chartInstanceRef.current;
    if (!chart) return;

    let currentConfigs = [...indicatorSeriesRef.current];
    const desiredIds = new Set<string>();
    const lowerPaneByGroup = new Map<IndicatorSetting['group'], number>();
    let nextLowerPaneIndex = 2;

    if (indicatorSettings.some((setting) => setting.visible && setting.group === 'rsi')) {
      lowerPaneByGroup.set('rsi', nextLowerPaneIndex);
      nextLowerPaneIndex += 1;
    }

    if (indicatorSettings.some((setting) => setting.visible && setting.group === 'macd')) {
      lowerPaneByGroup.set('macd', nextLowerPaneIndex);
    }

    const upsertSeries = (config: Omit<IndicatorSeriesConfig, 'series' | 'paneIndex'>, paneIndex: number) => {
      desiredIds.add(config.id);

      const existingConfig = currentConfigs.find((currentConfig) => currentConfig.id === config.id);
      if (existingConfig) {
        if (existingConfig.paneIndex !== paneIndex) {
          existingConfig.series.moveToPane(paneIndex);
        }
        Object.assign(existingConfig, config, { paneIndex });
        existingConfig.series.applyOptions({
          color: config.color,
          lineWidth: config.lineWidth,
          visible: true,
        });
        return;
      }

      currentConfigs.push({
        ...config,
        paneIndex,
        series: chart.addSeries(LineSeries, createLineOptions(config.color, config.lineWidth), paneIndex),
      });
    };

    indicatorSettings.forEach((setting) => {
      if (!setting.visible) return;

      if (setting.group === 'macd') {
        upsertSeries({
          id: `${setting.id}-macd`,
          group: setting.group,
          kind: 'macd',
          label: setting.label,
          fastPeriod: setting.fastPeriod,
          slowPeriod: setting.slowPeriod,
          signalPeriod: setting.signalPeriod,
          source: setting.source,
          lineWidth: setting.lineWidth,
          color: setting.macdColor,
        }, lowerPaneByGroup.get('macd') ?? 2);
        upsertSeries({
          id: `${setting.id}-signal`,
          group: setting.group,
          kind: 'macd-signal',
          label: `${setting.label} Signal`,
          fastPeriod: setting.fastPeriod,
          slowPeriod: setting.slowPeriod,
          signalPeriod: setting.signalPeriod,
          source: setting.source,
          lineWidth: setting.lineWidth,
          color: setting.signalColor,
        }, lowerPaneByGroup.get('macd') ?? 2);
        return;
      }

      const paneIndex = setting.group === 'volume-ma'
        ? 1
        : setting.group === 'rsi'
          ? lowerPaneByGroup.get('rsi') ?? 2
          : 0;

      upsertSeries({
        id: setting.id,
        group: setting.group,
        kind: setting.group,
        label: setting.label,
        period: setting.period,
        source: setting.source,
        lineWidth: setting.lineWidth,
        color: setting.color,
      }, paneIndex);
    });

    currentConfigs = currentConfigs.filter((config) => {
      if (desiredIds.has(config.id)) return true;
      chart.removeSeries(config.series);
      return false;
    });

    indicatorSeriesRef.current = currentConfigs;

    const panes = chart.panes();
    panes[0]?.setStretchFactor(lowerPaneByGroup.size > 0 ? 70 : MAIN_CHART_DEFAULT_STRETCH_FACTOR);
    panes[1]?.setStretchFactor(VOLUME_CHART_DEFAULT_STRETCH_FACTOR);
    panes[2]?.setStretchFactor(18);
    panes[3]?.setStretchFactor(18);
    const paneLayoutFrameId = requestAnimationFrame(() => setPaneLayouts(getPaneLayouts(chart)));
    return () => cancelAnimationFrame(paneLayoutFrameId);
  }, [chartInstanceRef, indicatorSeriesRef, indicatorSettings, setPaneLayouts]);
}

function getLegendDataFromCandle(candle: FormattedCandle): LegendData {
  return {
    time: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  };
}

function getLegendDataFromSeries(
  candle: CandlestickData<Time> & { volume?: number },
  volume: number,
): LegendData {
  return {
    time: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume,
  };
}

function isSameLegendTime(legendData: LegendData | null, candle: FormattedCandle): boolean {
  return legendData !== null && String(legendData.time) === String(candle.time);
}

function createLineOptions(color: string, lineWidth: 1 | 2 | 3 | 4 = 1) {
  return {
    color,
    lineWidth,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
    visible: true,
  };
}

function getPaneLayouts(chart: IChartApi): ChartPaneLayout[] {
  let top = 0;

  return chart.panes().map((pane) => {
    const height = pane.getHeight();
    const layout = {
      index: pane.paneIndex(),
      top,
      height,
    };
    top += height;
    return layout;
  });
}

function getVisiblePriceExtrema({
  chart,
  candlestickSeries,
  history,
  width,
  height,
}: {
  chart: IChartApi;
  candlestickSeries: ISeriesApi<"Candlestick">;
  history: FormattedCandle[];
  width: number;
  height: number;
}): VisiblePriceExtrema | null {
  if (history.length === 0 || width <= 0 || height <= 0) return null;

  const visibleRange = chart.timeScale().getVisibleLogicalRange();
  if (!visibleRange) return null;

  const visibleCandles = getVisibleCandles(history, visibleRange);
  if (visibleCandles.length === 0) return null;

  const highCandle = visibleCandles.reduce((currentHigh, candle) => (
    candle.high > currentHigh.high ? candle : currentHigh
  ), visibleCandles[0]);
  const lowCandle = visibleCandles.reduce((currentLow, candle) => (
    candle.low < currentLow.low ? candle : currentLow
  ), visibleCandles[0]);
  const highCoordinate = getExtremeCoordinates(chart, candlestickSeries, highCandle, highCandle.high, width);
  const lowCoordinate = getExtremeCoordinates(chart, candlestickSeries, lowCandle, lowCandle.low, width);

  if (!highCoordinate || !lowCoordinate) return null;

  return {
    high: {
      value: highCandle.high,
      x: highCoordinate.x,
      y: highCoordinate.y,
    },
    low: {
      value: lowCandle.low,
      x: lowCoordinate.x,
      y: lowCoordinate.y,
    },
    width,
    height,
  };
}

function getVisibleCandles(history: FormattedCandle[], visibleRange: LogicalRange): FormattedCandle[] {
  const start = Math.max(0, Math.floor(visibleRange.from));
  const end = Math.min(history.length - 1, Math.ceil(visibleRange.to));

  if (end < start) return [];
  return history.slice(start, end + 1);
}

function getExtremeCoordinates(
  chart: IChartApi,
  candlestickSeries: ISeriesApi<"Candlestick">,
  candle: FormattedCandle,
  price: number,
  width: number,
) {
  const x = chart.timeScale().timeToCoordinate(candle.time as Time);
  const y = candlestickSeries.priceToCoordinate(price);

  if (x === null || y === null) return null;

  return {
    x: Math.min(width, Math.max(0, x)),
    y,
  };
}
