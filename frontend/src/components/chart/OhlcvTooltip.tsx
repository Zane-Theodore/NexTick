import { useState } from 'react';

import { formatChartValue, formatOhlcvLegendTime } from '../../utils/formatters';
import type { LegendData } from '../../types/chart';
import { CHART_DOWN_COLOR, CHART_UP_COLOR } from './chartConstants';

interface OhlcvTooltipProps {
  legendData: LegendData;
}

export default function OhlcvTooltip({ legendData }: OhlcvTooltipProps) {
  const [isOpen, setIsOpen] = useState(true);
  const candleColor = legendData.close >= legendData.open ? CHART_UP_COLOR : CHART_DOWN_COLOR;
  const changePercent = calculatePercent(legendData.close - legendData.open, legendData.open);
  const rangePercent = calculatePercent(legendData.high - legendData.low, legendData.open);

  return (
    <div className="pointer-events-none absolute left-0 top-1 z-20 flex max-w-[calc(100%-56px)] items-start">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="pointer-events-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-[#9099aa] transition-colors hover:border-[#6b7280] hover:text-white"
        title={isOpen ? 'Hide candle info' : 'Show candle info'}
      >
        <ChevronIcon isOpen={isOpen} />
      </button>

      <div
        className={`overflow-hidden transition-[max-width,opacity,transform] duration-300 ease-out ${
          isOpen ? 'max-w-[min(1100px,calc(100vw-72px))] opacity-100 translate-x-0' : 'max-w-0 opacity-0 -translate-x-3'
        }`}
      >
        <div className="flex min-h-7 flex-nowrap items-center gap-x-2 overflow-hidden font-mono text-xs font-medium leading-6 text-[#d1d4dc] whitespace-nowrap sm:text-sm">
          <span className="whitespace-nowrap font-semibold" style={{ color: candleColor }}>
            {formatOhlcvLegendTime(legendData.time)}
          </span>
          <OhlcvLegendValue label="Open" value={formatChartValue(legendData.open)} color={candleColor} />
          <OhlcvLegendValue label="High" value={formatChartValue(legendData.high)} color={candleColor} />
          <OhlcvLegendValue label="Low" value={formatChartValue(legendData.low)} color={candleColor} />
          <OhlcvLegendValue label="Close" value={formatChartValue(legendData.close)} color={candleColor} />
          <OhlcvLegendValue label="Volume" value={formatChartValue(legendData.volume)} color={candleColor} />
          <OhlcvLegendValue label="CHANGE" value={formatPercent(changePercent)} color={candleColor} />
          <OhlcvLegendValue label="Range" value={formatPercent(rangePercent)} color={candleColor} />
        </div>
      </div>
    </div>
  );
}

function ChevronIcon({ isOpen }: { isOpen: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={`h-4 w-4 transition-transform duration-300 ease-out ${
        isOpen ? 'rotate-0' : '-rotate-90'
      }`}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
    </svg>
  );
}

function OhlcvLegendValue({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <span className="inline-flex whitespace-nowrap">
      <span className="text-[#d1d4dc]">{label}</span>
      <span className="ml-1 font-semibold" style={{ color }}>{value}</span>
    </span>
  );
}

function calculatePercent(value: number, base: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(base) || base === 0) return 0;
  return (value / base) * 100;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0.00%';
  return `${value.toFixed(2)}%`;
}
