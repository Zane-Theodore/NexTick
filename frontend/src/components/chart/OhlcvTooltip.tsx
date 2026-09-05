import { useLayoutEffect, useRef, useState } from 'react';

import { formatChartValue, formatOhlcvLegendTime } from '../../utils/formatters';
import type { LegendData } from '../../types/chart';

const COLLAPSED_TOOLTIP_HEIGHT = 28;
const OHLCV_UP_COLOR = '#2dd4bf';
const OHLCV_DOWN_COLOR = '#ff6b6b';

interface OhlcvTooltipProps {
  legendData: LegendData;
  onHeightChange?: (height: number) => void;
}

export default function OhlcvTooltip({ legendData, onHeightChange }: OhlcvTooltipProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [reservesExpandedHeight, setReservesExpandedHeight] = useState(true);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const candleColor = legendData.close >= legendData.open ? OHLCV_UP_COLOR : OHLCV_DOWN_COLOR;
  const changePercent = calculatePercent(legendData.close - legendData.open, legendData.open);
  const rangePercent = calculatePercent(legendData.high - legendData.low, legendData.open);

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    if (!tooltip || !onHeightChange) return;

    const reportHeight = () => onHeightChange(
      reservesExpandedHeight ? tooltip.getBoundingClientRect().height : COLLAPSED_TOOLTIP_HEIGHT,
    );
    const resizeObserver = new ResizeObserver(reportHeight);

    resizeObserver.observe(tooltip);
    reportHeight();

    return () => resizeObserver.disconnect();
  }, [onHeightChange, reservesExpandedHeight]);

  const handleToggle = () => {
    if (isOpen) {
      setIsOpen(false);
      return;
    }

    setReservesExpandedHeight(true);
    setIsOpen(true);
  };

  return (
    <div
      ref={tooltipRef}
      className="pointer-events-none absolute left-0 right-20 top-1 z-20 flex items-start"
      style={{ containerType: 'inline-size' }}
    >
      <button
        type="button"
        onClick={handleToggle}
        className="pointer-events-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-[#9099aa] transition-colors hover:border-[#6b7280] hover:text-white"
        title={isOpen ? 'Hide candle info' : 'Show candle info'}
      >
        <ChevronIcon isOpen={isOpen} />
      </button>

      <div
        className={`min-w-0 overflow-hidden transition-[max-width,opacity,transform] duration-300 ease-out ${
          isOpen ? 'max-w-[min(1100px,calc(100%-28px))] opacity-100 translate-x-0' : 'max-w-0 opacity-0 -translate-x-3'
        }`}
        onTransitionEnd={(event) => {
          if (event.propertyName === 'max-width' && !isOpen) {
            setReservesExpandedHeight(false);
          }
        }}
      >
        <div className="w-[min(1100px,calc(100cqw-28px))]">
          <div className="pointer-events-auto flex min-h-7 w-fit max-w-full flex-wrap items-center gap-x-2 rounded-md border border-transparent px-1 font-mono text-[11px] font-medium leading-6 text-white transition-colors hover:border-[#6b7280]">
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
      <span className="text-white">{label}:</span>
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
