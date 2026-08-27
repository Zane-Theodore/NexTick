import { useState } from 'react';

import { SUPPORTED_SYMBOLS } from '../chart/chartConstants';
import TradingChart from '../chart/TradingChart';
import MarketTrades from '../market-trades/MarketTrades';
import OrderBook from '../order-book/OrderBook';

export default function TradingWorkspace() {
  const [symbol, setSymbol] = useState(SUPPORTED_SYMBOLS[0]);

  return (
    <div
      className="grid h-full min-h-0 min-w-[1080px] gap-[5px] overflow-hidden bg-[#05070a] [grid-template-columns:var(--order-book-width,328px)_minmax(0,1fr)_var(--market-trades-width,300px)]"
      data-workspace="trading"
    >
      <aside className="min-h-0 min-w-0 overflow-hidden rounded-lg bg-[#0b0f16]" data-panel="order-book">
        <OrderBook key={symbol} symbol={symbol} />
      </aside>

      <section className="min-h-0 min-w-0 overflow-hidden rounded-lg bg-[#0b0f16]" data-panel="chart">
        <TradingChart symbol={symbol} onSymbolChange={setSymbol} />
      </section>

      <aside className="min-h-0 min-w-0 overflow-hidden rounded-lg bg-[#0b0f16]" data-panel="market-trades">
        <MarketTrades key={symbol} symbol={symbol} />
      </aside>
    </div>
  );
}
