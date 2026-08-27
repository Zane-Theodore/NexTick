import { useState } from 'react';
import { formatIntervalLabel } from './chartConstants';

interface ChartFilterBarProps {
  symbol: string;
  interval: string;
  supportedSymbols: string[];
  supportedIntervals: string[];
  onSymbolChange: (symbol: string) => void;
  onIntervalChange: (interval: string) => void;
  onOpenIndicatorSettings: () => void;
}

interface FilterDropdownProps {
  label: string;
  value: string;
  options: string[];
  widthClass: string;
  onChange: (value: string) => void;
  formatOptionLabel?: (value: string) => string;
}

function FilterDropdown({ label, value, options, widthClass, onChange, formatOptionLabel = (option) => option }: FilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedLabel = formatOptionLabel(value);

  return (
    <div
      className="relative flex w-fit items-center rounded border border-[#3f4654] bg-[#151a23]"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setIsOpen(false);
        }
      }}
    >
      <span className="shrink-0 border-r border-[#3f4654] px-3 text-xs font-semibold uppercase tracking-wide text-[#9099aa]">
        {label}
      </span>

      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className={`relative h-10 ${widthClass} bg-[#151a23] py-0 pl-3 pr-8 text-left text-sm font-semibold text-[#d1d4dc] outline-none transition-colors hover:text-white focus:text-white`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="block truncate">{selectedLabel}</span>
        <span
          className={`pointer-events-none absolute right-3 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 border-b-2 border-r-2 border-[#9099aa] transition-transform duration-200 ${
            isOpen ? 'mt-1 rotate-225' : ''
          }`}
        />
      </button>

      <div
        className={`absolute left-0 top-[calc(100%+6px)] z-50 w-full overflow-hidden rounded border border-[#3f4654] bg-[#151a23] shadow-2xl shadow-black/40 transition-all duration-200 ease-out ${
          isOpen
            ? 'translate-y-0 scale-100 opacity-100'
            : 'pointer-events-none -translate-y-1 scale-[0.98] opacity-0'
        }`}
      >
        <div className="max-h-64 overflow-y-auto py-1" role="listbox">
          {options.map((option) => {
            const optionLabel = formatOptionLabel(option);

            return (
              <button
                key={option}
                type="button"
                onClick={() => {
                  onChange(option);
                  setIsOpen(false);
                }}
                className={`block w-full px-3 py-2 text-left text-sm transition-colors ${
                  option === value
                    ? 'bg-[#24466a] text-white'
                    : 'text-[#d1d4dc] hover:bg-[#1b2f49] hover:text-white'
                }`}
                role="option"
                aria-selected={option === value}
              >
                {optionLabel}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function ChartFilterBar({
  symbol,
  interval,
  supportedSymbols,
  supportedIntervals,
  onSymbolChange,
  onIntervalChange,
  onOpenIndicatorSettings,
}: ChartFilterBarProps) {
  return (
    <div className="shrink-0 border-b border-[#3f4654] bg-[#0b0f16] px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <FilterDropdown
          label="Symbol"
          value={symbol}
          options={supportedSymbols}
          widthClass="w-[132px]"
          onChange={onSymbolChange}
        />

        <FilterDropdown
          label="Interval"
          value={interval}
          options={supportedIntervals}
          widthClass="w-[132px]"
          onChange={onIntervalChange}
          formatOptionLabel={formatIntervalLabel}
        />

        <button
          type="button"
          onClick={onOpenIndicatorSettings}
          className="flex h-10 w-10 items-center justify-center rounded border border-[#3f4654] bg-[#151a23] text-[#9099aa] outline-none transition-colors hover:border-[#6b7280] hover:text-white focus:border-[#6b7280] focus:text-white"
          title="Indicator settings"
          aria-label="Indicator settings"
        >
          <LineChartIcon />
        </button>
      </div>
    </div>
  );
}

function LineChartIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M3 16.5h14M4 13l3.4-3.2 2.7 2.2L15.5 5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 5h1.8v1.8"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
