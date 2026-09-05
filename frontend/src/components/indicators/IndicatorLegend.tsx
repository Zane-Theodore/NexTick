import { useEffect, useMemo, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';

import type { ChartPaneLayout, IndicatorGroup, IndicatorPriceSource, IndicatorSetting, IndicatorValue, MacdIndicatorSetting, SinglePeriodIndicatorSetting } from '../../types/chart';
import { formatChartValue } from '../../utils/formatters';
import { mergeIndicatorSettings } from '../../utils/indicatorSettings';
import IndicatorEyeIcon from './IndicatorEyeIcon';
import {
  INDICATOR_GROUPS,
  INDICATOR_SETTINGS_TABS,
  LINE_WIDTH_OPTIONS,
  PRICE_SOURCE_OPTIONS,
  buildSlotSettings,
  clampPeriod,
  cloneSettings,
  getClampedSettingsWindowPosition,
  getDefaultSlotPeriod,
  getLegendPaneIndex,
  getPaneLegendLayout,
  getPaneLegendTop,
  getSettingsTabForGroup,
  isZeroPeriodSetting,
  resolveInitialGroup,
  supportsIndicatorSlots,
} from './indicatorSettingsModel';
import type { IndicatorSettingsTab } from './indicatorSettingsModel';

interface IndicatorLegendProps {
  settings: IndicatorSetting[];
  allSettings: IndicatorSetting[];
  allDefaultSettings: IndicatorSetting[];
  values: IndicatorValue[];
  hiddenGroups: IndicatorGroup[];
  paneLayouts: ChartPaneLayout[];
  mainPaneTopOffset: number;
  settingsWindow: { id: number; initialGroup: IndicatorGroup | null } | null;
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
  paneLayouts,
  mainPaneTopOffset,
  settingsWindow,
  onToggleGroupVisibility,
  onDismissGroup,
  onOpenSettingsWindow,
  onCloseSettingsWindow,
  onApplySettings,
}: IndicatorLegendProps) {
  const [collapsedPaneIndexes, setCollapsedPaneIndexes] = useState<number[]>([]);
  const activeGroups = useMemo(() => new Set(
    settings
      .filter((setting) => setting.visible && !hiddenGroups.includes(setting.group))
      .map((setting) => setting.group),
  ), [hiddenGroups, settings]);
  const groupedSettings = useMemo(() => (
    INDICATOR_GROUPS.map(({ group, label }) => ({
      group,
      label,
      paneIndex: getLegendPaneIndex(group, activeGroups),
      settings: settings.filter((setting) => setting.group === group && setting.visible),
    })).filter(({ settings }) => settings.length > 0)
  ), [activeGroups, settings]);
  const paneLegendGroups = useMemo(() => {
    const groupsByPane = new Map<number, typeof groupedSettings>();

    groupedSettings.forEach((groupSettings) => {
      const paneGroups = groupsByPane.get(groupSettings.paneIndex) ?? [];
      groupsByPane.set(groupSettings.paneIndex, [...paneGroups, groupSettings]);
    });

    return Array.from(groupsByPane.entries())
      .map(([paneIndex, groups]) => ({ paneIndex, groups }))
      .sort((a, b) => a.paneIndex - b.paneIndex);
  }, [groupedSettings]);
  const settingsVisibilityKey = allSettings.map((setting) => `${setting.id}:${setting.visible ? 1 : 0}`).join('|');
  const handleTogglePaneLegend = (paneIndex: number) => {
    setCollapsedPaneIndexes((currentIndexes) => (
      currentIndexes.includes(paneIndex)
        ? currentIndexes.filter((currentIndex) => currentIndex !== paneIndex)
        : [...currentIndexes, paneIndex]
    ));
  };

  return (
    <>
      {paneLegendGroups.map(({ paneIndex, groups }) => {
        const paneLayout = getPaneLegendLayout(paneLayouts, paneIndex);

        return (
          <PaneIndicatorLegend
            key={paneIndex}
            paneLayout={paneLayout}
            groups={groups}
            values={values}
            hiddenGroups={hiddenGroups}
            top={paneIndex === 0 ? paneLayout.top + mainPaneTopOffset : getPaneLegendTop(paneLayout)}
            isOpen={!collapsedPaneIndexes.includes(paneIndex)}
            onToggleOpen={() => handleTogglePaneLegend(paneIndex)}
            onToggleGroupVisibility={onToggleGroupVisibility}
            onOpenSettingsWindow={onOpenSettingsWindow}
            onDismissGroup={onDismissGroup}
          />
        );
      })}

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

interface PaneIndicatorLegendProps {
  paneLayout: ChartPaneLayout;
  groups: Array<{
    group: IndicatorGroup;
    label: string;
    settings: IndicatorSetting[];
  }>;
  values: IndicatorValue[];
  hiddenGroups: IndicatorGroup[];
  top: number;
  isOpen: boolean;
  onToggleOpen: () => void;
  onToggleGroupVisibility: (group: IndicatorGroup) => void;
  onOpenSettingsWindow: (group: IndicatorGroup) => void;
  onDismissGroup: (group: IndicatorGroup) => void;
}

function PaneIndicatorLegend({
  paneLayout,
  groups,
  values,
  hiddenGroups,
  top,
  isOpen,
  onToggleOpen,
  onToggleGroupVisibility,
  onOpenSettingsWindow,
  onDismissGroup,
}: PaneIndicatorLegendProps) {
  return (
    <div
      className="pointer-events-none absolute left-0 right-20 z-10 flex items-start"
      style={{ top, containerType: 'inline-size' }}
    >
      <button
        type="button"
        onClick={onToggleOpen}
        className="pointer-events-auto h-7 w-7 shrink-0 border border-transparent rounded-md text-[#d1d4dc] hover:border-[#6b7280] hover:text-white flex items-center justify-center transition-colors"
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
        className={`min-w-0 overflow-hidden transition-[max-width,opacity,transform] duration-300 ease-out ${
          isOpen ? 'max-w-[min(780px,calc(100%-28px))] opacity-100 translate-x-0' : 'max-w-0 opacity-0 -translate-x-3'
        }`}
      >
        <div
          className="w-[min(780px,calc(100cqw-28px))] overflow-auto px-1.5 py-1 font-mono text-[11px]"
          style={{ maxHeight: Math.max(36, paneLayout.height - (top - paneLayout.top) - 6) }}
        >
          {groups.map(({ group, label, settings: groupSettings }) => (
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
  const [windowPosition, setWindowPosition] = useState(() => getClampedSettingsWindowPosition({ x: 360, y: 96 }));
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
      return mergeIndicatorSettings(
        currentSettings,
        nextGroupSettings.filter((setting) => setting.group === group),
      );
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
      setWindowPosition(getClampedSettingsWindowPosition({
        x: Math.max(8, dragState.originX + event.clientX - dragState.startX),
        y: Math.max(8, dragState.originY + event.clientY - dragState.startY),
      }));
    };

    const handleMouseUp = () => setDragState(null);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState]);

  useEffect(() => {
    const handleResize = () => {
      setWindowPosition((position) => getClampedSettingsWindowPosition(position));
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
      className="fixed z-50 flex max-h-[min(560px,calc(100vh-24px))] w-[min(760px,calc(100vw-24px))] flex-col overflow-hidden rounded-lg border border-[#3f4654] bg-[#10141c] shadow-2xl shadow-black/60"
      style={{ left: windowPosition.x, top: windowPosition.y }}
    >
      <div
        className="flex h-11 shrink-0 cursor-move select-none items-center justify-between border-b border-[#3f4654] bg-[#10141c] px-3"
        onMouseDown={handleHeaderMouseDown}
      >
        <div className="flex gap-4">
          {INDICATOR_SETTINGS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleSettingsTabChange(tab.id)}
              className={`h-8 rounded px-2 text-sm font-semibold outline-none transition-colors ${
                activeSettingsTab === tab.id
                  ? 'text-white'
                  : 'text-[#9099aa] hover:text-white focus:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded border border-transparent text-[#9099aa] transition-colors hover:border-[#6b7280] hover:text-white focus:border-[#6b7280] focus:text-white"
          title="Close settings"
        >
          <CloseIcon />
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[154px_minmax(0,1fr)] bg-[#0f1117]">
        <div className="min-h-0 overflow-auto border-r border-[#3f4654] bg-[#151a23] py-3">
          <div className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-[#9099aa]">
            {activeSettingsTab === 'main' ? 'Main chart' : 'Sub panels'}
          </div>
          <div className="flex flex-col">
            {activeTabGroups.map(({ group, label, settings: groupSettings }) => {
              const isVisible = groupSettings.some((setting) => setting.visible);
              const isActive = activeGroup === group;

              return (
                <div
                  key={group}
                  className={`mx-2 flex h-10 items-center gap-2 rounded px-2 py-2 transition-colors ${
                    isActive ? 'bg-[#24466a]' : 'hover:bg-[#1b2f49]'
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
                    className={`flex min-w-0 flex-1 items-center justify-between gap-2 text-left text-sm font-semibold ${
                      isActive ? 'text-white' : 'text-[#d1d4dc]'
                    }`}
                  >
                    <span className="truncate">{label}</span>
                    <ChevronRightIcon />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex min-w-0 min-h-0 flex-col bg-[#10141c]">
          <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
            <div className="mb-3 border-b border-[#3f4654] pb-2 text-sm font-semibold text-[#d1d4dc]">{activeGroupLabel}</div>
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

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[#3f4654] bg-[#10141c] px-4 py-2.5">
            <button
              type="button"
              onClick={handleReset}
              className="h-8 min-w-28 rounded border border-[#3f4654] bg-[#151a23] px-4 text-sm font-semibold text-[#d1d4dc] transition-colors hover:border-[#6b7280] hover:text-white"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="h-8 min-w-28 rounded bg-[#24466a] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1b2f49]"
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
    <div className="group pointer-events-auto flex min-h-6 w-fit max-w-full items-center rounded-md border border-transparent px-1 transition-colors duration-200 hover:border-[#6b7280]">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4">
        {group === 'macd'
          ? <MacdLegendValues settings={settings} values={values} />
          : settings.map((setting) => (
            <SingleLegendValue key={setting.id} setting={setting as SinglePeriodIndicatorSetting} values={values} />
          ))}
      </div>

      <div className="ml-2 flex shrink-0 items-center gap-1 opacity-0 pointer-events-none transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
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
    <span className="whitespace-nowrap text-white">
      {setting.label}({setting.period}):{' '}
      <span style={{ color: setting.color }}>
        {indicatorValue ? formatChartValue(indicatorValue.value) : '--'}
      </span>
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
      <span className="whitespace-nowrap text-white">
        MACD({macdSetting.fastPeriod},{macdSetting.slowPeriod}):{' '}
        <span style={{ color: macdSetting.macdColor }}>
          {macdValue ? formatChartValue(macdValue.value) : '--'}
        </span>
      </span>
      <span className="whitespace-nowrap text-white">
        Signal({macdSetting.signalPeriod}):{' '}
        <span style={{ color: macdSetting.signalColor }}>
          {signalValue ? formatChartValue(signalValue.value) : '--'}
        </span>
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
  const isVolumeMa = setting.group === 'volume-ma';

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
      <span className="text-sm font-semibold text-[#d1d4dc]">{rowLabel}</span>
      <NumberInput value={setting.period} min={1} max={250} onChange={(period) => onChange({ ...setting, period })} />
      <SourceSelect
        value={setting.source}
        isVolumeMa={isVolumeMa}
        onChange={(source) => onChange({ ...setting, source })}
      />
      <LineWidthSelect value={setting.lineWidth} onChange={(lineWidth) => onChange({ ...setting, lineWidth })} />
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
        <span className="text-sm font-semibold text-[#d1d4dc]">{setting.label}</span>
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
      <div className="grid grid-cols-4 gap-3">
        <Field label="Source">
          <SourceSelect value={setting.source} onChange={(source) => onChange({ ...setting, source })} />
        </Field>
        <Field label="Width">
          <LineWidthSelect value={setting.lineWidth} onChange={(lineWidth) => onChange({ ...setting, lineWidth })} />
        </Field>
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
          ? 'border-[#6b7280] bg-[#24466a] text-white'
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

function SourceSelect({
  value,
  isVolumeMa = false,
  onChange,
}: {
  value: IndicatorPriceSource;
  isVolumeMa?: boolean;
  onChange: (value: IndicatorPriceSource) => void;
}) {
  if (isVolumeMa) {
    return (
      <select
        value="volume"
        disabled
        className="h-8 w-full rounded border border-[#3f4654] bg-[#151a23] px-2 text-sm font-semibold text-[#d1d4dc] outline-none opacity-80"
        aria-label="Source"
      >
        <option value="volume">Volume</option>
      </select>
    );
  }

  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as IndicatorPriceSource)}
      className="h-8 w-full rounded border border-[#3f4654] bg-[#151a23] px-2 text-sm font-semibold text-[#d1d4dc] outline-none transition-colors hover:text-white focus:border-[#6b7280] focus:text-white"
      aria-label="Source"
    >
      {PRICE_SOURCE_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  );
}

function LineWidthSelect({
  value,
  onChange,
}: {
  value: 1 | 2 | 3 | 4;
  onChange: (value: 1 | 2 | 3 | 4) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const handleSelect = (lineWidth: 1 | 2 | 3 | 4) => {
    onChange(lineWidth);
    setIsOpen(false);
  };

  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setIsOpen(false);
        }
      }}
    >
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="flex h-8 w-full items-center justify-between rounded border border-[#3f4654] bg-[#151a23] px-2.5 text-[#d1d4dc] outline-none transition-colors hover:text-white focus:border-[#6b7280] focus:text-white"
        aria-label="Line width"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <LineWidthPreview lineWidth={value} />
        <ChevronDownIcon />
      </button>

      {isOpen && (
        <div
          role="listbox"
          className="absolute left-0 top-[calc(100%+4px)] z-50 w-full overflow-hidden rounded border border-[#3f4654] bg-[#151a23] shadow-xl shadow-black/40"
        >
          {LINE_WIDTH_OPTIONS.map((lineWidth) => (
            <button
              key={lineWidth}
              type="button"
              role="option"
              aria-selected={value === lineWidth}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => handleSelect(lineWidth)}
              className={`flex h-8 w-full items-center px-2.5 transition-colors ${
                value === lineWidth ? 'bg-[#24466a] text-white' : 'text-[#d1d4dc] hover:bg-[#1b2f49] hover:text-white'
              }`}
            >
              <LineWidthPreview lineWidth={lineWidth} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LineWidthPreview({ lineWidth }: { lineWidth: 1 | 2 | 3 | 4 }) {
  return (
    <span
      className="block w-12 rounded-full bg-current"
      style={{ height: lineWidth }}
      aria-hidden="true"
    />
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
      className="h-8 w-full rounded border border-transparent bg-[#151a23] px-2.5 text-sm font-semibold text-[#d1d4dc] outline-none transition-colors hover:text-white focus:border-[#6b7280] focus:text-white"
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
      className="h-8 w-8 cursor-pointer rounded border border-[#3f4654] bg-[#151a23] p-0.5"
    />
  );
}

function GearIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M11.49 2.17a1 1 0 00-2 0l-.08.88a7.94 7.94 0 00-1.32.55l-.68-.57a1 1 0 00-1.41.07L4.6 4.5a1 1 0 00-.07 1.41l.57.68c-.22.42-.4.86-.55 1.32l-.88.08a1 1 0 000 2l.88.08c.15.46.33.9.55 1.32l-.57.68a1 1 0 00.07 1.41l1.4 1.4a1 1 0 001.41.07l.68-.57c.42.22.86.4 1.32.55l.08.88a1 1 0 002 0l.08-.88c.46-.15.9-.33 1.32-.55l.68.57a1 1 0 001.41-.07l1.4-1.4a1 1 0 00.07-1.41l-.57-.68c.22-.42.4-.86.55-1.32l.88-.08a1 1 0 000-2l-.88-.08a7.94 7.94 0 00-.55-1.32l.57-.68a1 1 0 00-.07-1.41l-1.4-1.4a1 1 0 00-1.41-.07l-.68.57c-.42-.22-.86-.4-1.32-.55l-.08-.88zM10.5 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" clipRule="evenodd" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
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
    <svg className="h-4 w-4 shrink-0 text-[#9099aa]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
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
