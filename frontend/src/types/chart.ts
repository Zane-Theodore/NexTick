import type { ISeriesApi, LineWidth } from 'lightweight-charts';

import type { ChartTime } from '../utils/formatters';

export type IndicatorGroup = 'ema' | 'ma' | 'volume-ma' | 'rsi' | 'macd';
export type IndicatorKind = IndicatorGroup | 'macd-signal';
export type IndicatorPriceSource = 'open' | 'high' | 'low' | 'close';

export interface SinglePeriodIndicatorSetting {
  id: string;
  group: Exclude<IndicatorGroup, 'macd'>;
  label: string;
  visible: boolean;
  period: number;
  source: IndicatorPriceSource;
  lineWidth: LineWidth;
  color: string;
}

export interface MacdIndicatorSetting {
  id: string;
  group: 'macd';
  label: string;
  visible: boolean;
  fastPeriod: number;
  slowPeriod: number;
  signalPeriod: number;
  source: IndicatorPriceSource;
  lineWidth: LineWidth;
  macdColor: string;
  signalColor: string;
}

export type IndicatorSetting = SinglePeriodIndicatorSetting | MacdIndicatorSetting;

export interface IndicatorSeriesConfig {
  id: string;
  group: IndicatorGroup;
  kind: IndicatorKind;
  label: string;
  period?: number;
  fastPeriod?: number;
  slowPeriod?: number;
  signalPeriod?: number;
  source?: IndicatorPriceSource;
  lineWidth: LineWidth;
  color: string;
  series: ISeriesApi<"Line">;
}

export interface IndicatorValue {
  id: string;
  group: IndicatorGroup;
  kind: IndicatorKind;
  label: string;
  period?: number;
  value: number;
  color: string;
}

export interface LegendData {
  time: ChartTime;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CursorPosition {
  x: number;
  y: number;
}

export interface ChartPaneLayout {
  index: number;
  top: number;
  height: number;
}
