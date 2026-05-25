import { useCallback, useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, ColorType, HistogramSeries, LineSeries } from 'lightweight-charts';
import type { CandlestickData, IChartApi, ISeriesApi, LineData, MouseEventParams, Time } from 'lightweight-charts';

import { useMarketData } from '../../hooks/useMarketData';
import type { IndicatorSeriesConfig, IndicatorValue } from '../../hooks/useMarketData';
import {
  formatChartValue,
  formatTimeScaleCrosshair,
  formatTimeScaleTick,
  formatTooltipTime,
} from '../../utils/formatters';
import type { ChartTime } from '../../utils/formatters';

interface LegendData {
  time: ChartTime;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface CursorPosition {
  x: number;
  y: number;
}

interface IndicatorEyeIconProps {
  isVisible: boolean;
}

const IndicatorEyeIcon = ({ isVisible }: IndicatorEyeIconProps) => {
  if (isVisible) {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <path d="M10 4.5c-4.2 0-7.2 3.6-8.3 5.2a.75.75 0 000 .8c1.1 1.6 4.1 5.2 8.3 5.2s7.2-3.6 8.3-5.2a.75.75 0 000-.8C17.2 8.1 14.2 4.5 10 4.5zm0 8.5a3 3 0 110-6 3 3 0 010 6z" />
        <path d="M10 11.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
      </svg>
    );
  }

  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M3.28 2.22a.75.75 0 00-1.06 1.06l14.5 14.5a.75.75 0 101.06-1.06l-2.13-2.13a13.3 13.3 0 002.65-3.95.75.75 0 000-.52C17.43 7.55 14.43 4 10 4c-1.36 0-2.58.34-3.66.88L3.28 2.22zm5.1 5.1l1.08 1.08A1.75 1.75 0 0111.6 10.54l1.08 1.08a3.25 3.25 0 00-4.3-4.3z" clipRule="evenodd" />
      <path d="M4.62 6.47A13.32 13.32 0 001.7 10.12a.75.75 0 000 .52C2.57 13.21 5.57 16 10 16c.96 0 1.85-.17 2.67-.46l-2.2-2.2A3.25 3.25 0 016.66 9.53L4.62 6.47z" />
    </svg>
  );
};

const INDICATOR_CONFIG = [
  { period: 7, color: '#f5d90a', mutedColor: '#f5d90a80' },
  { period: 25, color: '#ff4ecd', mutedColor: '#ff4ecd80' },
  { period: 99, color: '#00d4ff', mutedColor: '#00d4ff80' },
] as const;

const SUPPORTED_SYMBOLS = import.meta.env.VITE_TRADING_SYMBOLS.split(',').map((s: string) => s.trim());
const SUPPORTED_INTERVALS = import.meta.env.VITE_CANDLE_INTERVALS.split(',').map((s: string) => s.trim());

export default function TradingChart() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const indicatorSeriesRef = useRef<IndicatorSeriesConfig[]>([]);
  const volumeByTimeRef = useRef<Map<string, number>>(new Map());
  
  const [isChartReady, setIsChartReady] = useState<boolean>(false);
  const [symbol, setSymbol] = useState<string>('BTCUSDT');
  const [interval, setInterval] = useState<string>('1m');
  const [legendData, setLegendData] = useState<LegendData | null>(null);
  const [cursorPosition, setCursorPosition] = useState<CursorPosition>({ x: 0, y: 0 });
  const [indicatorValues, setIndicatorValues] = useState<IndicatorValue[]>([]);
  const [hoverIndicatorValues, setHoverIndicatorValues] = useState<IndicatorValue[] | null>(null);
  const [isIndicatorLegendOpen, setIsIndicatorLegendOpen] = useState<boolean>(true);
  const [areEmaVisible, setAreEmaVisible] = useState<boolean>(true);
  const [areMaVisible, setAreMaVisible] = useState<boolean>(false);

  const handleIndicatorValuesChange = useCallback((values: IndicatorValue[]) => {
    setIndicatorValues(values);
  }, []);

  useMarketData(
    chartInstanceRef,
    candlestickSeriesRef,
    volumeSeriesRef,
    symbol,
    interval,
    volumeByTimeRef,
    indicatorSeriesRef,
    handleIndicatorValuesChange,
    isChartReady,
  );

  // Handle symbol change
  const handleSymbolChange = (newSymbol: string) => {
    setSymbol(newSymbol);
  };

  // Handle interval change
  const handleIntervalChange = (newInterval: string) => {
    setInterval(newInterval);
  };

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: '#131722' },
        textColor: '#d1d4dc',
        attributionLogo: false,
        panes: {
          separatorColor: '#2B2B43',
          separatorHoverColor: '#3f3f5a',
          enableResize: false,
        },
      },
      crosshair: {
        mode: 0, 
        vertLine: {
          width: 1,
          color: '#3f3f5a',
          style: 3,
          labelBackgroundColor: '#27273b',
        },
        horzLine: {
          width: 1,
          color: '#3f3f5a',
          style: 3,
          labelBackgroundColor: '#27273b',
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
        borderVisible: false,
        scaleMargins: {
          top: 0.1,
          bottom: 0.08,
        },
      },
      grid: {
        vertLines: { color: '#2B2B43' },
        horzLines: { color: '#2B2B43' },
      },
      timeScale: { 
        timeVisible: true, 
        secondsVisible: false, 
        rightOffset: 10,
        minBarSpacing: 10,
        maxBarSpacing: 80,
        tickMarkFormatter: formatTimeScaleTick,
      },
      localization: {
        priceFormatter: formatChartValue,
        timeFormatter: formatTimeScaleCrosshair,
      },
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
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
      borderVisible: false,
      scaleMargins: {
        top: 0.1,
        bottom: 0.05,
      },
    });

    const panes = chart.panes();
    panes[0]?.setStretchFactor(4);
    panes[1]?.setStretchFactor(1);

    chartInstanceRef.current = chart;
    candlestickSeriesRef.current = candlestickSeries;
    volumeSeriesRef.current = histogramSeries;
    indicatorSeriesRef.current = indicatorSeries;
    setIsChartReady(true);

    // Subscribe to crosshair move events
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

      finalX = Math.max(0, finalX);
      finalY = Math.max(0, finalY);

      setCursorPosition({ x: finalX, y: finalY });

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

      const hoveredIndicators = indicatorSeries.reduce<IndicatorValue[]>((values, { kind, period, series: lineSeries }) => {
          const lineData = param.seriesData.get(lineSeries) as LineData<Time> | undefined;

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
  }, []);

  const visibleIndicatorValues = hoverIndicatorValues ?? indicatorValues;

  useEffect(() => {
    if (!isChartReady) return;

    indicatorSeriesRef.current.forEach(({ kind, series: indicatorSeries }) => {
      indicatorSeries.applyOptions({ visible: kind === 'ema' ? areEmaVisible : areMaVisible });
    });
  }, [areEmaVisible, areMaVisible, isChartReady]);

  return (
    <div className="h-full flex flex-col bg-[#131722] overflow-hidden">
      {/* Filter Bar */}
      <div className="shrink-0 px-5 py-4 flex items-center gap-6 bg-[#131722] border-b border-[#2B2B43]">
        {/* Symbol Selector */}
        <div className="flex flex-col">
          <label className="text-xs text-[#9099aa] mb-2 font-semibold">Symbol</label>
          <select
            value={symbol}
            onChange={(e) => handleSymbolChange(e.target.value)}
            className="px-3 py-2 bg-[#1e1e2e] border border-[#3f3f5a] text-[#d1d4dc] rounded hover:border-[#5a5a7a] focus:border-blue-500 focus:outline-none transition-colors"
          >
            {SUPPORTED_SYMBOLS.map((s: string) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* Interval Selector */}
        <div className="flex flex-col">
          <label className="text-xs text-[#9099aa] mb-2 font-semibold">Interval</label>
          <div className="flex gap-2">
            {SUPPORTED_INTERVALS.map((iv: string) => (
              <button
                key={iv}
                onClick={() => handleIntervalChange(iv)}
                className={`px-3 py-2 rounded text-sm font-medium transition-all border ${
                  interval === iv
                    ? 'bg-blue-600 border-blue-500 text-white shadow-lg'
                    : 'bg-[#1e1e2e] border-[#3f3f5a] text-[#d1d4dc] hover:border-[#5a5a7a]'
                }`}
              >
                {iv}
              </button>
            ))}
          </div>
        </div>

        {/* Current Info */}
        <div className="ml-auto text-right">
          <div className="text-sm text-[#d1d4dc] font-semibold">
            {symbol} • {interval}
          </div>
          <div className="text-xs text-[#9099aa]">Real-time updates</div>
        </div>
      </div>

      {/* Chart Container - Takes remaining space */}
      <div className="flex-1 relative overflow-hidden bg-[#131722]">
        {/* OHLCV Legend Tooltip */}
        {legendData && (
          <div 
            className="absolute z-20 pointer-events-none"
            style={{
              left: `${cursorPosition.x + 16}px`,
              top: `${cursorPosition.y + 16}px`,
            }}
          >
            <div className="min-w-60 bg-[#1e1e2e]/95 border border-[#3f3f5a] rounded-lg px-4 py-3 shadow-lg backdrop-blur-sm">
              <div className="font-mono text-sm text-[#d1d4dc] space-y-1.5">
                <div className="font-bold text-base text-white">
                  {symbol} • {interval}
                </div>
                <div className="text-xs text-[#9099aa] mb-2 border-b border-[#3f3f5a] pb-2">
                  {formatTooltipTime(legendData.time)}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <span className="text-[#9099aa]">Open:</span>
                  <span className="text-white font-semibold">{formatChartValue(legendData.open)}</span>

                  <span className="text-[#26a69a]">High:</span>
                  <span className="text-[#26a69a] font-semibold">{formatChartValue(legendData.high)}</span>
                  
                  <span className="text-[#ef5350]">Low:</span>
                  <span className="text-[#ef5350] font-semibold">{formatChartValue(legendData.low)}</span>
                  
                  <span className="text-[#9099aa]">Close:</span>
                  <span className="text-white font-semibold">{formatChartValue(legendData.close)}</span>

                  <span className="text-[#9099aa]">Volume:</span>
                  <span className="text-white font-semibold">{formatChartValue(legendData.volume)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div 
          ref={chartContainerRef} 
          className="w-full h-full"
        />

        {/* Indicator Legend */}
        <div className="absolute left-0 top-2 z-10 flex items-start">
          <button
            type="button"
            onClick={() => setIsIndicatorLegendOpen((isOpen) => !isOpen)}
            className="h-7 w-7 text-[#d1d4dc] hover:text-white flex items-center justify-center transition-colors"
            title={isIndicatorLegendOpen ? 'Hide indicators' : 'Show indicators'}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`h-4 w-4 transition-transform duration-300 ease-out ${
                isIndicatorLegendOpen ? 'rotate-0' : '-rotate-90'
              }`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
            </svg>
          </button>

          <div
            className={`overflow-hidden transition-[max-width,opacity,transform] duration-300 ease-out ${
              isIndicatorLegendOpen ? 'max-w-130 opacity-100 translate-x-0' : 'max-w-0 opacity-0 -translate-x-3'
            }`}
          >
            <div className="px-1.5 py-1 flex flex-col gap-y-1 font-mono text-xs whitespace-nowrap">
              <div className="min-h-5 flex flex-nowrap items-center gap-x-3 border border-transparent hover:border-[#3f3f5a] rounded-sm transition-colors duration-200 px-1">
                {INDICATOR_CONFIG.map(({ period, color }) => {
                  const indicatorValue = visibleIndicatorValues.find((value) => value.kind === 'ema' && value.period === period);

                  return (
                    <span
                      key={`ema-${period}`}
                      style={{ color }}
                      className="whitespace-nowrap"
                    >
                      EMA({period}): {indicatorValue ? formatChartValue(indicatorValue.value) : '--'}
                    </span>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setAreEmaVisible((isVisible) => !isVisible)}
                  className="h-5 w-5 shrink-0 text-[#9099aa] hover:text-white flex items-center justify-center transition-colors"
                  title={areEmaVisible ? 'Hide EMA lines' : 'Show EMA lines'}
                >
                  <IndicatorEyeIcon isVisible={areEmaVisible} />
                </button>
              </div>

              <div className="min-h-5 flex flex-nowrap items-center gap-x-3 border border-transparent hover:border-[#3f3f5a] rounded-sm transition-colors duration-200 px-1">
                {INDICATOR_CONFIG.map(({ period, color }) => {
                  const indicatorValue = visibleIndicatorValues.find((value) => value.kind === 'ma' && value.period === period);

                  return (
                    <span
                      key={`ma-${period}`}
                      style={{ color }}
                      className="whitespace-nowrap"
                    >
                      MA({period}): {indicatorValue ? formatChartValue(indicatorValue.value) : '--'}
                    </span>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setAreMaVisible((isVisible) => !isVisible)}
                  className="h-5 w-5 shrink-0 text-[#9099aa] hover:text-white flex items-center justify-center transition-colors"
                  title={areMaVisible ? 'Hide MA lines' : 'Show MA lines'}
                >
                  <IndicatorEyeIcon isVisible={areMaVisible} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Scroll to Latest Button */}
        <button 
          onClick={() => chartInstanceRef.current?.timeScale().scrollToPosition(10, false)}
          className="absolute bottom-8 right-20 z-10 w-10 h-10 bg-[#2B2B43]/80 hover:bg-blue-600 text-[#d1d4dc] hover:text-white rounded-full flex items-center justify-center backdrop-blur shadow-lg transition-all border border-[#3f3f5a] hover:border-blue-500"
          title="Scroll to latest"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
    </div>
  );
}
