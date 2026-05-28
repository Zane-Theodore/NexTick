interface ChartFilterBarProps {
  symbol: string;
  interval: string;
  supportedSymbols: string[];
  supportedIntervals: string[];
  onSymbolChange: (symbol: string) => void;
  onIntervalChange: (interval: string) => void;
}

export default function ChartFilterBar({
  symbol,
  interval,
  supportedSymbols,
  supportedIntervals,
  onSymbolChange,
  onIntervalChange,
}: ChartFilterBarProps) {
  return (
    <div className="shrink-0 px-5 py-4 flex items-center gap-6 bg-[#0f1117] border-b border-[#3f4654]">
      <div className="flex flex-col">
        <label className="text-xs text-[#9099aa] mb-2 font-semibold">Symbol</label>
        <select
          value={symbol}
          onChange={(event) => onSymbolChange(event.target.value)}
          className="px-3 py-2 bg-[#151a23] border border-[#3f4654] text-[#d1d4dc] rounded hover:border-[#6b7280] focus:border-blue-500 focus:outline-none transition-colors"
        >
          {supportedSymbols.map((supportedSymbol) => (
            <option key={supportedSymbol} value={supportedSymbol}>
              {supportedSymbol}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col">
        <label className="text-xs text-[#9099aa] mb-2 font-semibold">Interval</label>
        <div className="flex gap-2">
          {supportedIntervals.map((supportedInterval) => (
            <button
              key={supportedInterval}
              onClick={() => onIntervalChange(supportedInterval)}
              className={`px-3 py-2 rounded text-sm font-medium transition-all border ${
                interval === supportedInterval
                  ? 'bg-blue-600 border-blue-500 text-white shadow-lg'
                  : 'bg-[#151a23] border-[#3f4654] text-[#d1d4dc] hover:border-[#6b7280]'
              }`}
            >
              {supportedInterval}
            </button>
          ))}
        </div>
      </div>

      <div className="ml-auto text-right">
        <div className="text-sm text-[#d1d4dc] font-semibold">
          {symbol} {'\u2022'} {interval}
        </div>
        <div className="text-xs text-[#9099aa]">Real-time updates</div>
      </div>
    </div>
  );
}
