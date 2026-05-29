import LegalPageLayout from '../components/legal/LegalPageLayout';

export default function TermsPage() {
  return (
    <LegalPageLayout
      title="Terms of Service"
      updatedAt="May 29, 2026"
      intro="These terms explain how NexTick may be used as a real-time cryptocurrency market data and charting interface."
    >
      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">Service Scope</h2>
        <p>
          NexTick is a tool for displaying and analyzing cryptocurrency market
          data, including real-time candle streams and related chart information.
          It is provided for informational and portfolio demonstration purposes.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">No Financial Advice</h2>
        <p>
          NexTick does not provide investment, financial, trading, tax, or legal
          advice. Any chart, indicator, candle, signal, or market view shown in
          the interface should not be treated as a recommendation to buy, sell,
          or hold any asset.
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
          any market data displayed.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">Availability</h2>
        <p>
          NexTick may experience downtime, degraded performance, maintenance
          windows, connection errors, or data streaming interruptions. Continuous
          and uninterrupted operation is not guaranteed.
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

