import { useCallback, useRef, useState } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';

import { useMarketData } from '../../hooks/useMarketData';
import type { CursorPosition, IndicatorSeriesConfig, IndicatorValue, LegendData } from '../../types/chart';
import ChartFilterBar from './ChartFilterBar';
import IndicatorLegend from './IndicatorLegend';
import OhlcvTooltip from './OhlcvTooltip';
import ScrollToLatestButton from './ScrollToLatestButton';
import { SUPPORTED_INTERVALS, SUPPORTED_SYMBOLS } from './chartConstants';
import { useTradingChartSetup } from './useTradingChartSetup';

export default function TradingChart() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const indicatorSeriesRef = useRef<IndicatorSeriesConfig[]>([]);
  const volumeByTimeRef = useRef<Map<string, number>>(new Map());
  
  const [isChartReady, setIsChartReady] = useState<boolean>(false);
  const [symbol, setSymbol] = useState<string>(SUPPORTED_SYMBOLS[0]);
  const [interval, setInterval] = useState<string>(SUPPORTED_INTERVALS[0]);
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

  useTradingChartSetup({
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
  });

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

  const visibleIndicatorValues = hoverIndicatorValues ?? indicatorValues;

  return (
    <div className="h-full flex flex-col bg-[#0f1117] overflow-hidden">
      <ChartFilterBar
        symbol={symbol}
        interval={interval}
        supportedSymbols={SUPPORTED_SYMBOLS}
        supportedIntervals={SUPPORTED_INTERVALS}
        onSymbolChange={setSymbol}
        onIntervalChange={setInterval}
      />

      <div className="flex-1 relative overflow-hidden bg-[#0b0f16]">
        {legendData && (
          <OhlcvTooltip
            symbol={symbol}
            interval={interval}
            legendData={legendData}
            cursorPosition={cursorPosition}
          />
        )}

        <div ref={chartContainerRef} className="w-full h-full" />

        <IndicatorLegend
          values={visibleIndicatorValues}
          isOpen={isIndicatorLegendOpen}
          areEmaVisible={areEmaVisible}
          areMaVisible={areMaVisible}
          onToggleOpen={() => setIsIndicatorLegendOpen((isOpen) => !isOpen)}
          onToggleEma={() => setAreEmaVisible((isVisible) => !isVisible)}
          onToggleMa={() => setAreMaVisible((isVisible) => !isVisible)}
        />

        <ScrollToLatestButton onClick={() => chartInstanceRef.current?.timeScale().scrollToPosition(10, false)} />
      </div>
    </div>
  );
}
