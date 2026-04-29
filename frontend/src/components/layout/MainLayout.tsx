import Header from './Header';
import Footer from './Footer';

interface MainLayoutProps {
  children: React.ReactNode;
}

export default function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className="min-h-screen bg-[#131722] flex flex-col pt-20">
      <Header />
      
      <main className="flex-1 flex flex-col overflow-hidden">
        {children}
      </main>

      <Footer />
    </div>
  );
}