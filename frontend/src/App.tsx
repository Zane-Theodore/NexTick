import MainLayout from './components/layout/MainLayout';
import TradingChart from './components/chart/TradingChart';
import PrivacyPage from './pages/PrivacyPage';
import TermsPage from './pages/TermsPage';

function App() {
  const pathname = window.location.pathname;
  const page = pathname === '/terms'
    ? <TermsPage />
    : pathname === '/privacy'
      ? <PrivacyPage />
      : <TradingChart />;

  return (
    <MainLayout>
      {page}
    </MainLayout>
  );
}

export default App;
