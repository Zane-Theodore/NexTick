import type { ISeriesApi } from 'lightweight-charts';

import type { ChartTime } from '../utils/formatters';

export type IndicatorKind = 'ema' | 'ma';

export interface IndicatorSeriesConfig {
  kind: IndicatorKind;
  period: number;
  series: ISeriesApi<"Line">;
}

export interface IndicatorValue {
  kind: IndicatorKind;
  period: number;
  value: number;
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
