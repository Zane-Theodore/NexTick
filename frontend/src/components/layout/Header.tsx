export default function Header() {
  return (
    <header className="fixed top-0 left-0 z-50 w-full h-20 bg-[#181a25]/25 backdrop-blur-md border-b border-[#2B2B43] flex items-center justify-between px-6">
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
      
      <div className="flex items-center gap-4">
        <button className="text-sm font-medium text-[#d1d4dc] hover:text-white transition-colors">
          Login
        </button>
        <button className="text-sm font-medium bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors">
          Sign Up
        </button>
      </div>
    </header>
  );
}