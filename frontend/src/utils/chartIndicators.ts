import type { LineData, Time } from 'lightweight-charts';

import type { IndicatorSeriesConfig, IndicatorSetting, IndicatorValue } from '../types/chart';
import type { FormattedCandle } from './formatters';
import { calculateEMAHistory, calculateMACDHistory, calculateMAHistory, calculateRSIHistory, calculateVolumeMAHistory } from './indicators';

type IndicatorCalculationConfig = Omit<IndicatorSeriesConfig, 'series' | 'paneIndex'>;

export function getIndicatorData(config: IndicatorCalculationConfig, history: FormattedCandle[]): LineData<Time>[] {
  if (history.length === 0) return [];
  if (config.period !== undefined && config.period <= 0) return [];

  const sourceHistory = getSourceHistory(history, config.source ?? 'close');

  switch (config.kind) {
    case 'ema':
      return calculateEMAHistory(sourceHistory, config.period ?? 1) as LineData<Time>[];
    case 'ma':
      return calculateMAHistory(sourceHistory, config.period ?? 1) as LineData<Time>[];
    case 'volume-ma':
      return calculateVolumeMAHistory(history, config.period ?? 1) as LineData<Time>[];
    case 'rsi':
      return calculateRSIHistory(sourceHistory, config.period ?? 14) as LineData<Time>[];
    case 'macd': {
      const macd = calculateMACDHistory(
        sourceHistory,
        config.fastPeriod ?? 12,
        config.slowPeriod ?? 26,
        config.signalPeriod ?? 9,
      );
      return macd.macd as LineData<Time>[];
    }
    case 'macd-signal': {
      const macd = calculateMACDHistory(
        sourceHistory,
        config.fastPeriod ?? 12,
        config.slowPeriod ?? 26,
        config.signalPeriod ?? 9,
      );
      return macd.signal as LineData<Time>[];
    }
    default:
      return [];
  }
}

export function getIndicatorValues(settings: IndicatorSetting[], history: FormattedCandle[]): IndicatorValue[] {
  if (history.length === 0) return [];

  return settings.reduce<IndicatorValue[]>((values, setting) => {
    if (!setting.visible) return values;

    if (setting.group === 'macd') {
      const macd = calculateMACDHistory(
        getSourceHistory(history, setting.source),
        setting.fastPeriod,
        setting.slowPeriod,
        setting.signalPeriod,
      );
      const macdPoint = macd.macd.at(-1);
      const signalPoint = macd.signal.at(-1);

      if (macdPoint) {
        values.push({
          id: `${setting.id}-macd`,
          group: setting.group,
          kind: 'macd',
          label: setting.label,
          value: macdPoint.value,
          color: setting.macdColor,
        });
      }

      if (signalPoint) {
        values.push({
          id: `${setting.id}-signal`,
          group: setting.group,
          kind: 'macd-signal',
          label: `${setting.label} Signal`,
          value: signalPoint.value,
          color: setting.signalColor,
        });
      }

      return values;
    }

    const indicatorData = getIndicatorData({
      id: setting.id,
      group: setting.group,
      kind: setting.group,
      label: setting.label,
      period: setting.period,
      source: setting.source,
      lineWidth: setting.lineWidth,
      color: setting.color,
    }, history);
    const lastPoint = indicatorData.at(-1);

    if (lastPoint) {
      values.push({
        id: setting.id,
        group: setting.group,
        kind: setting.group,
        label: setting.label,
        period: setting.period,
        value: lastPoint.value,
        color: setting.color,
      });
    }

    return values;
  }, []);
}

function getSourceHistory(
  history: FormattedCandle[],
  source: NonNullable<IndicatorSeriesConfig['source']>,
) {
  if (source === 'close') return history;

  return history.map((candle) => ({
    ...candle,
    close: candle[source],
  }));
}
