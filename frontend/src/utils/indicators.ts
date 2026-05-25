export interface IndicatorPoint {
  time: number | string;
  value: number;
}

export interface MinimalCandle {
  time: number | string;
  close: number;
}

export function calculateEMAHistory(data: MinimalCandle[], period: number): IndicatorPoint[] {
  if (!data || data.length === 0) return [];

  const k = 2 / (period + 1);
  const emaData: IndicatorPoint[] = [];
  let emaPrev = data[0].close;

  for (let i = 0; i < data.length; i++) {
    const currentClose = data[i].close;
    const emaCurrent = (currentClose - emaPrev) * k + emaPrev;

    emaData.push({
      time: data[i].time,
      value: emaCurrent,
    });

    emaPrev = emaCurrent;
  }

  return emaData;
}

export function calculateNextEMA(currentClose: number, previousEMA: number, period: number): number {
  const k = 2 / (period + 1);
  return (currentClose - previousEMA) * k + previousEMA;
}

export function calculateMAHistory(data: MinimalCandle[], period: number): IndicatorPoint[] {
  if (!data || data.length === 0 || period <= 0) return [];

  const maData: IndicatorPoint[] = [];
  let rollingSum = 0;

  for (let i = 0; i < data.length; i++) {
    rollingSum += data[i].close;

    if (i >= period) {
      rollingSum -= data[i - period].close;
    }

    const divisor = Math.min(i + 1, period);
    maData.push({
      time: data[i].time,
      value: rollingSum / divisor,
    });
  }

  return maData;
}

export function calculateNextMA(data: MinimalCandle[], period: number): number | null {
  if (!data || data.length === 0 || period <= 0) return null;

  const window = data.slice(-period);
  const sum = window.reduce((total, candle) => total + candle.close, 0);
  return sum / window.length;
}
