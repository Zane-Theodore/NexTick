import type { LogicalRange } from 'lightweight-charts';

import type { IndicatorGroup, IndicatorPriceSource, IndicatorSetting } from '../../types/chart';
import { cloneIndicatorSettings } from '../../utils/indicatorSettings';

export interface ChartPaneStretchFactors {
  main: number;
  volume: number;
}

export interface ChartViewSettings {
  barSpacing?: number;
  paneStretchFactors?: ChartPaneStretchFactors;
}

export interface TradingChartPreferences {
  indicatorSettings?: IndicatorSetting[];
  hiddenIndicatorGroups?: IndicatorGroup[];
  chartViewSettings?: ChartViewSettings;
}

const STORAGE_KEY = 'nextick:trading-chart:preferences:v1';
const MIN_BAR_SPACING = 1;
const MAX_BAR_SPACING = 200;
const MIN_PANE_STRETCH_FACTOR = 1;
const MAX_PANE_STRETCH_FACTOR = 1000;

const INDICATOR_GROUPS: IndicatorGroup[] = ['ema', 'ma', 'volume-ma', 'rsi', 'macd'];
const PRICE_SOURCES: IndicatorPriceSource[] = ['open', 'high', 'low', 'close'];
const LINE_WIDTHS = [1, 2, 3, 4];

export function loadTradingChartPreferences(): TradingChartPreferences {
  const storage = getStorage();
  if (!storage) return {};

  try {
    const rawPreferences = storage.getItem(STORAGE_KEY);
    if (!rawPreferences) return {};

    return normalizePreferences(JSON.parse(rawPreferences));
  } catch {
    storage.removeItem(STORAGE_KEY);
    return {};
  }
}

export function saveTradingChartPreferences(preferences: TradingChartPreferences) {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Browser storage can be unavailable or full; chart preferences are non-critical.
  }
}

export function clearTradingChartPreferences() {
  getStorage()?.removeItem(STORAGE_KEY);
}

export function isChartViewSettingsEqual(currentSettings: ChartViewSettings, nextSettings: ChartViewSettings) {
  return (
    normalizeBarSpacing(currentSettings.barSpacing) === normalizeBarSpacing(nextSettings.barSpacing)
    && arePaneStretchFactorsEqual(currentSettings.paneStretchFactors, nextSettings.paneStretchFactors)
  );
}

export function isLogicalRangeZoomChange(currentRange: LogicalRange | null, nextRange: LogicalRange | null) {
  if (!currentRange || !nextRange) return Boolean(currentRange || nextRange);

  return Math.abs(getLogicalRangeSize(currentRange) - getLogicalRangeSize(nextRange)) > 0.01;
}

function normalizePreferences(value: unknown): TradingChartPreferences {
  if (!isRecord(value)) return {};

  return {
    indicatorSettings: normalizeIndicatorSettings(value.indicatorSettings),
    hiddenIndicatorGroups: normalizeHiddenIndicatorGroups(value.hiddenIndicatorGroups),
    chartViewSettings: normalizeChartViewSettings(value.chartViewSettings),
  };
}

function normalizeIndicatorSettings(value: unknown): IndicatorSetting[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const settings = value.filter(isIndicatorSetting);
  return settings.length === value.length ? cloneIndicatorSettings(settings) : undefined;
}

function normalizeHiddenIndicatorGroups(value: unknown): IndicatorGroup[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const groups = value.filter(isIndicatorGroup);
  return groups.length === value.length ? [...new Set(groups)] : undefined;
}

function normalizeChartViewSettings(value: unknown): ChartViewSettings | undefined {
  if (!isRecord(value)) return undefined;

  return {
    barSpacing: normalizeBarSpacing(value.barSpacing),
    paneStretchFactors: normalizePaneStretchFactors(value.paneStretchFactors),
  };
}

function normalizeBarSpacing(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return clamp(value, MIN_BAR_SPACING, MAX_BAR_SPACING);
}

function normalizePaneStretchFactors(value: unknown): ChartPaneStretchFactors | undefined {
  if (!isRecord(value)) return undefined;

  const main = normalizePaneStretchFactor(value.main);
  const volume = normalizePaneStretchFactor(value.volume);

  return main && volume ? { main, volume } : undefined;
}

function normalizePaneStretchFactor(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return clamp(Math.round(value), MIN_PANE_STRETCH_FACTOR, MAX_PANE_STRETCH_FACTOR);
}

function arePaneStretchFactorsEqual(
  currentFactors: ChartPaneStretchFactors | undefined,
  nextFactors: ChartPaneStretchFactors | undefined,
) {
  if (!currentFactors || !nextFactors) return currentFactors === nextFactors;

  return (
    Math.abs(currentFactors.main - nextFactors.main) <= 1
    && Math.abs(currentFactors.volume - nextFactors.volume) <= 1
  );
}

function isIndicatorSetting(value: unknown): value is IndicatorSetting {
  if (!isRecord(value)) return false;
  if (!isIndicatorGroup(value.group)) return false;
  if (typeof value.id !== 'string' || typeof value.label !== 'string') return false;
  if (typeof value.visible !== 'boolean') return false;
  if (!isPriceSource(value.source) || !isLineWidth(value.lineWidth)) return false;

  if (value.group === 'macd') {
    return (
      isPositiveNumber(value.fastPeriod)
      && isPositiveNumber(value.slowPeriod)
      && isPositiveNumber(value.signalPeriod)
      && typeof value.macdColor === 'string'
      && typeof value.signalColor === 'string'
    );
  }

  return (
    isSinglePeriodValue(value.period, value.visible)
    && typeof value.color === 'string'
  );
}

function isIndicatorGroup(value: unknown): value is IndicatorGroup {
  return typeof value === 'string' && INDICATOR_GROUPS.includes(value as IndicatorGroup);
}

function isPriceSource(value: unknown): value is IndicatorPriceSource {
  return typeof value === 'string' && PRICE_SOURCES.includes(value as IndicatorPriceSource);
}

function isLineWidth(value: unknown): value is IndicatorSetting['lineWidth'] {
  return typeof value === 'number' && LINE_WIDTHS.includes(value);
}

function isPositiveNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isSinglePeriodValue(value: unknown, isVisible: boolean) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  return isVisible ? value > 0 : value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getLogicalRangeSize(range: LogicalRange) {
  return range.to - range.from;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getStorage() {
  if (typeof window === 'undefined') return null;

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
