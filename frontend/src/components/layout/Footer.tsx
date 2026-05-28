export default function Footer() {
  return (
    <footer className="h-10 bg-[#10141c] border-t border-[#3f4654] flex items-center justify-between px-6 shrink-0 z-40 relative">
      <div className="text-xs text-[#d1d4dc]/60">
        © 2026 NexTick. Crafted by <span className="text-blue-500 font-medium hover:text-blue-400 transition-colors cursor-pointer">Zaneth</span>.
      </div>

      <div className="flex items-center gap-4 text-xs text-[#d1d4dc]/60">
        <a href="#" className="hover:text-white transition-colors">Terms</a>
        <a href="#" className="hover:text-white transition-colors">Privacy</a>
        <span className="w-1 h-1 rounded-full bg-[#3f4654]"></span>
        
        <div className="flex items-center gap-1.5 cursor-pointer hover:text-white transition-colors">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
          API: Online
        </div>
      </div>
    </footer>
  );
}
