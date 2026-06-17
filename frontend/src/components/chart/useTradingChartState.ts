import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';

import type { ChartPaneLayout, IndicatorGroup, IndicatorSeriesConfig, IndicatorSetting, IndicatorValue, LegendData, VisiblePriceExtrema } from '../../types/chart';
import type { FormattedCandle } from '../../utils/formatters';
import {
  areIndicatorGroupsEqual,
  areIndicatorSettingsEqual,
  cloneIndicatorSettings,
  mergeIndicatorSettings,
} from '../../utils/indicatorSettings';
import { DEFAULT_INDICATOR_SETTINGS, SUPPORTED_INTERVALS, SUPPORTED_SYMBOLS } from './chartConstants';
import {
  clearTradingChartPreferences,
  isChartViewSettingsEqual,
  loadTradingChartPreferences,
  saveTradingChartPreferences,
} from './chartPreferences';
import type { ChartViewSettings } from './chartPreferences';

export function useTradingChartState() {
  const [initialPreferences] = useState(loadTradingChartPreferences);
  const [initialChartViewSettings] = useState<ChartViewSettings>(() => initialPreferences.chartViewSettings ?? {});
  const chartViewSettingsRef = useRef<ChartViewSettings>(initialChartViewSettings);
  const indicatorSettingsRef = useRef<IndicatorSetting[]>([]);
  const hiddenIndicatorGroupsRef = useRef<IndicatorGroup[]>([]);
  const chartViewSettingsSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPreferencesResettingRef = useRef(false);
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
  const [hiddenIndicatorGroups, setHiddenIndicatorGroups] = useState<IndicatorGroup[]>(() => (
    initialPreferences.hiddenIndicatorGroups ?? ['ma']
  ));
  const [paneLayouts, setPaneLayouts] = useState<ChartPaneLayout[]>([]);
  const [indicatorSettings, setIndicatorSettings] = useState<IndicatorSetting[]>(() => (
    initialPreferences.indicatorSettings
      ?? cloneIndicatorSettings(DEFAULT_INDICATOR_SETTINGS)
  ));

  const resetCurrentPreferences = useCallback(() => {
    isPreferencesResettingRef.current = true;

    if (chartViewSettingsSaveTimeoutRef.current !== null) {
      clearTimeout(chartViewSettingsSaveTimeoutRef.current);
      chartViewSettingsSaveTimeoutRef.current = null;
    }

    clearTradingChartPreferences();
    chartViewSettingsRef.current = {};
    indicatorSettingsRef.current = cloneIndicatorSettings(DEFAULT_INDICATOR_SETTINGS);
    hiddenIndicatorGroupsRef.current = ['ma'];
    setIndicatorSettings(cloneIndicatorSettings(DEFAULT_INDICATOR_SETTINGS));
    setHiddenIndicatorGroups(['ma']);

    window.setTimeout(() => {
      isPreferencesResettingRef.current = false;
    }, 1_000);
  }, []);

  const saveCurrentPreferences = useCallback((
    settings: IndicatorSetting[] = indicatorSettingsRef.current,
    groups: IndicatorGroup[] = hiddenIndicatorGroupsRef.current,
    chartViewSettings: ChartViewSettings = chartViewSettingsRef.current,
  ) => {
    if (isPreferencesResettingRef.current) return;

    saveTradingChartPreferences({
      indicatorSettings: settings,
      hiddenIndicatorGroups: groups,
      chartViewSettings,
    });
  }, []);

  useEffect(() => {
    indicatorSettingsRef.current = indicatorSettings;
    hiddenIndicatorGroupsRef.current = hiddenIndicatorGroups;
    saveCurrentPreferences();
  }, [hiddenIndicatorGroups, indicatorSettings, saveCurrentPreferences]);

  useEffect(() => {
    const handlePreferencesResetShortcut = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === 'F5') {
        resetCurrentPreferences();
      }
    };
    const handlePageHide = () => {
      if (chartViewSettingsSaveTimeoutRef.current !== null) {
        clearTimeout(chartViewSettingsSaveTimeoutRef.current);
        chartViewSettingsSaveTimeoutRef.current = null;
      }
      saveCurrentPreferences();
    };

    window.addEventListener('keydown', handlePreferencesResetShortcut, { capture: true });
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      if (chartViewSettingsSaveTimeoutRef.current !== null) {
        clearTimeout(chartViewSettingsSaveTimeoutRef.current);
      }
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('keydown', handlePreferencesResetShortcut, { capture: true });
    };
  }, [resetCurrentPreferences, saveCurrentPreferences]);

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
    const nextSettings = mergeIndicatorSettings(indicatorSettingsRef.current, updatedSettings);
    const nextGroups = hiddenIndicatorGroupsRef.current.filter((group) => (
      updatedSettings.some((setting) => setting.group === group && setting.visible)
    ));

    if (!areIndicatorSettingsEqual(indicatorSettingsRef.current, nextSettings)) {
      indicatorSettingsRef.current = nextSettings;
      setIndicatorSettings(nextSettings);
    }

    if (!areIndicatorGroupsEqual(hiddenIndicatorGroupsRef.current, nextGroups)) {
      hiddenIndicatorGroupsRef.current = nextGroups;
      setHiddenIndicatorGroups(nextGroups);
    }

    saveCurrentPreferences(nextSettings, nextGroups);
  }, [saveCurrentPreferences]);

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

  const handleChartViewSettingsChange = useCallback((updatedSettings: ChartViewSettings) => {
    const nextSettings = {
      ...chartViewSettingsRef.current,
      ...updatedSettings,
    };

    if (isChartViewSettingsEqual(chartViewSettingsRef.current, nextSettings)) return;

    chartViewSettingsRef.current = nextSettings;

    if (chartViewSettingsSaveTimeoutRef.current !== null) {
      clearTimeout(chartViewSettingsSaveTimeoutRef.current);
    }

    chartViewSettingsSaveTimeoutRef.current = setTimeout(() => {
      chartViewSettingsSaveTimeoutRef.current = null;
      saveCurrentPreferences();
    }, 250);
  }, [saveCurrentPreferences]);

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
    chartViewSettings: initialChartViewSettings,
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
    handleChartViewSettingsChange,
  };
}
