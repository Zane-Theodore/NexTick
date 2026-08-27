import { useMarketTrades } from '../../hooks/useMarketTrades';
import type {
  MarketTrade,
  MarketTradesConnectionStatus,
} from '../../types/marketTrades';
import {
  formatCompactQuote,
  formatPrice,
  formatQuantity,
  getPriceStepOptions,
  splitTradingSymbol,
} from '../order-book/orderBookUtils';

interface MarketTradesProps {
  symbol: string;
}

const STATUS_LABELS: Record<MarketTradesConnectionStatus, string> = {
  connecting: 'Connecting',
  live: 'Live',
  reconnecting: 'Reconnecting',
  offline: 'Offline',
};

const TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export default function MarketTrades({ symbol }: MarketTradesProps) {
  const { trades, status } = useMarketTrades(symbol);
  const { baseAsset, quoteAsset } = splitTradingSymbol(symbol);
  const priceStep = getPriceStepOptions(trades[0]?.price)[0];

  return (
    <section className="flex h-full min-h-0 flex-col bg-[#0b0f16] text-[#eaecef]" aria-label={`${symbol} market trades`}>
      <header className="flex h-12 shrink-0 items-center border-b-2 border-[#3f4654] px-4">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold tracking-tight">Market Trades</h2>
        </div>
      </header>

      <div className="grid h-7 shrink-0 grid-cols-[1.05fr_0.85fr_0.8fr] items-center gap-2 px-3 text-[10px] font-medium text-[#687386]">
        <span>Price ({quoteAsset})</span>
        <span className="text-right">Amount ({baseAsset})</span>
        <span className="text-right">Time</span>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {trades.length > 0 ? (
          trades.map((trade, index) => (
            <TradeRow
              key={trade.id}
              trade={trade}
              priceStep={priceStep}
              isLatest={index === 0}
              quoteAsset={quoteAsset}
            />
          ))
        ) : (
          <TradesSkeleton label={getEmptyLabel(status)} />
        )}
      </div>

    </section>
  );
}

interface TradeRowProps {
  trade: MarketTrade;
  priceStep: number;
  isLatest: boolean;
  quoteAsset: string;
}

function TradeRow({ trade, priceStep, isLatest, quoteAsset }: TradeRowProps) {
  const isBuy = trade.side === 'buy';

  return (
    <div
      className={`group relative grid h-[23px] grid-cols-[1.05fr_0.85fr_0.8fr] items-center gap-2 px-3 text-[11px] leading-none transition-colors hover:bg-white/[0.035] ${
        isLatest ? (isBuy ? 'bg-[#20b486]/[0.025]' : 'bg-[#f04455]/[0.025]') : ''
      }`}
      title={`${isBuy ? 'Buyer' : 'Seller'} initiated · ${formatCompactQuote(trade.quoteQuantity)} ${quoteAsset}`}
    >
      <span className={`font-medium ${isBuy ? 'text-[#24c28f]' : 'text-[#f15b6c]'}`}>
        {formatPrice(trade.price, priceStep)}
      </span>
      <span className="text-right text-[#d6dae1]">{formatQuantity(trade.quantity)}</span>
      <span className="text-right text-[#7f8998]">{TIME_FORMATTER.format(trade.timestamp)}</span>
    </div>
  );
}

function TradesSkeleton({ label }: { label: string }) {
  return (
    <div className="relative h-full overflow-hidden">
      {SKELETON_ROW_WIDTHS.map(([priceWidth, amountWidth, timeWidth], index) => (
        <div
          key={index}
          className="grid h-[23px] animate-pulse grid-cols-[1.05fr_0.85fr_0.8fr] items-center gap-2 px-3"
        >
          <span className="h-1.5 rounded-full bg-[#252c36]/70" style={{ width: `${priceWidth}%` }} />
          <span className="ml-auto h-1.5 rounded-full bg-[#222933]/60" style={{ width: `${amountWidth}%` }} />
          <span className="ml-auto h-1.5 rounded-full bg-[#202731]/50" style={{ width: `${timeWidth}%` }} />
        </div>
      ))}
      <span className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-[#252c37] bg-[#0b0f16]/90 px-2.5 py-1 text-[10px] text-[#657184]">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#4b5565]" />
        {label}
      </span>
    </div>
  );
}

function getEmptyLabel(status: MarketTradesConnectionStatus) {
  if (status !== 'live') return STATUS_LABELS[status];

  return 'Waiting for trades';
}

const SKELETON_ROW_WIDTHS = [
  [78, 62, 74],
  [90, 48, 68],
  [69, 75, 82],
  [84, 58, 71],
  [74, 82, 64],
  [91, 53, 78],
  [80, 69, 67],
  [72, 46, 84],
  [87, 71, 73],
  [76, 56, 80],
  [92, 79, 66],
  [68, 63, 76],
  [83, 51, 82],
  [73, 74, 69],
  [89, 58, 77],
  [77, 67, 71],
  [85, 49, 83],
  [70, 78, 65],
] as const;
