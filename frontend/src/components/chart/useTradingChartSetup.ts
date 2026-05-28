import { useEffect } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { createChart, CandlestickSeries, ColorType, HistogramSeries, LineSeries } from 'lightweight-charts';
import type { CandlestickData, IChartApi, ISeriesApi, LineData, MouseEventParams, Time } from 'lightweight-charts';

import type { CursorPosition, IndicatorSeriesConfig, IndicatorValue, LegendData } from '../../types/chart';
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
  INDICATOR_CONFIG,
  MAIN_CHART_DEFAULT_STRETCH_FACTOR,
  VOLUME_CHART_DEFAULT_STRETCH_FACTOR,
} from './chartConstants';

interface UseTradingChartSetupParams {
  chartContainerRef: RefObject<HTMLDivElement | null>;
  chartInstanceRef: RefObject<IChartApi | null>;
  candlestickSeriesRef: RefObject<ISeriesApi<"Candlestick"> | null>;
  volumeSeriesRef: RefObject<ISeriesApi<"Histogram"> | null>;
  indicatorSeriesRef: RefObject<IndicatorSeriesConfig[]>;
  volumeByTimeRef: RefObject<Map<string, number>>;
  areEmaVisible: boolean;
  areMaVisible: boolean;
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
  areEmaVisible,
  areMaVisible,
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

    const histogramSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: 'right',
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: {
        type: 'volume',
      },
    }, 1);

    const indicatorSeries = INDICATOR_CONFIG.flatMap(({ period, color, mutedColor }) => ([
      {
        kind: 'ema' as const,
        period,
        series: chart.addSeries(LineSeries, {
          color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          visible: true,
        }),
      },
      {
        kind: 'ma' as const,
        period,
        series: chart.addSeries(LineSeries, {
          color: mutedColor,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          visible: false,
        }),
      },
    ]));

    chart.priceScale('right', 1).applyOptions({
      autoScale: true,
      alignLabels: true,
      borderVisible: true,
      borderColor: '#6b7280',
      scaleMargins: {
        top: 0.1,
        bottom: 0.05,
      },
    });

    const panes = chart.panes();
    panes[0]?.setStretchFactor(MAIN_CHART_DEFAULT_STRETCH_FACTOR);
    panes[1]?.setStretchFactor(VOLUME_CHART_DEFAULT_STRETCH_FACTOR);

    chartInstanceRef.current = chart;
    candlestickSeriesRef.current = candlestickSeries;
    volumeSeriesRef.current = histogramSeries;
    indicatorSeriesRef.current = indicatorSeries;
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

      const hoveredIndicators = indicatorSeries.reduce<IndicatorValue[]>((values, { kind, period, series }) => {
        const lineData = param.seriesData.get(series) as LineData<Time> | undefined;

        if (lineData) {
          values.push({
            kind,
            period,
            value: lineData.value,
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
    indicatorSeriesRef.current.forEach(({ kind, series }) => {
      series.applyOptions({ visible: kind === 'ema' ? areEmaVisible : areMaVisible });
    });
  }, [areEmaVisible, areMaVisible, indicatorSeriesRef]);
}
