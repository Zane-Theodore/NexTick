import LegalPageLayout from '../components/legal/LegalPageLayout';

const linkClassName = 'text-blue-400 underline decoration-blue-400/40 underline-offset-2 hover:text-blue-300';

export default function TermsPage() {
  return (
    <LegalPageLayout
      title="Terms of Service"
      updatedAt="August 18, 2026"
      intro="These Terms govern access to NexTick, a cryptocurrency market-data visualization and charting service. By using NexTick, you agree to these Terms. If you do not agree, do not use the service."
    >
      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">1. What NexTick Provides</h2>
        <p>
          NexTick displays historical and realtime cryptocurrency OHLCV candles,
          chart tools, visible price extrema, and configurable technical
          indicators. The service currently obtains public Binance trade and
          candle data through a server-side data pipeline, aggregates and stores
          that data, and delivers it to the browser through REST and Socket.IO.
        </p>
        <p className="mt-3">
          NexTick does not currently provide accounts, authentication, paid
          subscriptions, brokerage or exchange services, wallets, custody,
          deposits, withdrawals, order routing, or trade execution.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">2. Informational Use Only</h2>
        <p>
          NexTick and everything displayed through it are provided only for
          informational, educational, and demonstration purposes. Nothing on
          NexTick is investment, financial, trading, tax, accounting, or legal
          advice, and nothing is an offer, solicitation, endorsement, or
          recommendation to buy, sell, or hold an asset. Technical indicators
          are mathematical transformations of the available candle history, not
          predictions or trading signals.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">3. Market Risk and Your Decisions</h2>
        <p>
          Digital-asset markets are volatile and can result in substantial or
          total loss. You are solely responsible for verifying information,
          assessing risk, complying with laws that apply to you, and making your
          own financial decisions. Do not rely on NexTick as the sole basis for
          a trade or use it for a workflow in which delayed, missing, or
          incorrect data could cause loss. Seek qualified independent advice
          when appropriate.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">4. Market Data and Calculations</h2>
        <p>
          Source data may be delayed, incomplete, duplicated, inaccurate,
          corrected, interrupted, or unavailable. NexTick builds candles from
          public trade streams, performs backfills and reconciliation, derives
          higher timeframes, and calculates indicators in the application.
          Consequently, NexTick values can differ from an exchange interface or
          another data provider and may change when new or corrected data is
          processed.
        </p>
        <p className="mt-3">
          NexTick does not guarantee the accuracy, completeness, sequence,
          timeliness, or continued availability of any market data or derived
          value. Binance is an independent third party; use of its data is
          subject to its applicable terms and policies. NexTick is not Binance
          and does not claim sponsorship, affiliation, or endorsement by
          Binance.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">5. Availability and Changes</h2>
        <p>
          Realtime delivery depends on network connections and multiple systems,
          including Binance, Kafka, QuestDB, the NexTick backend, and Socket.IO.
          Maintenance, reconnects, backfills, service restarts, software defects,
          or third-party outages may cause downtime, gaps, reordered updates, or
          changed chart values. NexTick may modify, suspend, or discontinue any
          feature, supported market, interval, data source, or the service as a
          whole at any time.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">6. Acceptable Use</h2>
        <p>You must not:</p>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          <li>use NexTick in violation of applicable law or another person&apos;s rights;</li>
          <li>attempt unauthorized access to the service, its infrastructure, or data;</li>
          <li>interfere with operation of the API or realtime service, including by abusive automation, excessive requests, attacks, or bypassing technical limits;</li>
          <li>introduce malware, probe for vulnerabilities without permission, or misrepresent NexTick data as guaranteed or official; or</li>
          <li>use the service to facilitate harmful, fraudulent, or misleading activity.</li>
        </ul>
        <p className="mt-3">
          Access may be limited or blocked when reasonably necessary to protect
          the service, its users, or third parties.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">7. Intellectual Property and Third Parties</h2>
        <p>
          NexTick&apos;s name, interface, and original application materials remain
          the property of their respective owner. Market data, libraries,
          trademarks, and other third-party materials remain subject to the
          rights and terms of their respective owners. These Terms do not grant
          you ownership of any of those materials or permission to misuse a
          third-party trademark.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">8. Disclaimer of Warranties</h2>
        <p>
          To the fullest extent permitted by applicable law, NexTick is provided
          “as is” and “as available,” without warranties of any kind, express or
          implied, including warranties of accuracy, reliability, availability,
          fitness for a particular purpose, non-infringement, or that the service
          will be secure or error-free. Some jurisdictions do not allow certain
          warranty exclusions, so those exclusions apply only to the extent
          permitted by law.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">9. Limitation of Liability</h2>
        <p>
          To the fullest extent permitted by applicable law, NexTick&apos;s owner,
          maintainers, and contributors will not be liable for indirect,
          incidental, special, consequential, exemplary, or punitive damages, or
          for lost profits, trading losses, lost data, loss of goodwill, or
          service interruption arising from or related to your use of, or
          inability to use, NexTick. Nothing in these Terms excludes liability
          that cannot lawfully be excluded or limits mandatory consumer rights.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">10. Privacy</h2>
        <p>
          The <a href="/privacy" className={linkClassName}>Privacy Policy</a>{' '}
          explains the data processed when you use NexTick and is incorporated
          into these Terms by reference.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">11. Changes to These Terms</h2>
        <p>
          These Terms may be revised when NexTick&apos;s features, data practices, or
          legal obligations change. The “Last updated” date identifies the latest
          revision. Continued use after revised Terms are published means you
          accept the revised Terms, to the extent permitted by applicable law.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">12. Contact</h2>
        <p>
          Questions about these Terms can be submitted to the project maintainer
          through the{' '}
          <a
            href="https://github.com/iamzaneth/NexTick/issues"
            className={linkClassName}
            target="_blank"
            rel="noreferrer"
          >
            NexTick GitHub issue tracker
          </a>.
          Do not include passwords, private keys, or other sensitive information
          in a public issue.
        </p>
      </section>
    </LegalPageLayout>
  );
}
