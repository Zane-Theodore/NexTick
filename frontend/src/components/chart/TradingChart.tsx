import { useCallback, useMemo, useRef, useState } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';

import { useMarketData } from '../../hooks/useMarketData';
import type { ChartPaneLayout, CursorPosition, IndicatorGroup, IndicatorSeriesConfig, IndicatorSetting, IndicatorValue, LegendData } from '../../types/chart';
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
  const [indicatorSettingsWindow, setIndicatorSettingsWindow] = useState<{ id: number; initialGroup: IndicatorGroup | null } | null>(null);
  const [hiddenIndicatorGroups, setHiddenIndicatorGroups] = useState<IndicatorGroup[]>(['ma']);
  const [paneLayouts, setPaneLayouts] = useState<ChartPaneLayout[]>([]);
  const [indicatorSettings, setIndicatorSettings] = useState<IndicatorSetting[]>(() => (
    DEFAULT_INDICATOR_SETTINGS.map((setting) => ({ ...setting }))
  ));

  const handleIndicatorValuesChange = useCallback((values: IndicatorValue[]) => {
    setIndicatorValues(values);
  }, []);

  const handleToggleIndicatorGroupVisibility = useCallback((group: IndicatorGroup) => {
    setHiddenIndicatorGroups((groups) => (
      groups.includes(group)
        ? groups.filter((hiddenGroup) => hiddenGroup !== group)
        : [...groups, group]
    ));
  }, []);

  const handleApplyIndicatorSettings = useCallback((updatedSettings: IndicatorSetting[]) => {
    const updatedSettingsById = new Map(updatedSettings.map((setting) => [setting.id, setting]));
    setIndicatorSettings((settings) => {
      const currentSettingIds = new Set(settings.map((setting) => setting.id));
      const nextSettings = [
        ...settings.map((setting) => updatedSettingsById.get(setting.id) ?? setting),
        ...updatedSettings.filter((setting) => !currentSettingIds.has(setting.id)),
      ];

      return areIndicatorSettingsEqual(settings, nextSettings) ? settings : nextSettings;
    });
    setHiddenIndicatorGroups((groups) => {
      const nextGroups = groups.filter((group) => (
        updatedSettings.some((setting) => setting.group === group && setting.visible)
      ));

      return areIndicatorGroupsEqual(groups, nextGroups) ? groups : nextGroups;
    });
  }, []);

  const handleDismissIndicatorGroup = useCallback((group: IndicatorGroup) => {
    setIndicatorSettings((settings) => settings.map((setting) => (
      setting.group === group ? { ...setting, visible: false } : setting
    )));
    setHiddenIndicatorGroups((groups) => groups.filter((hiddenGroup) => hiddenGroup !== group));
  }, []);

  const handleOpenIndicatorSettingsWindow = useCallback((initialGroup: IndicatorGroup | null) => {
    setIndicatorSettingsWindow((currentWindow) => ({
      id: (currentWindow?.id ?? 0) + 1,
      initialGroup,
    }));
  }, []);

  const chartIndicatorSettings = useMemo(() => (
    indicatorSettings.map((setting) => (
      hiddenIndicatorGroups.includes(setting.group) ? { ...setting, visible: false } : setting
    ))
  ), [hiddenIndicatorGroups, indicatorSettings]);

  useTradingChartSetup({
    chartContainerRef,
    chartInstanceRef,
    candlestickSeriesRef,
    volumeSeriesRef,
    indicatorSeriesRef,
    volumeByTimeRef,
    indicatorSettings: chartIndicatorSettings,
    setIsChartReady,
    setLegendData,
    setCursorPosition,
    setHoverIndicatorValues,
    setPaneLayouts,
  });

  useMarketData(
    chartInstanceRef,
    candlestickSeriesRef,
    volumeSeriesRef,
    symbol,
    interval,
    volumeByTimeRef,
    indicatorSeriesRef,
    indicatorSettings,
    handleIndicatorValuesChange,
    isChartReady,
  );

  const visibleIndicatorValues = useMemo(() => {
    if (!hoverIndicatorValues) return indicatorValues;

    const hoverValuesById = new Map(hoverIndicatorValues.map((value) => [value.id, value]));
    const mergedValues = indicatorValues.map((value) => hoverValuesById.get(value.id) ?? value);
    const mergedValueIds = new Set(mergedValues.map((value) => value.id));
    return [
      ...mergedValues,
      ...hoverIndicatorValues.filter((value) => !mergedValueIds.has(value.id)),
    ];
  }, [hoverIndicatorValues, indicatorValues]);

  return (
    <div className="h-full flex flex-col bg-[#0f1117] overflow-hidden">
      <ChartFilterBar
        symbol={symbol}
        interval={interval}
        supportedSymbols={SUPPORTED_SYMBOLS}
        supportedIntervals={SUPPORTED_INTERVALS}
        onSymbolChange={setSymbol}
        onIntervalChange={setInterval}
        onOpenIndicatorSettings={() => handleOpenIndicatorSettingsWindow(null)}
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
          settings={indicatorSettings}
          allSettings={indicatorSettings}
          allDefaultSettings={DEFAULT_INDICATOR_SETTINGS}
          values={visibleIndicatorValues}
          hiddenGroups={hiddenIndicatorGroups}
          paneLayouts={paneLayouts}
          settingsWindow={indicatorSettingsWindow}
          onToggleGroupVisibility={handleToggleIndicatorGroupVisibility}
          onDismissGroup={handleDismissIndicatorGroup}
          onOpenSettingsWindow={handleOpenIndicatorSettingsWindow}
          onCloseSettingsWindow={() => setIndicatorSettingsWindow(null)}
          onApplySettings={handleApplyIndicatorSettings}
        />

        <ScrollToLatestButton onClick={() => chartInstanceRef.current?.timeScale().scrollToPosition(10, false)} />
      </div>
    </div>
  );
}

function areIndicatorSettingsEqual(currentSettings: IndicatorSetting[], nextSettings: IndicatorSetting[]): boolean {
  if (currentSettings.length !== nextSettings.length) return false;

  return currentSettings.every((setting, index) => (
    JSON.stringify(setting) === JSON.stringify(nextSettings[index])
  ));
}

function areIndicatorGroupsEqual(currentGroups: IndicatorGroup[], nextGroups: IndicatorGroup[]): boolean {
  if (currentGroups.length !== nextGroups.length) return false;
  return currentGroups.every((group, index) => group === nextGroups[index]);
}
