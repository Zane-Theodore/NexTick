import type { ChartPaneLayout, IndicatorGroup, IndicatorPriceSource, IndicatorSetting, SinglePeriodIndicatorSetting } from '../../types/chart';
import { cloneIndicatorSettings } from '../../utils/indicatorSettings';

export type IndicatorSettingsTab = 'main' | 'secondary';
export type SlotIndicatorGroup = 'ema' | 'ma' | 'volume-ma';

export const INDICATOR_GROUPS: Array<{ group: IndicatorGroup; label: string }> = [
  { group: 'ema', label: 'EMA' },
  { group: 'ma', label: 'MA' },
  { group: 'volume-ma', label: 'Vol MA' },
  { group: 'rsi', label: 'RSI' },
  { group: 'macd', label: 'MACD' },
];

export const INDICATOR_SETTINGS_TABS: Array<{ id: IndicatorSettingsTab; label: string; groups: IndicatorGroup[] }> = [
  { id: 'main', label: 'Main chart indicators', groups: ['ema', 'ma'] },
  { id: 'secondary', label: 'Sub-panel indicators', groups: ['volume-ma', 'rsi', 'macd'] },
];

export const PRICE_SOURCE_OPTIONS: Array<{ value: IndicatorPriceSource; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'high', label: 'High' },
  { value: 'low', label: 'Low' },
  { value: 'close', label: 'Close' },
];

export const LINE_WIDTH_OPTIONS = [1, 2, 3, 4] as const;

const MAX_INDICATOR_SLOTS = 10;
const SLOT_INDICATOR_GROUPS: IndicatorGroup[] = ['ema', 'ma', 'volume-ma'];
const SLOT_DEFAULT_PERIODS: Record<SlotIndicatorGroup, number[]> = {
  ema: [7, 25, 99],
  ma: [7, 25, 99],
  'volume-ma': [20],
};
const SLOT_DEFAULT_COLORS = [
  '#f5d90a',
  '#ff4ecd',
  '#00d4ff',
  '#e11d48',
  '#22c55e',
  '#f97316',
  '#8b5cf6',
  '#14b8a6',
  '#eab308',
  '#94a3b8',
];

export function getSettingsTabForGroup(group: IndicatorGroup): IndicatorSettingsTab {
  return INDICATOR_SETTINGS_TABS.find((tab) => tab.groups.includes(group))?.id ?? 'main';
}

export function resolveInitialGroup(settings: IndicatorSetting[]): IndicatorGroup | null {
  const groups = new Set(settings.map((setting) => setting.group));
  return INDICATOR_GROUPS.find(({ group }) => groups.has(group))?.group ?? null;
}

export function getLegendPaneIndex(group: IndicatorGroup, activeGroups: Set<IndicatorGroup>): number {
  if (group === 'volume-ma') return 1;
  if (group === 'rsi') return 2;
  if (group === 'macd') return activeGroups.has('rsi') ? 3 : 2;
  return 0;
}

export function getPaneLegendLayout(paneLayouts: ChartPaneLayout[], paneIndex: number): ChartPaneLayout {
  const paneLayout = paneLayouts.find((layout) => layout.index === paneIndex);

  if (paneLayout) return paneLayout;

  const fallbackLayout = paneLayouts.at(-1);
  if (fallbackLayout) return fallbackLayout;

  return {
    index: 0,
    top: 0,
    height: 120,
  };
}

export function getPaneLegendTop(paneLayout: ChartPaneLayout): number {
  return paneLayout.top + (paneLayout.index === 0 ? 34 : 6);
}

export function supportsIndicatorSlots(group: IndicatorGroup | null): group is SlotIndicatorGroup {
  return Boolean(group && SLOT_INDICATOR_GROUPS.includes(group));
}

export function buildSlotSettings(
  group: SlotIndicatorGroup,
  label: string,
  settings: IndicatorSetting[],
): SinglePeriodIndicatorSetting[] {
  const existingSettings = settings.filter((setting): setting is SinglePeriodIndicatorSetting => (
    setting.group === group
  ));

  return Array.from({ length: MAX_INDICATOR_SLOTS }, (_, index) => {
    const slot = index + 1;
    const existingSetting = existingSettings[index];

    if (existingSetting) {
      return existingSetting;
    }

    return {
      id: `${group}-slot-${slot}`,
      group,
      label,
      visible: false,
      period: getDefaultSlotPeriod(group, slot),
      source: 'close',
      lineWidth: 1,
      color: getDefaultSlotColor(slot),
    };
  });
}

export function getDefaultSlotPeriod(group: IndicatorGroup, slot: number): number {
  if (!supportsIndicatorSlots(group)) return 1;
  return SLOT_DEFAULT_PERIODS[group][slot - 1] ?? 0;
}

export function isZeroPeriodSetting(setting: IndicatorSetting): boolean {
  return 'period' in setting && setting.period <= 0;
}

export function cloneSettings(settings: IndicatorSetting[]): IndicatorSetting[] {
  return cloneIndicatorSettings(settings);
}

export function clampPeriod(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function getClampedSettingsWindowPosition(position: { x: number; y: number }) {
  if (typeof window === 'undefined') return position;

  const margin = 12;
  const windowWidth = Math.min(760, Math.max(320, window.innerWidth - (margin * 2)));
  const windowHeight = Math.min(560, Math.max(320, window.innerHeight - (margin * 2)));
  const maxX = Math.max(margin, window.innerWidth - windowWidth - margin);
  const maxY = Math.max(margin, window.innerHeight - windowHeight - margin);

  return {
    x: Math.min(maxX, Math.max(margin, position.x)),
    y: Math.min(maxY, Math.max(margin, position.y)),
  };
}

function getDefaultSlotColor(slot: number): string {
  return SLOT_DEFAULT_COLORS[(slot - 1) % SLOT_DEFAULT_COLORS.length];
}
