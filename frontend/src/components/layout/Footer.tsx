import { useApiHealthStatus } from './useApiHealthStatus';
import type { ApiStatus } from './useApiHealthStatus';

const statusConfig: Record<ApiStatus, { label: string; dotClassName: string }> = {
  checking: {
    label: 'Checking...',
    dotClassName: 'bg-yellow-400',
  },
  online: {
    label: 'Online',
    dotClassName: 'bg-green-500 animate-pulse',
  },
  offline: {
    label: 'Offline',
    dotClassName: 'bg-red-500',
  },
};

export default function Footer() {
  const apiStatus = useApiHealthStatus();
  const { label, dotClassName } = statusConfig[apiStatus];

  return (
    <footer className="h-10 bg-[#10141c] border-t border-[#3f4654] flex items-center justify-between px-6 shrink-0 z-40 relative">
      <div className="text-xs text-[#d1d4dc]/60">
        &copy; 2026 NexTick. Crafted by <span className="text-blue-500 font-medium hover:text-blue-400 transition-colors cursor-pointer">Zaneth</span>.
      </div>

      <div className="flex items-center gap-4 text-xs text-[#d1d4dc]/60">
        <a href="/terms" className="hover:text-white transition-colors">Terms</a>
        <a href="/privacy" className="hover:text-white transition-colors">Privacy</a>
        <span className="w-1 h-1 rounded-full bg-[#3f4654]"></span>
        
        <div className="flex items-center gap-1.5 whitespace-nowrap">
          <span className={`w-2 h-2 rounded-full ${dotClassName}`}></span>
          API: {label}
        </div>
      </div>
    </footer>
  );
}
