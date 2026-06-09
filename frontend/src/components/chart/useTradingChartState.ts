import { useCallback, useMemo, useRef, useState } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';

import type { ChartPaneLayout, IndicatorGroup, IndicatorSeriesConfig, IndicatorSetting, IndicatorValue, LegendData, VisiblePriceExtrema } from '../../types/chart';
import type { FormattedCandle } from '../../utils/formatters';
import { DEFAULT_INDICATOR_SETTINGS, SUPPORTED_INTERVALS, SUPPORTED_SYMBOLS } from './chartConstants';

export function useTradingChartState() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const indicatorSeriesRef = useRef<IndicatorSeriesConfig[]>([]);
  const volumeByTimeRef = useRef<Map<string, number>>(new Map());
  const latestCandleRef = useRef<FormattedCandle | null>(null);
  const candleHistoryRef = useRef<FormattedCandle[]>([]);

  const [isChartReady, setIsChartReady] = useState(false);
  const [symbol, setSymbol] = useState(SUPPORTED_SYMBOLS[0]);
  const [interval, setInterval] = useState(SUPPORTED_INTERVALS[0]);
  const [legendData, setLegendData] = useState<LegendData | null>(null);
  const [visiblePriceExtrema, setVisiblePriceExtrema] = useState<VisiblePriceExtrema | null>(null);
  const [marketDataVersion, setMarketDataVersion] = useState(0);
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

  const handleCandleHistoryChange = useCallback(() => {
    setMarketDataVersion((version) => version + 1);
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

  return {
    chartContainerRef,
    chartInstanceRef,
    candlestickSeriesRef,
    volumeSeriesRef,
    indicatorSeriesRef,
    volumeByTimeRef,
    latestCandleRef,
    candleHistoryRef,
    isChartReady,
    symbol,
    interval,
    legendData,
    visiblePriceExtrema,
    marketDataVersion,
    indicatorSettings,
    chartIndicatorSettings,
    visibleIndicatorValues,
    hiddenIndicatorGroups,
    paneLayouts,
    indicatorSettingsWindow,
    setSymbol,
    setInterval,
    setIsChartReady,
    setLegendData,
    setHoverIndicatorValues,
    setPaneLayouts,
    setVisiblePriceExtrema,
    setIndicatorSettingsWindow,
    handleIndicatorValuesChange,
    handleCandleHistoryChange,
    handleToggleIndicatorGroupVisibility,
    handleApplyIndicatorSettings,
    handleDismissIndicatorGroup,
    handleOpenIndicatorSettingsWindow,
  };
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
