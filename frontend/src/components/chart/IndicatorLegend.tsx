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

interface IndicatorLegendProps {
  settings: IndicatorSetting[];
  defaultSettings: IndicatorSetting[];
  values: IndicatorValue[];
  isOpen: boolean;
  onToggleOpen: () => void;
  onToggleGroupVisibility: (group: IndicatorGroup) => void;
  onDismissGroup: (group: IndicatorGroup) => void;
  onApplySettings: (settings: IndicatorSetting[]) => void;
}

export default function IndicatorLegend({
  settings,
  defaultSettings,
  values,
  isOpen,
  onToggleOpen,
  onToggleGroupVisibility,
  onDismissGroup,
  onApplySettings,
}: IndicatorLegendProps) {
  const [activeGroup, setActiveGroup] = useState<IndicatorGroup | null>(null);
  const [draftSettings, setDraftSettings] = useState<IndicatorSetting[]>([]);
  const [windowPosition, setWindowPosition] = useState({ x: 360, y: 96 });
  const [dragState, setDragState] = useState<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  const activeGroupLabel = INDICATOR_GROUPS.find((item) => item.group === activeGroup)?.label ?? 'Indicator';

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

  const groupedSettings = useMemo(() => (
    INDICATOR_GROUPS.map(({ group, label }) => ({
      group,
      label,
      settings: settings.filter((setting) => setting.group === group),
    })).filter(({ settings }) => settings.length > 0)
  ), [settings]);

  const handleOpenSettings = (group: IndicatorGroup) => {
    setActiveGroup(group);
    setDraftSettings(cloneSettings(settings.filter((setting) => setting.group === group)));
  };

  const handleApply = () => {
    onApplySettings(draftSettings);
    setActiveGroup(null);
  };

  const handleReset = () => {
    if (!activeGroup) return;

    const currentById = new Map(settings.map((setting) => [setting.id, setting]));
    const defaults = cloneSettings(defaultSettings.filter((setting) => setting.group === activeGroup)).map((setting) => {
      const currentSetting = currentById.get(setting.id);
      return currentSetting ? { ...setting, visible: currentSetting.visible } : setting;
    });

    setDraftSettings(defaults);
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
                onToggleVisibility={onToggleGroupVisibility}
                onOpenSettings={handleOpenSettings}
                onDismiss={(dismissedGroup) => {
                  if (dismissedGroup === activeGroup) {
                    setActiveGroup(null);
                  }
                  onDismissGroup(dismissedGroup);
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {activeGroup && (
        <div
          className="fixed z-50 w-[min(520px,calc(100vw-24px))] border border-[#3f4654] bg-[#0f1117] shadow-2xl shadow-black/50"
          style={{ left: windowPosition.x, top: windowPosition.y }}
        >
          <div
            className="flex h-10 cursor-move select-none items-center justify-between border-b border-[#3f4654] bg-[#151a23] px-3"
            onMouseDown={handleHeaderMouseDown}
          >
            <span className="text-sm font-semibold text-[#d1d4dc]">{activeGroupLabel} settings</span>
            <button
              type="button"
              onClick={() => setActiveGroup(null)}
              className="h-7 w-7 text-[#9099aa] transition-colors hover:text-white"
              title="Close settings"
            >
              x
            </button>
          </div>

          <div className="max-h-[calc(100vh-220px)] overflow-auto p-3">
            <IndicatorSettingsForm
              settings={draftSettings}
              onChange={setDraftSettings}
            />
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-[#3f4654] bg-[#0f1117] px-3 py-3">
            <button
              type="button"
              onClick={handleReset}
              className="h-8 border border-[#3f4654] px-3 text-sm font-semibold text-[#d1d4dc] transition-colors hover:border-[#6b7280] hover:text-white"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="h-8 border border-[#26a69a] bg-[#17453f] px-3 text-sm font-semibold text-white transition-colors hover:bg-[#1f5c54]"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </>
  );
}

interface IndicatorLegendRowProps {
  group: IndicatorGroup;
  label: string;
  settings: IndicatorSetting[];
  values: IndicatorValue[];
  onToggleVisibility: (group: IndicatorGroup) => void;
  onOpenSettings: (group: IndicatorGroup) => void;
  onDismiss: (group: IndicatorGroup) => void;
}

function IndicatorLegendRow({
  group,
  label,
  settings,
  values,
  onToggleVisibility,
  onOpenSettings,
  onDismiss,
}: IndicatorLegendRowProps) {
  const isVisible = settings.some((setting) => setting.visible);

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
          title={isVisible ? `Hide ${label}` : `Show ${label}`}
        >
          <IndicatorEyeIcon isVisible={isVisible} />
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
  settings,
  onChange,
}: {
  settings: IndicatorSetting[];
  onChange: (settings: IndicatorSetting[]) => void;
}) {
  if (settings.length === 0) {
    return <div className="text-sm text-[#9099aa]">No settings available.</div>;
  }

  return (
    <div className="flex flex-col gap-3">
      {settings.map((setting) => (
        setting.group === 'macd'
          ? (
            <MacdSettingsEditor
              key={setting.id}
              setting={setting}
              onChange={(nextSetting) => onChange(settings.map((item) => item.id === nextSetting.id ? nextSetting : item))}
            />
          )
          : (
            <SingleSettingsEditor
              key={setting.id}
              setting={setting}
              onChange={(nextSetting) => onChange(settings.map((item) => item.id === nextSetting.id ? nextSetting : item))}
            />
          )
      ))}
    </div>
  );
}

function SingleSettingsEditor({
  setting,
  onChange,
}: {
  setting: SinglePeriodIndicatorSetting;
  onChange: (setting: SinglePeriodIndicatorSetting) => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_80px_72px] items-center gap-3 border border-[#252c38] bg-[#111722] p-2">
      <span className="text-sm font-semibold text-[#d1d4dc]">{setting.label}({setting.period})</span>
      <NumberInput value={setting.period} min={1} max={250} onChange={(period) => onChange({ ...setting, period })} />
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
    <div className="flex flex-col gap-3 border border-[#252c38] bg-[#111722] p-2">
      <span className="text-sm font-semibold text-[#d1d4dc]">{setting.label}</span>
      <div className="grid grid-cols-3 gap-2">
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
      <div className="grid grid-cols-2 gap-2">
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
      className="h-8 w-full border border-[#3f4654] bg-[#151a23] px-2 text-right text-sm text-[#d1d4dc] outline-none transition-colors focus:border-[#6b7280]"
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
      className="h-8 w-full cursor-pointer border border-[#3f4654] bg-[#151a23] p-0.5"
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

function cloneSettings(settings: IndicatorSetting[]): IndicatorSetting[] {
  return settings.map((setting) => ({ ...setting }));
}

function clampPeriod(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
