import Header from './Header';
import Footer from './Footer';

interface MainLayoutProps {
  children: React.ReactNode;
}

export default function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className="flex h-screen h-dvh flex-col overflow-hidden bg-[#0f1117] pt-20">
      <Header />
      
      <main className="flex-1 flex flex-col overflow-hidden">
        {children}
      </main>

      <Footer />
    </div>
  );
}
