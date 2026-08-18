import LegalPageLayout from '../components/legal/LegalPageLayout';

const linkClassName = 'text-blue-400 underline decoration-blue-400/40 underline-offset-2 hover:text-blue-300';

export default function PrivacyPage() {
  return (
    <LegalPageLayout
      title="Privacy Policy"
      updatedAt="August 18, 2026"
      intro="This Policy explains what data NexTick processes when you use its cryptocurrency market-data visualization and charting features. It describes the current product reflected in the application code."
    >
      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">1. Scope and Current Product</h2>
        <p>
          This Policy applies to the NexTick web interface, REST API, and
          realtime Socket.IO service. NexTick currently has no user accounts,
          authentication, paid subscriptions, brokerage services, wallets,
          deposits, withdrawals, or trade execution. It therefore does not ask
          you to provide an account name, email address, payment details,
          government identifier, wallet address, or trading credentials.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">2. Data Processed When You Use NexTick</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <span className="font-medium text-[#d1d4dc]">Market requests:</span>{' '}
            the selected trading symbol, candle interval, and history limit are
            sent to the NexTick API. The selected symbol and interval are also
            sent to the realtime service to join or leave the corresponding
            Socket.IO room.
          </li>
          <li>
            <span className="font-medium text-[#d1d4dc]">Chart preferences:</span>{' '}
            indicator settings, indicator visibility, chart zoom spacing, and
            chart-pane sizes may be saved in your browser&apos;s session storage.
            They are used to restore the chart during the same browser session.
          </li>
          <li>
            <span className="font-medium text-[#d1d4dc]">Connection and log data:</span>{' '}
            the backend logs candle-query metadata such as symbol, interval, and
            limit, along with timestamps, errors, Socket.IO connection IDs, and
            room join/leave events. A deployment&apos;s web server, proxy, or hosting
            provider may also receive standard request data such as IP address,
            user-agent, requested URL, and request time.
          </li>
          <li>
            <span className="font-medium text-[#d1d4dc]">Browser diagnostics:</span>{' '}
            frontend status and error messages may be written to your browser
            console. The current frontend does not include an analytics or error
            reporting SDK that automatically sends those console messages to
            NexTick.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">3. Browser Storage and Cookies</h2>
        <p>
          NexTick stores chart preferences in <code className="rounded bg-black/25 px-1.5 py-0.5 text-sm text-[#e5e7eb]">sessionStorage</code>{' '}
          under the key <code className="rounded bg-black/25 px-1.5 py-0.5 text-sm text-[#e5e7eb]">nextick:trading-chart:preferences:v1</code>.
          Session storage is local to your browser and is normally cleared when
          the relevant browser tab or session ends; browser behavior can vary.
          You can also remove it by clearing site data or using the chart&apos;s reset
          controls.
        </p>
        <p className="mt-3">
          The current application does not set or read analytics, advertising,
          authentication, or preference cookies. Its Socket.IO client is
          configured to allow credentials, so cookies already associated with
          the configured backend origin may be included by the browser where its
          cookie and cross-origin rules permit. NexTick does not currently use
          those cookies to identify an account.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">4. How Data Is Used</h2>
        <p>NexTick processes the data described above to:</p>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          <li>return requested historical candles and deliver realtime updates;</li>
          <li>render the chart and restore your session-level preferences;</li>
          <li>validate requests, manage realtime subscriptions, and prevent abuse;</li>
          <li>diagnose failures, reconcile missing market data, and maintain reliability; and</li>
          <li>protect the service, its infrastructure, users, and legal rights.</li>
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">5. Public Market Data</h2>
        <p>
          Candles, trades, prices, volumes, symbols, intervals, timestamps, and
          calculated indicators are public market information rather than user
          account data. NexTick receives Binance market data on its server-side
          pipeline; your browser does not connect directly to Binance through the
          current frontend. Market data may be stored in QuestDB and processed
          through Kafka to provide historical and realtime charts.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">6. Service Providers and Disclosure</h2>
        <p>
          NexTick may rely on infrastructure providers that host or operate the
          website, API, network, logs, Kafka, or QuestDB. Those providers may
          process technical data on behalf of the service as needed to provide
          their functions. Information may also be disclosed when reasonably
          necessary to comply with law, respond to valid legal process, prevent
          fraud or abuse, investigate security issues, or protect rights and
          safety.
        </p>
        <p className="mt-3">
          NexTick does not sell personal information and the current application
          does not use personal information for cross-context behavioral
          advertising. NexTick does not send your chart preferences from session
          storage to advertising or analytics services.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">7. Retention</h2>
        <p>
          Chart preferences remain in session storage until the browser session
          ends, you clear site data, or the preference data is reset or found to
          be invalid. Server and infrastructure logs are retained according to
          the configuration and operational needs of the deployment. The current
          application code does not define a universal log-retention period.
          Public market candles may be retained to provide historical chart data.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">8. Security and International Processing</h2>
        <p>
          Reasonable technical measures may be used to protect the service, but
          no internet transmission or storage system is completely secure.
          Depending on where NexTick and its providers are deployed, technical
          data may be processed in countries other than your own and may be
          subject to the laws of those locations.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">9. Your Choices and Rights</h2>
        <p>
          You can stop further browser-side processing by leaving NexTick, close
          the browser session, clear NexTick&apos;s site data, and control cookies in
          your browser settings. Because NexTick currently has no accounts, it
          does not maintain an account profile for you to edit or delete.
          Depending on your location, you may have legal rights concerning
          personal data held in server or infrastructure logs, including rights
          to request access, correction, deletion, restriction, or objection.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">10. Children&apos;s Privacy</h2>
        <p>
          NexTick is a general-audience market-data tool and is not directed to
          children. It does not knowingly request personal information from
          children through accounts or forms. If you believe a child has
          provided personal information to a NexTick deployment, contact the
          maintainer so the issue can be reviewed.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">11. Changes to This Policy</h2>
        <p>
          This Policy may be updated when NexTick&apos;s features, providers, or data
          practices change. The “Last updated” date identifies the latest
          revision. Materially different processing should be described here
          before or when it is introduced.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">12. Contact</h2>
        <p>
          Privacy questions or requests can be submitted to the project
          maintainer through the{' '}
          <a
            href="https://github.com/iamzaneth/NexTick/issues"
            className={linkClassName}
            target="_blank"
            rel="noreferrer"
          >
            NexTick GitHub issue tracker
          </a>.
          Because issues are public, do not post sensitive information. Ask for
          a private contact method if your request contains personal data.
        </p>
      </section>
    </LegalPageLayout>
  );
}
