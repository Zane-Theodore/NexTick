export default function Header() {
  return (
    <header className="fixed top-0 left-0 z-50 w-full h-20 bg-[#10141c]/75 backdrop-blur-md border-b border-[#3f4654] flex items-center justify-between px-6">
      <div className="flex items-center gap-3">
        {/* Logo */}
        <img 
          src="/logo.png" 
          alt="Logo" 
          className="w-10 h-10 object-contain drop-shadow-[0_0_8px_rgba(37,99,235,0.5)]" 
        />
        
        <h1 className="text-xl font-bold text-[#d1d4dc] tracking-wide">
          Nex<span className="text-blue-500">Tick</span>
        </h1>
      </div>
    </header>
  );
}
