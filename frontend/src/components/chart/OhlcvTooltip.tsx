import { formatChartValue, formatTooltipTime } from '../../utils/formatters';
import type { CursorPosition, LegendData } from '../../types/chart';

interface OhlcvTooltipProps {
  symbol: string;
  interval: string;
  legendData: LegendData;
  cursorPosition: CursorPosition;
}

export default function OhlcvTooltip({ symbol, interval, legendData, cursorPosition }: OhlcvTooltipProps) {
  return (
    <div
      className="absolute z-20 pointer-events-none"
      style={{
        left: `${cursorPosition.x + 16}px`,
        top: `${cursorPosition.y + 16}px`,
      }}
    >
      <div className="min-w-60 bg-[#151a23]/95 border border-[#3f4654] rounded-lg px-4 py-3 shadow-lg backdrop-blur-sm">
        <div className="font-mono text-sm text-[#d1d4dc] space-y-1.5">
          <div className="font-bold text-base text-white">
            {symbol} {'\u2022'} {interval}
          </div>
          <div className="text-xs text-[#9099aa] mb-2 border-b border-[#3f4654] pb-2">
            {formatTooltipTime(legendData.time)}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <span className="text-[#9099aa]">Open:</span>
            <span className="text-white font-semibold">{formatChartValue(legendData.open)}</span>

            <span className="text-[#26a69a]">High:</span>
            <span className="text-[#26a69a] font-semibold">{formatChartValue(legendData.high)}</span>

            <span className="text-[#ef5350]">Low:</span>
            <span className="text-[#ef5350] font-semibold">{formatChartValue(legendData.low)}</span>

            <span className="text-[#9099aa]">Close:</span>
            <span className="text-white font-semibold">{formatChartValue(legendData.close)}</span>

            <span className="text-[#9099aa]">Volume:</span>
            <span className="text-white font-semibold">{formatChartValue(legendData.volume)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
