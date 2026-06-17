import type { IndicatorGroup, IndicatorSetting } from '../types/chart';

export function cloneIndicatorSettings(settings: IndicatorSetting[]): IndicatorSetting[] {
  return settings.map((setting) => ({ ...setting }));
}

export function mergeIndicatorSettings(
  currentSettings: IndicatorSetting[],
  updatedSettings: IndicatorSetting[],
): IndicatorSetting[] {
  const updatedSettingsById = new Map(updatedSettings.map((setting) => [setting.id, setting]));
  const currentSettingIds = new Set(currentSettings.map((setting) => setting.id));

  return [
    ...currentSettings.map((setting) => updatedSettingsById.get(setting.id) ?? setting),
    ...updatedSettings.filter((setting) => !currentSettingIds.has(setting.id)),
  ];
}

export function areIndicatorSettingsEqual(
  currentSettings: IndicatorSetting[],
  nextSettings: IndicatorSetting[],
): boolean {
  if (currentSettings.length !== nextSettings.length) return false;

  return currentSettings.every((setting, index) => (
    JSON.stringify(setting) === JSON.stringify(nextSettings[index])
  ));
}

export function areIndicatorGroupsEqual(
  currentGroups: IndicatorGroup[],
  nextGroups: IndicatorGroup[],
): boolean {
  if (currentGroups.length !== nextGroups.length) return false;
  return currentGroups.every((group, index) => group === nextGroups[index]);
}
