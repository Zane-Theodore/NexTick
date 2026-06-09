import LegalPageLayout from '../components/legal/LegalPageLayout';

export default function PrivacyPage() {
  return (
    <LegalPageLayout
      title="Privacy Policy"
      updatedAt="June 10, 2026"
      intro="This policy describes the limited data NexTick may process while providing cryptocurrency market visualization features."
    >
      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">Data NexTick Processes</h2>
        <p>
          NexTick processes the market selections and chart configuration needed
          to operate the interface, such as selected symbol, selected interval,
          indicator visibility, indicator settings, and chart interaction state.
          These values are used to request historical candles, join realtime
          Socket.IO rooms, and render the chart.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">Account Information</h2>
        <p>
          NexTick currently does not provide user accounts, authentication,
          subscriptions, deposits, withdrawals, or trade execution. If account
          features are added later, NexTick may process information such as an
          email address, profile settings, or other details needed to operate
          those accounts.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">Local Storage and Cookies</h2>
        <p>
          The current frontend does not intentionally persist chart preferences
          in localStorage or cookies. Browser cookies or credentials may still
          be sent by the browser if they exist for the configured backend origin.
          Future features may use localStorage, cookies, or similar browser
          storage for preferences, sessions, authentication, or other product
          functionality.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">Logs and Technical Data</h2>
        <p>
          NexTick may process request metadata, Socket.IO connection events,
          API health-check results, timestamps, browser or device information,
          and application logs to debug issues, monitor reliability, and improve
          the service. Frontend logs may also appear in the browser console.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">Market Data</h2>
        <p>
          Cryptocurrency market data displayed in NexTick is public market
          information and is not personal data. This includes candles, prices,
          volumes, symbols, intervals, calculated indicators, and visible chart
          extrema.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">Third-Party Services</h2>
        <p>
          NexTick may rely on third-party market data and infrastructure
          providers, including Binance for market data and any hosting,
          database, logging, or networking services used to operate the system.
          Those providers may process technical data according to their own
          terms and policies.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">Data Sharing</h2>
        <p>
          NexTick does not sell personal data. Data may be shared only when
          needed to operate the service, comply with legal obligations, protect
          the system, support infrastructure, or debug reliability issues.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">Data Deletion</h2>
        <p>
          If NexTick stores account information in the future, users may request
          deletion of their account data, subject to technical, legal, or
          security requirements.
        </p>
      </section>
    </LegalPageLayout>
  );
}
