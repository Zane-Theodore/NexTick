import LegalPageLayout from '../components/legal/LegalPageLayout';

export default function TermsPage() {
  return (
    <LegalPageLayout
      title="Terms of Service"
      updatedAt="June 10, 2026"
      intro="These terms explain how NexTick may be used as a real-time cryptocurrency market data and charting interface."
    >
      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">Service Scope</h2>
        <p>
          NexTick is a tool for displaying and analyzing cryptocurrency market
          data, including historical candles, real-time candle streams, volume,
          visible price extrema, and configurable technical indicators. It is
          provided for informational, educational, and portfolio demonstration
          purposes.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">No Financial Advice</h2>
        <p>
          NexTick does not provide investment, financial, trading, tax, or legal
          advice. Any chart, candle, volume view, indicator, tooltip, visible
          price marker, or market view shown in the interface should not be
          treated as a recommendation to buy, sell, or hold any asset.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">User Responsibility</h2>
        <p>
          You are solely responsible for your own trading and investment
          decisions. Cryptocurrency markets are volatile, and you should evaluate
          risks independently before taking any action.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">Market Data</h2>
        <p>
          Market data may come from Binance or other third-party sources. Data
          may be delayed, inaccurate, incomplete, interrupted, or unavailable.
          NexTick does not guarantee the accuracy, freshness, or completeness of
          any market data displayed. Indicator values are calculated from the
          available candle history and may change as new data arrives.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">Realtime Features</h2>
        <p>
          Realtime updates depend on backend services, Socket.IO connections,
          Kafka processing, QuestDB storage, and third-party market data
          availability. Reconnects, missed updates, backfills, reconciliation
          passes, or service restarts may change what appears in the chart.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">Availability</h2>
        <p>
          NexTick may experience downtime, degraded performance, maintenance
          windows, connection errors, or data streaming interruptions. Continuous
          and uninterrupted operation is not guaranteed. NexTick is not designed
          for live order execution, automated trading, or any workflow where
          delayed or missing data could cause financial loss.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">Acceptable Use</h2>
        <p>
          You may not abuse the API, spam requests, attack the system, bypass
          intended limits, attempt unauthorized access, or use NexTick for
          harmful, illegal, or misleading purposes.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">Accounts and Payments</h2>
        <p>
          NexTick currently does not provide user accounts, subscriptions,
          brokerage services, custody, deposits, withdrawals, or trade
          execution. If those features are introduced later, additional terms
          may apply.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">Changes</h2>
        <p>
          NexTick may change, remove, or add content, features, data sources, or
          technical behavior in the future. These terms may also be updated as
          the project evolves.
        </p>
      </section>
    </LegalPageLayout>
  );
}
