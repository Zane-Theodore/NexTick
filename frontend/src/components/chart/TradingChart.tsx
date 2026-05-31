import { useCallback, useMemo, useRef, useState } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';

import { useMarketData } from '../../hooks/useMarketData';
import type { CursorPosition, IndicatorGroup, IndicatorSeriesConfig, IndicatorSetting, IndicatorValue, LegendData } from '../../types/chart';
import ChartFilterBar from './ChartFilterBar';
import IndicatorLegend from './IndicatorLegend';
import OhlcvTooltip from './OhlcvTooltip';
import ScrollToLatestButton from './ScrollToLatestButton';
import { DEFAULT_INDICATOR_SETTINGS, SUPPORTED_INTERVALS, SUPPORTED_SYMBOLS } from './chartConstants';
import { useTradingChartSetup } from './useTradingChartSetup';

export default function TradingChart() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const indicatorSeriesRef = useRef<IndicatorSeriesConfig[]>([]);
  const volumeByTimeRef = useRef<Map<string, number>>(new Map());
  
  const [isChartReady, setIsChartReady] = useState<boolean>(false);
  const [symbol, setSymbol] = useState<string>(SUPPORTED_SYMBOLS[0]);
  const [interval, setInterval] = useState<string>(SUPPORTED_INTERVALS[0]);
  const [legendData, setLegendData] = useState<LegendData | null>(null);
  const [cursorPosition, setCursorPosition] = useState<CursorPosition>({ x: 0, y: 0 });
  const [indicatorValues, setIndicatorValues] = useState<IndicatorValue[]>([]);
  const [hoverIndicatorValues, setHoverIndicatorValues] = useState<IndicatorValue[] | null>(null);
  const [isIndicatorLegendOpen, setIsIndicatorLegendOpen] = useState<boolean>(false);
  const [dismissedIndicatorGroups, setDismissedIndicatorGroups] = useState<IndicatorGroup[]>([]);
  const [indicatorSettings, setIndicatorSettings] = useState<IndicatorSetting[]>(() => (
    DEFAULT_INDICATOR_SETTINGS.map((setting) => ({ ...setting }))
  ));

  const handleIndicatorValuesChange = useCallback((values: IndicatorValue[]) => {
    setIndicatorValues(values);
  }, []);

  const handleToggleIndicatorGroupVisibility = useCallback((group: IndicatorGroup) => {
    setIndicatorSettings((settings) => settings.map((setting) => (
      setting.group === group
        ? { ...setting, visible: !settings.some((candidate) => candidate.group === group && candidate.visible) }
        : setting
    )));
  }, []);

  const handleApplyIndicatorSettings = useCallback((updatedSettings: IndicatorSetting[]) => {
    const updatedSettingsById = new Map(updatedSettings.map((setting) => [setting.id, setting]));
    setIndicatorSettings((settings) => settings.map((setting) => (
      updatedSettingsById.get(setting.id) ?? setting
    )));
  }, []);

  const handleDismissIndicatorGroup = useCallback((group: IndicatorGroup) => {
    setDismissedIndicatorGroups((groups) => (
      groups.includes(group) ? groups : [...groups, group]
    ));
  }, []);

  const activeIndicatorSettings = useMemo(() => (
    indicatorSettings.filter((setting) => !dismissedIndicatorGroups.includes(setting.group))
  ), [dismissedIndicatorGroups, indicatorSettings]);

  const activeDefaultIndicatorSettings = useMemo(() => (
    DEFAULT_INDICATOR_SETTINGS.filter((setting) => !dismissedIndicatorGroups.includes(setting.group))
  ), [dismissedIndicatorGroups]);

  useTradingChartSetup({
    chartContainerRef,
    chartInstanceRef,
    candlestickSeriesRef,
    volumeSeriesRef,
    indicatorSeriesRef,
    volumeByTimeRef,
    indicatorSettings: activeIndicatorSettings,
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
    activeIndicatorSettings,
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
          settings={activeIndicatorSettings}
          defaultSettings={activeDefaultIndicatorSettings}
          values={visibleIndicatorValues}
          isOpen={isIndicatorLegendOpen}
          onToggleOpen={() => setIsIndicatorLegendOpen((isOpen) => !isOpen)}
          onToggleGroupVisibility={handleToggleIndicatorGroupVisibility}
          onDismissGroup={handleDismissIndicatorGroup}
          onApplySettings={handleApplyIndicatorSettings}
        />

        <ScrollToLatestButton onClick={() => chartInstanceRef.current?.timeScale().scrollToPosition(10, false)} />
      </div>
    </div>
  );
}
