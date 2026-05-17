import Header from './Header';
import Footer from './Footer';

interface MainLayoutProps {
  children: React.ReactNode;
}

export default function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#131722] pt-20">
      <Header />
      
      <main className="flex-1 flex flex-col overflow-hidden">
        {children}
      </main>

      <Footer />
    </div>
  );
}