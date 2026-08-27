import type { OrderBookLevel, RawOrderBookLevel } from '../../types/orderBook';

const QUOTE_ASSETS = ['USDT', 'USDC', 'FDUSD', 'TUSD', 'BTC', 'ETH', 'BNB', 'EUR', 'TRY'];

export function splitTradingSymbol(symbol: string) {
  const normalizedSymbol = symbol.toUpperCase();
  const quoteAsset = QUOTE_ASSETS.find((asset) => normalizedSymbol.endsWith(asset)) ?? '';

  return {
    baseAsset: quoteAsset ? normalizedSymbol.slice(0, -quoteAsset.length) : normalizedSymbol,
    quoteAsset: quoteAsset || 'QUOTE',
  };
}

export function buildDisplayLevels(
  rawLevels: RawOrderBookLevel[],
  side: 'asks' | 'bids',
  priceStep: number,
  visibleCount: number,
): OrderBookLevel[] {
  const groupedLevels = new Map<number, number>();

  rawLevels.forEach(({ price, quantity }) => {
    const groupedPrice = side === 'asks'
      ? Math.ceil(price / priceStep) * priceStep
      : Math.floor(price / priceStep) * priceStep;
    const normalizedPrice = Number(groupedPrice.toFixed(getDecimalPlaces(priceStep)));

    groupedLevels.set(normalizedPrice, (groupedLevels.get(normalizedPrice) ?? 0) + quantity);
  });

  const sortedLevels = [...groupedLevels.entries()]
    .map(([price, quantity]) => ({ price, quantity }))
    .sort((left, right) => (
      side === 'asks' ? left.price - right.price : right.price - left.price
    ))
    .slice(0, visibleCount);

  let cumulativeQuantity = 0;
  let cumulativeQuote = 0;
  const cumulativeLevels = sortedLevels.map(({ price, quantity }) => {
    cumulativeQuantity += quantity;
    cumulativeQuote += price * quantity;

    return {
      price,
      quantity,
      cumulativeQuantity,
      cumulativeQuote,
      depthPercent: 0,
    };
  });
  const maximumDepth = cumulativeLevels.at(-1)?.cumulativeQuote ?? 1;
  const displayLevels = cumulativeLevels.map((level) => ({
    ...level,
    depthPercent: (level.cumulativeQuote / maximumDepth) * 100,
  }));

  return side === 'asks' ? displayLevels.reverse() : displayLevels;
}

export function getPriceStepOptions(referencePrice: number | undefined): number[] {
  if (!referencePrice || referencePrice >= 10_000) return [0.01, 0.1, 1, 10, 50, 100];
  if (referencePrice >= 100) return [0.01, 0.1, 1, 10];
  if (referencePrice >= 1) return [0.0001, 0.001, 0.01, 0.1];
  if (referencePrice >= 0.01) return [0.000001, 0.00001, 0.0001, 0.001];

  return [0.00000001, 0.0000001, 0.000001, 0.00001];
}

export function getDecimalPlaces(value: number) {
  const valueString = value.toString();
  if (valueString.includes('e-')) return Number(valueString.split('e-')[1]);

  return valueString.split('.')[1]?.length ?? 0;
}

export function formatPrice(value: number, priceStep: number) {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: getDecimalPlaces(priceStep),
    maximumFractionDigits: getDecimalPlaces(priceStep),
  });
}

export function formatLastPrice(value: number) {
  const decimalPlaces = getMarketPriceDecimalPlaces(value);

  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  });
}

export function formatSpread(value: number, referencePrice: number) {
  const decimalPlaces = getMarketPriceDecimalPlaces(referencePrice);

  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  });
}

export function formatSpreadPercent(value: number) {
  const absoluteValue = Math.abs(value);
  const decimalPlaces = absoluteValue > 0 && absoluteValue < 0.001 ? 6 : 3;

  return `${value.toFixed(decimalPlaces)}%`;
}

export function formatQuantity(value: number) {
  if (value >= 1_000) return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (value >= 1) return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

  return value.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
}

export function formatCompactQuote(value: number) {
  return new Intl.NumberFormat('en-US', {
    notation: value >= 1_000_000 ? 'compact' : 'standard',
    minimumFractionDigits: value < 1_000 ? 2 : 0,
    maximumFractionDigits: value < 1_000 ? 2 : 0,
  }).format(value);
}

function getMarketPriceDecimalPlaces(value: number) {
  return value >= 100
    ? 2
    : value >= 1
      ? 4
      : value >= 0.01
        ? 6
        : 8;
}
