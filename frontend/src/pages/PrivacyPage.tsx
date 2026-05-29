import LegalPageLayout from '../components/legal/LegalPageLayout';

export default function PrivacyPage() {
  return (
    <LegalPageLayout
      title="Privacy Policy"
      updatedAt="May 29, 2026"
      intro="This policy describes the limited data NexTick may process while providing cryptocurrency market visualization features."
    >
      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">Data NexTick May Process</h2>
        <p>
          NexTick may process frontend configuration data such as selected
          symbol, selected interval, chart settings, and UI preferences when
          these features are available. This helps keep the interface consistent
          across sessions.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">Account Information</h2>
        <p>
          If authentication is added in the future, NexTick may process account
          information such as an email address, profile settings, or other
          details needed to operate user accounts.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">Local Storage and Cookies</h2>
        <p>
          NexTick may use localStorage, cookies, or similar browser storage for
          preferences, session behavior, authentication state, or other product
          functionality if these features are implemented.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">Logs and Technical Data</h2>
        <p>
          NexTick may record error logs, request metadata, device or browser
          information, timestamps, and other technical data to debug issues,
          monitor reliability, and improve the service.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">Market Data</h2>
        <p>
          Cryptocurrency market data displayed in NexTick is public market
          information and is not personal data. This includes candles, prices,
          volumes, symbols, and intervals.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-blue-400">Data Sharing</h2>
        <p>
          NexTick does not sell personal data. Data may be shared only when
          needed to operate the service, comply with legal obligations, protect
          the system, or support infrastructure and debugging workflows.
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

