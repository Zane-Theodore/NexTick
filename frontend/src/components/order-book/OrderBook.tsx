import { useMemo, useState } from 'react';

import { useOrderBook } from '../../hooks/useOrderBook';
import type { OrderBookConnectionStatus, OrderBookLevel, OrderBookView } from '../../types/orderBook';
import {
  buildDisplayLevels,
  formatCompactQuote,
  formatLastPrice,
  formatPrice,
  formatQuantity,
  formatSpread,
  formatSpreadPercent,
  getDecimalPlaces,
  getPriceStepOptions,
  splitTradingSymbol,
} from './orderBookUtils';

interface OrderBookProps {
  symbol: string;
  visibleLevels?: number;
}

const STATUS_LABELS: Record<OrderBookConnectionStatus, string> = {
  connecting: 'Connecting',
  live: 'Live',
  reconnecting: 'Reconnecting',
  offline: 'Offline',
};

export default function OrderBook({ symbol, visibleLevels = 12 }: OrderBookProps) {
  const { snapshot, lastTrade, status } = useOrderBook(symbol);
  const [view, setView] = useState<OrderBookView>('both');
  const referencePrice = lastTrade?.price
    ?? snapshot?.asks[0]?.price
    ?? snapshot?.bids[0]?.price;
  const priceStepOptions = useMemo(() => getPriceStepOptions(referencePrice), [referencePrice]);
  const [priceStepIndex, setPriceStepIndex] = useState(0);
  const priceStep = priceStepOptions[priceStepIndex] ?? priceStepOptions[0];
  const { baseAsset, quoteAsset } = splitTradingSymbol(symbol);

  const asks = useMemo(() => buildDisplayLevels(
    snapshot?.asks ?? [],
    'asks',
    priceStep,
    visibleLevels,
  ), [priceStep, snapshot?.asks, visibleLevels]);
  const bids = useMemo(() => buildDisplayLevels(
    snapshot?.bids ?? [],
    'bids',
    priceStep,
    visibleLevels,
  ), [priceStep, snapshot?.bids, visibleLevels]);

  const bestAsk = snapshot?.asks.reduce<number | null>((best, level) => (
    best === null || level.price < best ? level.price : best
  ), null) ?? null;
  const bestBid = snapshot?.bids.reduce<number | null>((best, level) => (
    best === null || level.price > best ? level.price : best
  ), null) ?? null;
  const midpoint = bestAsk !== null && bestBid !== null ? (bestAsk + bestBid) / 2 : null;
  const displayPrice = lastTrade?.price ?? midpoint;
  const spread = bestAsk !== null && bestBid !== null ? bestAsk - bestBid : null;
  const spreadPercent = spread !== null && midpoint ? (spread / midpoint) * 100 : null;
  const totalBidLiquidity = snapshot?.bids.reduce((total, level) => (
    total + level.price * level.quantity
  ), 0) ?? 0;
  const totalAskLiquidity = snapshot?.asks.reduce((total, level) => (
    total + level.price * level.quantity
  ), 0) ?? 0;
  const totalLiquidity = totalBidLiquidity + totalAskLiquidity;
  const buyRatio = totalLiquidity > 0 ? (totalBidLiquidity / totalLiquidity) * 100 : 50;

  return (
    <section className="flex h-full min-h-0 flex-col bg-[#0b0f16] text-[#eaecef]" aria-label={`${symbol} order book`}>
      <header className="flex h-12 shrink-0 items-center border-b-2 border-[#3f4654] px-4">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold tracking-tight">Order Book</h2>
        </div>
      </header>

      <div className="flex h-11 shrink-0 items-center justify-between border-b border-[#171c24] px-3">
        <div className="flex items-center gap-1" role="group" aria-label="Order book view">
          <ViewButton view="both" activeView={view} onChange={setView} />
          <ViewButton view="bids" activeView={view} onChange={setView} />
          <ViewButton view="asks" activeView={view} onChange={setView} />
        </div>

        <label className="relative flex items-center">
          <span className="sr-only">Price grouping</span>
          <select
            value={priceStepIndex}
            onChange={(event) => setPriceStepIndex(Number(event.target.value))}
            className="h-7 cursor-pointer appearance-none rounded-md border border-[#252c37] bg-[#121720] py-0 pl-2.5 pr-7 text-[11px] font-medium text-[#c5cad3] outline-none transition-colors hover:border-[#3b4656] focus:border-[#4f8fe8]"
            title="Price grouping"
          >
            {priceStepOptions.map((step, index) => (
              <option key={step} value={index}>
                {step.toFixed(getDecimalPlaces(step))}
              </option>
            ))}
          </select>
          <ChevronDownIcon />
        </label>
      </div>

      <div className="grid h-7 shrink-0 grid-cols-[1.1fr_0.85fr_0.95fr] items-center gap-2 px-3 text-[10px] font-medium text-[#687386]">
        <span>Price ({quoteAsset})</span>
        <span className="text-right">Amount ({baseAsset})</span>
        <span className="text-right">Sum ({quoteAsset})</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {(view === 'both' || view === 'asks') && (
          <OrderBookSide
            levels={asks}
            side="asks"
            priceStep={priceStep}
            alignToBottom
            emptyLabel={status === 'live' ? 'Waiting for asks' : STATUS_LABELS[status]}
          />
        )}

        {view === 'both' && (
          <MarketPrice
            price={displayPrice}
            direction={lastTrade?.direction ?? 'up'}
            spread={spread}
            spreadPercent={spreadPercent}
          />
        )}

        {(view === 'both' || view === 'bids') && (
          <OrderBookSide
            levels={bids}
            side="bids"
            priceStep={priceStep}
            emptyLabel={status === 'live' ? 'Waiting for bids' : STATUS_LABELS[status]}
          />
        )}
      </div>

      <OrderBookBalance buyRatio={buyRatio} />
    </section>
  );
}

interface OrderBookSideProps {
  levels: OrderBookLevel[];
  side: 'asks' | 'bids';
  priceStep: number;
  alignToBottom?: boolean;
  emptyLabel: string;
}

function OrderBookSide({ levels, side, priceStep, alignToBottom = false, emptyLabel }: OrderBookSideProps) {
  if (levels.length === 0) {
    return (
      <div className={`relative flex min-h-0 flex-1 flex-col overflow-hidden ${alignToBottom ? 'justify-end' : 'justify-start'}`}>
        {SKELETON_ROW_WIDTHS.map(([priceWidth, sizeWidth, totalWidth], index) => (
          <div
            key={index}
            className="grid min-h-5 max-h-7 flex-1 animate-pulse grid-cols-[1.1fr_0.85fr_0.95fr] items-center gap-2 px-3"
          >
            <span className="h-1.5 rounded-full bg-[#252c36]/70" style={{ width: `${priceWidth}%` }} />
            <span className="ml-auto h-1.5 rounded-full bg-[#222933]/60" style={{ width: `${sizeWidth}%` }} />
            <span className="ml-auto h-1.5 rounded-full bg-[#202731]/50" style={{ width: `${totalWidth}%` }} />
          </div>
        ))}
        <span className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-[#252c37] bg-[#0b0f16]/90 px-2.5 py-1 text-[10px] text-[#657184]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#4b5565]" />
          {emptyLabel}
        </span>
      </div>
    );
  }

  return (
    <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${alignToBottom ? 'justify-end' : 'justify-start'}`}>
      {levels.map((level) => (
        <div
          key={level.price}
          className="group relative grid min-h-5 flex-1 grid-cols-[1.1fr_0.85fr_0.95fr] items-center gap-2 overflow-hidden px-3 text-[11px] leading-none transition-colors hover:bg-white/[0.035]"
        >
          <span
            className={`pointer-events-none absolute inset-y-[1px] right-0 transition-[width] duration-150 ${
              side === 'asks' ? 'bg-[#f04455]/10' : 'bg-[#20b486]/10'
            }`}
            style={{ width: `${Math.max(2, level.depthPercent)}%` }}
          />
          <span className={`relative font-medium ${side === 'asks' ? 'text-[#f15b6c]' : 'text-[#24c28f]'}`}>
            {formatPrice(level.price, priceStep)}
          </span>
          <span className="relative text-right text-[#d6dae1]">{formatQuantity(level.quantity)}</span>
          <span className="relative text-right text-[#8c95a4]">{formatCompactQuote(level.cumulativeQuote)}</span>
        </div>
      ))}
    </div>
  );
}

const SKELETON_ROW_WIDTHS = [
  [72, 58, 67],
  [86, 74, 54],
  [64, 48, 81],
  [79, 63, 70],
  [70, 82, 58],
  [89, 55, 76],
  [75, 68, 62],
  [82, 46, 84],
] as const;

interface MarketPriceProps {
  price: number | null;
  direction: 'up' | 'down';
  spread: number | null;
  spreadPercent: number | null;
}

function MarketPrice({ price, direction, spread, spreadPercent }: MarketPriceProps) {
  return (
    <div className="flex h-[54px] shrink-0 items-center justify-between border-y border-[#1c222c] bg-[#0e1218] px-3">
      <p className={`flex min-w-0 items-center gap-1.5 truncate text-[15px] font-semibold tracking-tight ${
        direction === 'up' ? 'text-[#24c28f]' : 'text-[#f15b6c]'
      }`}>
        <span>{price === null ? '—' : formatLastPrice(price)}</span>
        {price !== null && <VerticalArrowIcon direction={direction} />}
      </p>

      <div className="text-right">
        <p className="text-[10px] font-medium text-[#9ba4b2]">
          {spread === null || price === null ? '—' : formatSpread(spread, price)}
        </p>
        <p className="text-[9px] text-[#596474]">
          Spread {spreadPercent === null ? '—' : formatSpreadPercent(spreadPercent)}
        </p>
      </div>
    </div>
  );
}

function OrderBookBalance({ buyRatio }: { buyRatio: number }) {
  const normalizedBuyRatio = Math.min(100, Math.max(0, buyRatio));

  return (
    <footer
      className="h-10 shrink-0 border-t border-[#1c222c] px-3 pt-2"
      title="Buy and sell liquidity across the top 20 order-book levels"
    >
      <div className="mb-1 flex items-center justify-between text-[9px] font-semibold">
        <span className="text-[#24c28f]">Buy {normalizedBuyRatio.toFixed(0)}%</span>
        <span className="text-[#f15b6c]">Sell {(100 - normalizedBuyRatio).toFixed(0)}%</span>
      </div>
      <div className="flex h-1 overflow-hidden rounded-full bg-[#1c222c]">
        <span
          className="bg-[#24c28f] transition-[width] duration-300"
          style={{ width: `${normalizedBuyRatio}%` }}
        />
        <span className="flex-1 bg-[#f15b6c]" />
      </div>
    </footer>
  );
}

interface ViewButtonProps {
  view: OrderBookView;
  activeView: OrderBookView;
  onChange: (view: OrderBookView) => void;
}

function ViewButton({ view, activeView, onChange }: ViewButtonProps) {
  const labels: Record<OrderBookView, string> = {
    both: 'Show bids and asks',
    bids: 'Show bids only',
    asks: 'Show asks only',
  };

  return (
    <button
      type="button"
      onClick={() => onChange(view)}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
        activeView === view
          ? 'bg-[#1a2431] text-[#dfe5ee]'
          : 'text-[#5e6979] hover:bg-[#141a22] hover:text-[#9aa5b4]'
      }`}
      aria-label={labels[view]}
      title={labels[view]}
      aria-pressed={activeView === view}
    >
      <BookViewIcon view={view} />
    </button>
  );
}

function BookViewIcon({ view }: { view: OrderBookView }) {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {[2, 5.5, 9, 12.5].map((y, index) => {
        const isAsk = view === 'asks' || (view === 'both' && index < 2);

        return (
          <g key={y}>
            <rect x="1.5" y={y} width="3" height="1.5" rx="0.5" fill={isAsk ? '#f15b6c' : '#24c28f'} />
            <rect x="5.5" y={y} width={index % 2 === 0 ? 8.5 : 6.5} height="1.5" rx="0.5" fill="currentColor" />
          </g>
        );
      })}
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg className="pointer-events-none absolute right-2 h-3 w-3 text-[#687386]" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function VerticalArrowIcon({ direction }: { direction: 'up' | 'down' }) {
  return (
    <svg
      className={`h-3.5 w-3.5 shrink-0 ${direction === 'down' ? 'rotate-180' : ''}`}
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <path d="M7 11V3M3.8 6.2 7 3l3.2 3.2" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
