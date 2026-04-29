export default function Header() {
  return (
    <header className="fixed top-0 left-0 z-50 w-full h-20 bg-[#181a25]/25 backdrop-blur-md border-b border-[#2B2B43] flex items-center justify-between px-6">
      <div className="flex items-center gap-2">
        {/* Logo */}
        <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center font-bold text-white">
          Z
        </div>
        <h1 className="text-xl font-bold text-[#d1d4dc] tracking-wide">
          Nex<span className="text-blue-500">Tick</span>
        </h1>
      </div>
      
      <div className="flex items-center gap-4">
        <button className="text-sm font-medium text-[#d1d4dc] hover:text-white transition-colors">
          Đăng nhập
        </button>
        <button className="text-sm font-medium bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors">
          Đăng ký
        </button>
      </div>
    </header>
  );
}