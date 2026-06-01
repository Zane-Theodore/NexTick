import { useEffect, useMemo, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';

import type { IndicatorGroup, IndicatorSetting, IndicatorValue, MacdIndicatorSetting, SinglePeriodIndicatorSetting } from '../../types/chart';
import { formatChartValue } from '../../utils/formatters';
import IndicatorEyeIcon from './IndicatorEyeIcon';

const INDICATOR_GROUPS: Array<{ group: IndicatorGroup; label: string }> = [
  { group: 'ema', label: 'EMA' },
  { group: 'ma', label: 'MA' },
  { group: 'volume-ma', label: 'Vol MA' },
  { group: 'rsi', label: 'RSI' },
  { group: 'macd', label: 'MACD' },
];

type IndicatorSettingsTab = 'main' | 'secondary';

const INDICATOR_SETTINGS_TABS: Array<{ id: IndicatorSettingsTab; label: string; groups: IndicatorGroup[] }> = [
  { id: 'main', label: 'Main', groups: ['ema', 'ma'] },
  { id: 'secondary', label: 'Secondary', groups: ['volume-ma', 'rsi', 'macd'] },
];

type SlotIndicatorGroup = 'ema' | 'ma' | 'volume-ma';

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

interface IndicatorLegendProps {
  settings: IndicatorSetting[];
  allSettings: IndicatorSetting[];
  allDefaultSettings: IndicatorSetting[];
  values: IndicatorValue[];
  hiddenGroups: IndicatorGroup[];
  isOpen: boolean;
  settingsWindow: { id: number; initialGroup: IndicatorGroup | null } | null;
  onToggleOpen: () => void;
  onToggleGroupVisibility: (group: IndicatorGroup) => void;
  onDismissGroup: (group: IndicatorGroup) => void;
  onOpenSettingsWindow: (group: IndicatorGroup | null) => void;
  onCloseSettingsWindow: () => void;
  onApplySettings: (settings: IndicatorSetting[]) => void;
}

export default function IndicatorLegend({
  settings,
  allSettings,
  allDefaultSettings,
  values,
  hiddenGroups,
  isOpen,
  settingsWindow,
  onToggleOpen,
  onToggleGroupVisibility,
  onDismissGroup,
  onOpenSettingsWindow,
  onCloseSettingsWindow,
  onApplySettings,
}: IndicatorLegendProps) {
  const groupedSettings = useMemo(() => (
    INDICATOR_GROUPS.map(({ group, label }) => ({
      group,
      label,
      settings: settings.filter((setting) => setting.group === group && setting.visible),
    })).filter(({ settings }) => settings.length > 0)
  ), [settings]);
  const settingsVisibilityKey = allSettings.map((setting) => `${setting.id}:${setting.visible ? 1 : 0}`).join('|');

  return (
    <>
      <div className="absolute left-0 top-2 z-10 flex max-w-[calc(100%-56px)] items-start">
        <button
          type="button"
          onClick={onToggleOpen}
          className="h-7 w-7 shrink-0 border border-transparent rounded-md text-[#d1d4dc] hover:border-[#6b7280] hover:text-white flex items-center justify-center transition-colors"
          title={isOpen ? 'Hide indicators' : 'Show indicators'}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`h-4 w-4 transition-transform duration-300 ease-out ${
              isOpen ? 'rotate-0' : '-rotate-90'
            }`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
          </svg>
        </button>

        <div
          className={`overflow-hidden transition-[max-width,opacity,transform] duration-300 ease-out ${
            isOpen ? 'max-w-[min(780px,calc(100vw-48px))] opacity-100 translate-x-0' : 'max-w-0 opacity-0 -translate-x-3'
          }`}
        >
          <div className="max-h-[calc(100vh-150px)] overflow-auto px-1.5 py-1 font-mono text-xs whitespace-nowrap">
            {groupedSettings.map(({ group, label, settings: groupSettings }) => (
              <IndicatorLegendRow
                key={group}
                group={group}
                label={label}
                settings={groupSettings}
                values={values}
                isHidden={hiddenGroups.includes(group)}
                onToggleVisibility={onToggleGroupVisibility}
                onOpenSettings={onOpenSettingsWindow}
                onDismiss={onDismissGroup}
              />
            ))}
          </div>
        </div>
      </div>

      {settingsWindow && (
        <IndicatorSettingsWindow
          key={`${settingsWindow.id}-${settingsVisibilityKey}`}
          initialGroup={settingsWindow.initialGroup}
          settings={allSettings}
          defaultSettings={allDefaultSettings}
          onApply={onApplySettings}
          onClose={onCloseSettingsWindow}
        />
      )}
    </>
  );
}

interface IndicatorSettingsWindowProps {
  initialGroup: IndicatorGroup | null;
  settings: IndicatorSetting[];
  defaultSettings: IndicatorSetting[];
  onApply: (settings: IndicatorSetting[]) => void;
  onClose: () => void;
}

function IndicatorSettingsWindow({
  initialGroup,
  settings,
  defaultSettings,
  onApply,
  onClose,
}: IndicatorSettingsWindowProps) {
  const resolvedInitialGroup = initialGroup ?? resolveInitialGroup(settings);
  const [activeGroup, setActiveGroup] = useState<IndicatorGroup | null>(resolvedInitialGroup);
  const [activeSettingsTab, setActiveSettingsTab] = useState<IndicatorSettingsTab>(
    resolvedInitialGroup ? getSettingsTabForGroup(resolvedInitialGroup) : 'main',
  );
  const [draftSettings, setDraftSettings] = useState<IndicatorSetting[]>(() => cloneSettings(settings));
  const [windowPosition, setWindowPosition] = useState({ x: 360, y: 96 });
  const [dragState, setDragState] = useState<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  const activeGroupLabel = INDICATOR_GROUPS.find((item) => item.group === activeGroup)?.label ?? 'Indicator';

  const settingsGroups = useMemo(() => (
    INDICATOR_GROUPS.map(({ group, label }) => ({
      group,
      label,
      settings: draftSettings.filter((setting) => setting.group === group),
    })).filter(({ settings }) => settings.length > 0)
  ), [draftSettings]);

  const activeTabGroups = useMemo(() => {
    const tab = INDICATOR_SETTINGS_TABS.find((item) => item.id === activeSettingsTab) ?? INDICATOR_SETTINGS_TABS[0];
    return settingsGroups.filter(({ group }) => tab.groups.includes(group));
  }, [activeSettingsTab, settingsGroups]);

  const activeDraftSettings = useMemo(() => (
    draftSettings.filter((setting) => setting.group === activeGroup)
  ), [activeGroup, draftSettings]);

  const updateDraftGroupSettings = (group: IndicatorGroup, nextGroupSettings: IndicatorSetting[]) => {
    setDraftSettings((currentSettings) => {
      const nextGroupSettingsById = new Map(nextGroupSettings.map((setting) => [setting.id, setting]));
      const currentSettingIds = new Set(currentSettings.map((setting) => setting.id));

      return [
        ...currentSettings.map((setting) => (
          setting.group === group ? nextGroupSettingsById.get(setting.id) ?? setting : setting
        )),
        ...nextGroupSettings.filter((setting) => !currentSettingIds.has(setting.id)),
      ];
    });
  };

  const setGroupVisibility = (group: IndicatorGroup, visible: boolean) => {
    setDraftSettings((currentSettings) => currentSettings.map((setting) => (
      setting.group === group ? { ...setting, visible: visible && !isZeroPeriodSetting(setting) } : setting
    )));
  };

  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (event: MouseEvent) => {
      setWindowPosition({
        x: Math.max(8, dragState.originX + event.clientX - dragState.startX),
        y: Math.max(8, dragState.originY + event.clientY - dragState.startY),
      });
    };

    const handleMouseUp = () => setDragState(null);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState]);

  const handleSettingsTabChange = (tab: IndicatorSettingsTab) => {
    setActiveSettingsTab(tab);
    const firstGroupInTab = settingsGroups.find(({ group }) => (
      INDICATOR_SETTINGS_TABS.find((item) => item.id === tab)?.groups.includes(group)
    ))?.group;

    if (firstGroupInTab) {
      setActiveGroup(firstGroupInTab);
    }
  };

  const handleApply = () => {
    onApply(draftSettings);
    onClose();
  };

  const handleReset = () => {
    if (!activeGroup) return;

    if (supportsIndicatorSlots(activeGroup)) {
      const currentSlots = buildSlotSettings(
        activeGroup,
        activeGroupLabel,
        draftSettings.filter((setting) => setting.group === activeGroup),
      );
      const defaultSlots = buildSlotSettings(
        activeGroup,
        activeGroupLabel,
        defaultSettings.filter((setting) => setting.group === activeGroup),
      ).map((setting, index) => ({
        ...setting,
        visible: currentSlots[index]?.visible ?? setting.visible,
      }));

      setDraftSettings((currentSettings) => [
        ...currentSettings.filter((setting) => setting.group !== activeGroup),
        ...defaultSlots,
      ]);
      return;
    }

    const currentById = new Map(draftSettings.map((setting) => [setting.id, setting]));
    const defaults = cloneSettings(defaultSettings.filter((setting) => setting.group === activeGroup)).map((setting) => {
      const currentSetting = currentById.get(setting.id);
      return currentSetting ? { ...setting, visible: currentSetting.visible } : setting;
    });

    const defaultsById = new Map(defaults.map((setting) => [setting.id, setting]));
    setDraftSettings((currentSettings) => currentSettings.map((setting) => (
      defaultsById.get(setting.id) ?? setting
    )));
  };

  const handleHeaderMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragState({
      startX: event.clientX,
      startY: event.clientY,
      originX: windowPosition.x,
      originY: windowPosition.y,
    });
  };

  if (!activeGroup) return null;

  return (
    <div
      className="fixed z-50 flex max-h-[min(560px,calc(100vh-24px))] w-[min(760px,calc(100vw-24px))] flex-col overflow-hidden rounded-lg border border-[#2f3745] bg-[#1b222d] shadow-2xl shadow-black/60"
      style={{ left: windowPosition.x, top: windowPosition.y }}
    >
      <div
        className="flex h-10 shrink-0 cursor-move select-none items-center justify-between border-b border-[#303846] bg-[#1f2632] px-4"
        onMouseDown={handleHeaderMouseDown}
      >
        <div className="flex h-full items-end gap-5">
          {INDICATOR_SETTINGS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleSettingsTabChange(tab.id)}
              className={`relative h-full px-0 text-sm font-semibold transition-colors ${
                activeSettingsTab === tab.id ? 'text-[#eef2f7]' : 'text-[#8f99a8] hover:text-[#d1d6df]'
              }`}
            >
              {tab.label}
              {activeSettingsTab === tab.id && (
                <span className="absolute bottom-0 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-[#f0b90b]" />
              )}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-transparent text-[#d1d6df] transition-colors hover:border-[#6b7280] hover:text-white"
          title="Close settings"
        >
          <CloseIcon />
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[150px_minmax(0,1fr)] bg-[#1b222d]">
        <div className="min-h-0 overflow-auto border-r border-[#303846] bg-[#202734] py-3">
          <div className="px-4 pb-2 text-xs font-semibold text-[#d1d6df]">
            {activeSettingsTab === 'main' ? 'Main' : 'Sub'}
          </div>
          <div className="flex flex-col">
            {activeTabGroups.map(({ group, label, settings: groupSettings }) => {
              const isVisible = groupSettings.some((setting) => setting.visible);
              const isActive = activeGroup === group;

              return (
                <div
                  key={group}
                  className={`flex h-10 items-center gap-2 px-4 py-2 transition-colors ${
                    isActive ? 'bg-[#2a3341]' : 'hover:bg-[#252d3a]'
                  }`}
                >
                  <VisibilityCheckbox
                    checked={isVisible}
                    onChange={(visible) => setGroupVisibility(group, visible)}
                    label={`${isVisible ? 'Hide' : 'Show'} ${label}`}
                  />
                  <button
                    type="button"
                    onClick={() => setActiveGroup(group)}
                    className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left text-sm font-semibold text-[#d1d6df]"
                  >
                    <span className="truncate">{label}</span>
                    <ChevronRightIcon />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex min-w-0 min-h-0 flex-col bg-[#1b222d]">
          <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
            <div className="mb-3 text-sm font-semibold text-[#eef2f7]">{activeGroupLabel}</div>
            <IndicatorSettingsForm
              group={activeGroup}
              groupLabel={activeGroupLabel}
              settings={activeDraftSettings}
              onChange={(nextGroupSettings) => {
                if (activeGroup) {
                  updateDraftGroupSettings(activeGroup, nextGroupSettings);
                }
              }}
            />
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[#303846] bg-[#1b222d] px-4 py-2.5">
            <button
              type="button"
              onClick={handleReset}
              className="h-8 min-w-28 rounded-md bg-[#354050] px-4 text-sm font-semibold text-[#eef2f7] transition-colors hover:bg-[#3f4b5e]"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="h-8 min-w-28 rounded-md bg-[#f0b90b] px-4 text-sm font-semibold text-[#111722] transition-colors hover:bg-[#f8d12f]"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface IndicatorLegendRowProps {
  group: IndicatorGroup;
  label: string;
  settings: IndicatorSetting[];
  values: IndicatorValue[];
  isHidden: boolean;
  onToggleVisibility: (group: IndicatorGroup) => void;
  onOpenSettings: (group: IndicatorGroup) => void;
  onDismiss: (group: IndicatorGroup) => void;
}

function IndicatorLegendRow({
  group,
  label,
  settings,
  values,
  isHidden,
  onToggleVisibility,
  onOpenSettings,
  onDismiss,
}: IndicatorLegendRowProps) {
  return (
    <div className="group min-h-6 flex flex-nowrap items-center gap-x-3 rounded-md border border-transparent px-1 transition-colors duration-200 hover:border-[#6b7280]">
      <span className="w-16 shrink-0 text-[#d1d4dc]">{label}</span>

      <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-x-3 overflow-hidden">
        {group === 'macd'
          ? <MacdLegendValues settings={settings} values={values} />
          : settings.map((setting) => (
            <SingleLegendValue key={setting.id} setting={setting as SinglePeriodIndicatorSetting} values={values} />
          ))}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1 opacity-0 pointer-events-none transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
        <button
          type="button"
          onClick={() => onToggleVisibility(group)}
          className="h-5 w-5 text-[#9099aa] hover:text-white flex items-center justify-center transition-colors"
          title={isHidden ? `Show ${label}` : `Hide ${label}`}
        >
          <IndicatorEyeIcon isVisible={!isHidden} />
        </button>
        <button
          type="button"
          onClick={() => onOpenSettings(group)}
          className="h-5 w-5 text-[#9099aa] hover:text-white flex items-center justify-center transition-colors"
          title={`${label} settings`}
        >
          <GearIcon />
        </button>
        <button
          type="button"
          onClick={() => onDismiss(group)}
          className="h-5 w-5 text-[#9099aa] hover:text-white flex items-center justify-center transition-colors"
          title={`Remove ${label} until reload`}
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}

function SingleLegendValue({
  setting,
  values,
}: {
  setting: SinglePeriodIndicatorSetting;
  values: IndicatorValue[];
}) {
  const indicatorValue = values.find((value) => value.id === setting.id);

  return (
    <span style={{ color: setting.color }} className="whitespace-nowrap">
      {setting.label}({setting.period}): {indicatorValue ? formatChartValue(indicatorValue.value) : '--'}
    </span>
  );
}

function MacdLegendValues({
  settings,
  values,
}: {
  settings: IndicatorSetting[];
  values: IndicatorValue[];
}) {
  const macdSetting = settings[0] as MacdIndicatorSetting | undefined;
  if (!macdSetting) return null;

  const macdValue = values.find((value) => value.id === `${macdSetting.id}-macd`);
  const signalValue = values.find((value) => value.id === `${macdSetting.id}-signal`);

  return (
    <>
      <span style={{ color: macdSetting.macdColor }} className="whitespace-nowrap">
        MACD({macdSetting.fastPeriod},{macdSetting.slowPeriod}): {macdValue ? formatChartValue(macdValue.value) : '--'}
      </span>
      <span style={{ color: macdSetting.signalColor }} className="whitespace-nowrap">
        Signal({macdSetting.signalPeriod}): {signalValue ? formatChartValue(signalValue.value) : '--'}
      </span>
    </>
  );
}

function IndicatorSettingsForm({
  group,
  groupLabel,
  settings,
  onChange,
}: {
  group: IndicatorGroup;
  groupLabel: string;
  settings: IndicatorSetting[];
  onChange: (settings: IndicatorSetting[]) => void;
}) {
  const editableSettings = supportsIndicatorSlots(group)
    ? buildSlotSettings(group, groupLabel, settings)
    : settings;

  if (editableSettings.length === 0) {
    return <div className="text-sm text-[#9099aa]">No settings available.</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      {editableSettings.map((setting, index) => (
        setting.group === 'macd'
          ? (
            <MacdSettingsEditor
              key={setting.id}
              setting={setting}
              onChange={(nextSetting) => onChange(editableSettings.map((item) => item.id === nextSetting.id ? nextSetting : item))}
            />
          )
          : (
            <SingleSettingsEditor
              key={setting.id}
              setting={setting}
              rowLabel={supportsIndicatorSlots(group) ? `${groupLabel}${index + 1}` : `${setting.label}${setting.period}`}
              defaultPeriod={getDefaultSlotPeriod(group, index + 1)}
              onChange={(nextSetting) => onChange(editableSettings.map((item) => item.id === nextSetting.id ? nextSetting : item))}
            />
          )
      ))}
    </div>
  );
}

function SingleSettingsEditor({
  setting,
  rowLabel,
  defaultPeriod,
  onChange,
}: {
  setting: SinglePeriodIndicatorSetting;
  rowLabel: string;
  defaultPeriod: number;
  onChange: (setting: SinglePeriodIndicatorSetting) => void;
}) {
  return (
    <div className="grid grid-cols-[28px_minmax(54px,0.8fr)_72px_92px_104px_44px] items-center gap-2">
      <VisibilityCheckbox
        checked={setting.visible}
        onChange={(visible) => onChange({
          ...setting,
          visible,
          period: visible && setting.period <= 0 ? Math.max(1, defaultPeriod) : setting.period,
        })}
        label={`Show ${rowLabel}`}
      />
      <span className="text-sm font-semibold text-[#d1d6df]">{rowLabel}</span>
      <NumberInput value={setting.period} min={1} max={250} onChange={(period) => onChange({ ...setting, period })} />
      <StaticSelect label="Close" />
      <LineStyleSelect />
      <ColorInput value={setting.color} onChange={(color) => onChange({ ...setting, color })} />
    </div>
  );
}

function MacdSettingsEditor({
  setting,
  onChange,
}: {
  setting: MacdIndicatorSetting;
  onChange: (setting: MacdIndicatorSetting) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[32px_1fr] items-center gap-3">
        <VisibilityCheckbox
          checked={setting.visible}
          onChange={(visible) => onChange({ ...setting, visible })}
          label={`Show ${setting.label}`}
        />
        <span className="text-sm font-semibold text-[#d1d6df]">{setting.label}</span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Fast">
          <NumberInput value={setting.fastPeriod} min={1} max={99} onChange={(fastPeriod) => onChange({ ...setting, fastPeriod })} />
        </Field>
        <Field label="Slow">
          <NumberInput value={setting.slowPeriod} min={2} max={250} onChange={(slowPeriod) => onChange({ ...setting, slowPeriod })} />
        </Field>
        <Field label="Signal">
          <NumberInput value={setting.signalPeriod} min={1} max={99} onChange={(signalPeriod) => onChange({ ...setting, signalPeriod })} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="MACD">
          <ColorInput value={setting.macdColor} onChange={(macdColor) => onChange({ ...setting, macdColor })} />
        </Field>
        <Field label="Signal">
          <ColorInput value={setting.signalColor} onChange={(signalColor) => onChange({ ...setting, signalColor })} />
        </Field>
      </div>
    </div>
  );
}

function VisibilityCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex h-8 w-7 cursor-pointer items-center justify-center" title={label}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="sr-only"
        aria-label={label}
      />
      <span className={`flex h-5 w-5 items-center justify-center rounded border transition-colors ${
        checked
          ? 'border-[#eef2f7] bg-[#eef2f7] text-[#1b222d]'
          : 'border-[#748094] bg-transparent text-transparent'
      }`}>
        <CheckIcon />
      </span>
    </label>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold uppercase text-[#9099aa]">
      {label}
      {children}
    </label>
  );
}

function StaticSelect({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="flex h-8 items-center justify-between rounded-md border border-[#3f4857] bg-[#252e3b] px-2.5 text-sm font-semibold text-[#eef2f7]"
      tabIndex={-1}
    >
      <span>{label}</span>
      <ChevronDownIcon />
    </button>
  );
}

function LineStyleSelect() {
  return (
    <button
      type="button"
      className="flex h-8 items-center justify-between rounded-md border border-[#3f4857] bg-[#1b222d] px-2.5 text-[#eef2f7]"
      tabIndex={-1}
    >
      <span className="h-px w-12 bg-current" />
      <ChevronDownIcon />
    </button>
  );
}

function NumberInput({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(event) => onChange(clampPeriod(Number(event.target.value), min, max))}
      className="h-8 w-full rounded-md border border-transparent bg-[#252e3b] px-2.5 text-sm font-semibold text-[#eef2f7] outline-none transition-colors focus:border-[#6b7280]"
    />
  );
}

function ColorInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      type="color"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 w-8 cursor-pointer rounded-md border border-[#3f4857] bg-[#252e3b] p-0.5"
    />
  );
}

function GearIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M11.49 2.17a1 1 0 00-2 0l-.08.88a7.94 7.94 0 00-1.32.55l-.68-.57a1 1 0 00-1.41.07L4.6 4.5a1 1 0 00-.07 1.41l.57.68c-.22.42-.4.86-.55 1.32l-.88.08a1 1 0 000 2l.88.08c.15.46.33.9.55 1.32l-.57.68a1 1 0 00.07 1.41l1.4 1.4a1 1 0 001.41.07l.68-.57c.42.22.86.4 1.32.55l.08.88a1 1 0 002 0l.08-.88c.46-.15.9-.33 1.32-.55l.68.57a1 1 0 001.41-.07l1.4-1.4a1 1 0 00.07-1.41l-.57-.68c.22-.42.4-.86.55-1.32l.88-.08a1 1 0 000-2l-.88-.08a7.94 7.94 0 00-.55-1.32l.57-.68a1 1 0 00-.07-1.41l-1.4-1.4a1 1 0 00-1.41-.07l-.68.57c-.42-.22-.86-.4-1.32-.55l-.08-.88zM10.5 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" clipRule="evenodd" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M6.22 5.22a.75.75 0 011.06 0L10 7.94l2.72-2.72a.75.75 0 111.06 1.06L11.06 9l2.72 2.72a.75.75 0 11-1.06 1.06L10 10.06l-2.72 2.72a.75.75 0 01-1.06-1.06L8.94 9 6.22 6.28a.75.75 0 010-1.06z" clipRule="evenodd" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M7.22 4.22a.75.75 0 011.06 0l5.25 5.25a.75.75 0 010 1.06l-5.25 5.25a.75.75 0 11-1.06-1.06L11.94 10 7.22 5.28a.75.75 0 010-1.06z" clipRule="evenodd" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg className="h-4 w-4 shrink-0 text-[#8f99a8]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M5.22 7.22a.75.75 0 011.06 0L10 10.94l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 8.28a.75.75 0 010-1.06z" clipRule="evenodd" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.25 7.25a1 1 0 01-1.4 0L4 9.9a1 1 0 111.4-1.4l3.35 3.34L15.3 5.3a1 1 0 011.4 0z" clipRule="evenodd" />
    </svg>
  );
}

function getSettingsTabForGroup(group: IndicatorGroup): IndicatorSettingsTab {
  return INDICATOR_SETTINGS_TABS.find((tab) => tab.groups.includes(group))?.id ?? 'main';
}

function resolveInitialGroup(settings: IndicatorSetting[]): IndicatorGroup | null {
  const groups = new Set(settings.map((setting) => setting.group));
  return INDICATOR_GROUPS.find(({ group }) => groups.has(group))?.group ?? null;
}

function supportsIndicatorSlots(group: IndicatorGroup | null): group is SlotIndicatorGroup {
  return Boolean(group && SLOT_INDICATOR_GROUPS.includes(group));
}

function buildSlotSettings(
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
      color: getDefaultSlotColor(slot),
    };
  });
}

function getDefaultSlotPeriod(group: IndicatorGroup, slot: number): number {
  if (!supportsIndicatorSlots(group)) return 1;
  return SLOT_DEFAULT_PERIODS[group][slot - 1] ?? 0;
}

function getDefaultSlotColor(slot: number): string {
  return SLOT_DEFAULT_COLORS[(slot - 1) % SLOT_DEFAULT_COLORS.length];
}

function isZeroPeriodSetting(setting: IndicatorSetting): boolean {
  return 'period' in setting && setting.period <= 0;
}

function cloneSettings(settings: IndicatorSetting[]): IndicatorSetting[] {
  return settings.map((setting) => ({ ...setting }));
}

function clampPeriod(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
