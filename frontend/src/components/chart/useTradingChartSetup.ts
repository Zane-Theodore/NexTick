import { useEffect } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { createChart, CandlestickSeries, ColorType, LineSeries } from 'lightweight-charts';
import type { AutoscaleInfoProvider, CandlestickData, IChartApi, ISeriesApi, LineData, MouseEventParams, Time } from 'lightweight-charts';

import type { CursorPosition, IndicatorSeriesConfig, IndicatorSetting, IndicatorValue, LegendData } from '../../types/chart';
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
  indicatorSettings: IndicatorSetting[];
  setIsChartReady: Dispatch<SetStateAction<boolean>>;
  setLegendData: Dispatch<SetStateAction<LegendData | null>>;
  setCursorPosition: Dispatch<SetStateAction<CursorPosition>>;
  setHoverIndicatorValues: Dispatch<SetStateAction<IndicatorValue[] | null>>;
}

export function useTradingChartSetup({
  chartContainerRef,
  chartInstanceRef,
  candlestickSeriesRef,
  volumeSeriesRef,
  indicatorSeriesRef,
  volumeByTimeRef,
  indicatorSettings,
  setIsChartReady,
  setLegendData,
  setCursorPosition,
  setHoverIndicatorValues,
}: UseTradingChartSetupParams) {
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
          bottom: 0.08,
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
            above: 0,
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
        top: 0.1,
        bottom: 0,
      },
    });

    const panes = chart.panes();
    panes[0]?.setStretchFactor(MAIN_CHART_DEFAULT_STRETCH_FACTOR);
    panes[1]?.setStretchFactor(VOLUME_CHART_DEFAULT_STRETCH_FACTOR);

    chartInstanceRef.current = chart;
    candlestickSeriesRef.current = candlestickSeries;
    volumeSeriesRef.current = volumeSeries;
    indicatorSeriesRef.current = [];
    setIsChartReady(true);

    const handleCrosshair = (param: MouseEventParams<Time>) => {
      if (!param.point || param.point.x < 0 || param.point.y < 0 || !param.time || !chartContainerRef.current) {
        setLegendData(null);
        setHoverIndicatorValues(null);
        return;
      }

      const containerWidth = chartContainerRef.current.clientWidth;
      const containerHeight = chartContainerRef.current.clientHeight;

      const TOOLTIP_WIDTH = 240;
      const TOOLTIP_HEIGHT = 210;
      const OFFSET = 15;

      let finalX = param.point.x + OFFSET;
      let finalY = param.point.y + OFFSET;

      if (finalX + TOOLTIP_WIDTH > containerWidth) {
        finalX = param.point.x - TOOLTIP_WIDTH - OFFSET;
      }

      if (finalY + TOOLTIP_HEIGHT > containerHeight) {
        finalY = param.point.y - TOOLTIP_HEIGHT - OFFSET;
      }

      setCursorPosition({
        x: Math.max(0, finalX),
        y: Math.max(0, finalY),
      });

      const candleData = param.seriesData.get(candlestickSeries) as (CandlestickData<Time> & { volume?: number }) | undefined;
      if (candleData && candleData.open !== undefined) {
        const volume = volumeByTimeRef.current.get(String(param.time)) ?? Number(candleData.volume ?? 0);

        setLegendData({
          time: param.time,
          open: candleData.open,
          high: candleData.high,
          low: candleData.low,
          close: candleData.close,
          volume,
        });
      }

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

      setHoverIndicatorValues(hoveredIndicators.length > 0 ? hoveredIndicators : null);
    };
    chart.subscribeCrosshairMove(handleCrosshair);

    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 0 || entries[0].target !== chartContainerRef.current) return;
      chart.applyOptions({
        width: entries[0].contentRect.width,
        height: entries[0].contentRect.height,
      });
    });
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshair);
      resizeObserver.disconnect();
      setIsChartReady(false);
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
    indicatorSeriesRef,
    setCursorPosition,
    setHoverIndicatorValues,
    setIsChartReady,
    setLegendData,
    volumeByTimeRef,
    volumeSeriesRef,
  ]);

  useEffect(() => {
    const chart = chartInstanceRef.current;
    if (!chart) return;

    let currentConfigs = [...indicatorSeriesRef.current];
    const desiredIds = new Set<string>();

    const upsertSeries = (config: Omit<IndicatorSeriesConfig, 'series'>, paneIndex: number) => {
      desiredIds.add(config.id);

      const existingConfig = currentConfigs.find((currentConfig) => currentConfig.id === config.id);
      if (existingConfig) {
        Object.assign(existingConfig, config);
        existingConfig.series.applyOptions({
          color: config.color,
          visible: true,
        });
        return;
      }

      currentConfigs.push({
        ...config,
        series: chart.addSeries(LineSeries, createLineOptions(config.color), paneIndex),
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
          color: setting.macdColor,
        }, 3);
        upsertSeries({
          id: `${setting.id}-signal`,
          group: setting.group,
          kind: 'macd-signal',
          label: `${setting.label} Signal`,
          fastPeriod: setting.fastPeriod,
          slowPeriod: setting.slowPeriod,
          signalPeriod: setting.signalPeriod,
          color: setting.signalColor,
        }, 3);
        return;
      }

      const paneIndex = setting.group === 'volume-ma'
        ? 1
        : setting.group === 'rsi'
          ? 2
          : 0;

      upsertSeries({
        id: setting.id,
        group: setting.group,
        kind: setting.group,
        label: setting.label,
        period: setting.period,
        color: setting.color,
      }, paneIndex);
    });

    currentConfigs = currentConfigs.filter((config) => {
      if (desiredIds.has(config.id)) return true;
      chart.removeSeries(config.series);
      return false;
    });

    indicatorSeriesRef.current = currentConfigs;

    const hasLowerIndicatorPane = indicatorSettings.some((setting) => setting.visible && (setting.group === 'rsi' || setting.group === 'macd'));
    const panes = chart.panes();
    panes[0]?.setStretchFactor(hasLowerIndicatorPane ? 70 : MAIN_CHART_DEFAULT_STRETCH_FACTOR);
    panes[1]?.setStretchFactor(VOLUME_CHART_DEFAULT_STRETCH_FACTOR);
    panes[2]?.setStretchFactor(18);
    panes[3]?.setStretchFactor(18);
  }, [chartInstanceRef, indicatorSeriesRef, indicatorSettings]);
}

function createLineOptions(color: string) {
  return {
    color,
    lineWidth: 1 as const,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
    visible: true,
  };
}
