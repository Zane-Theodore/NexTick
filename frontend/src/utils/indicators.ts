export interface IndicatorPoint {
  time: number | string;
  value: number;
}

export interface MinimalCandle {
  time: number | string;
  close: number;
  volume?: number;
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

export function calculateVolumeMAHistory(data: MinimalCandle[], period: number): IndicatorPoint[] {
  if (!data || data.length === 0 || period <= 0) return [];

  const maData: IndicatorPoint[] = [];
  let rollingSum = 0;

  for (let i = 0; i < data.length; i++) {
    const currentVolume = Number(data[i].volume ?? 0);
    rollingSum += currentVolume;

    if (i >= period) {
      rollingSum -= Number(data[i - period].volume ?? 0);
    }

    const divisor = Math.min(i + 1, period);
    maData.push({
      time: data[i].time,
      value: rollingSum / divisor,
    });
  }

  return maData;
}

export function calculateRSIHistory(data: MinimalCandle[], period: number): IndicatorPoint[] {
  if (!data || data.length <= period || period <= 0) return [];

  let gainSum = 0;
  let lossSum = 0;
  const rsiData: IndicatorPoint[] = [];

  for (let i = 1; i <= period; i++) {
    const change = data[i].close - data[i - 1].close;
    gainSum += Math.max(change, 0);
    lossSum += Math.max(-change, 0);
  }

  let averageGain = gainSum / period;
  let averageLoss = lossSum / period;

  rsiData.push({
    time: data[period].time,
    value: calculateRSIValue(averageGain, averageLoss),
  });

  for (let i = period + 1; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);

    averageGain = ((averageGain * (period - 1)) + gain) / period;
    averageLoss = ((averageLoss * (period - 1)) + loss) / period;

    rsiData.push({
      time: data[i].time,
      value: calculateRSIValue(averageGain, averageLoss),
    });
  }

  return rsiData;
}

export interface MacdHistory {
  macd: IndicatorPoint[];
  signal: IndicatorPoint[];
}

export function calculateMACDHistory(
  data: MinimalCandle[],
  fastPeriod: number,
  slowPeriod: number,
  signalPeriod: number,
): MacdHistory {
  if (
    !data ||
    data.length === 0 ||
    fastPeriod <= 0 ||
    slowPeriod <= 0 ||
    signalPeriod <= 0 ||
    fastPeriod >= slowPeriod
  ) {
    return { macd: [], signal: [] };
  }

  const fastEma = calculateEMAHistory(data, fastPeriod);
  const slowEma = calculateEMAHistory(data, slowPeriod);
  const macd = fastEma.map((fastPoint, index) => ({
    time: fastPoint.time,
    value: fastPoint.value - slowEma[index].value,
  }));

  const signal = calculateEMAHistory(macd.map((point) => ({
    time: point.time,
    close: point.value,
  })), signalPeriod);

  return { macd, signal };
}

function calculateRSIValue(averageGain: number, averageLoss: number): number {
  if (averageLoss === 0) return 100;
  const relativeStrength = averageGain / averageLoss;
  return 100 - (100 / (1 + relativeStrength));
}
