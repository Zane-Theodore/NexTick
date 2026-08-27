import MainLayout from './components/layout/MainLayout';
import TradingWorkspace from './components/trading/TradingWorkspace';
import PrivacyPage from './pages/PrivacyPage';
import TermsPage from './pages/TermsPage';

function App() {
  const pathname = window.location.pathname;
  const page = pathname === '/terms'
    ? <TermsPage />
    : pathname === '/privacy'
      ? <PrivacyPage />
      : <TradingWorkspace />;

  return (
    <MainLayout>
      {page}
    </MainLayout>
  );
}

export default App;
