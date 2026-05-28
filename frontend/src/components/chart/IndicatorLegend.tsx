import type { IndicatorValue } from '../../types/chart';
import { formatChartValue } from '../../utils/formatters';
import { INDICATOR_CONFIG } from './chartConstants';
import IndicatorEyeIcon from './IndicatorEyeIcon';

interface IndicatorLegendProps {
  values: IndicatorValue[];
  isOpen: boolean;
  areEmaVisible: boolean;
  areMaVisible: boolean;
  onToggleOpen: () => void;
  onToggleEma: () => void;
  onToggleMa: () => void;
}

export default function IndicatorLegend({
  values,
  isOpen,
  areEmaVisible,
  areMaVisible,
  onToggleOpen,
  onToggleEma,
  onToggleMa,
}: IndicatorLegendProps) {
  return (
    <div className="absolute left-0 top-2 z-10 flex items-start">
      <button
        type="button"
        onClick={onToggleOpen}
        className="h-7 w-7 text-[#d1d4dc] hover:text-white flex items-center justify-center transition-colors"
        title={isOpen ? 'Hide indicators' : 'Show indicators'}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`h-4 w-4 transition-transform duration-300 ease-out ${
            isOpen ? 'rotate-0' : '-rotate-90'
          }`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      <div
        className={`overflow-hidden transition-[max-width,opacity,transform] duration-300 ease-out ${
          isOpen ? 'max-w-130 opacity-100 translate-x-0' : 'max-w-0 opacity-0 -translate-x-3'
        }`}
      >
        <div className="px-1.5 py-1 flex flex-col gap-y-1 font-mono text-xs whitespace-nowrap">
          <IndicatorLegendRow
            kind="ema"
            label="EMA"
            values={values}
            isVisible={areEmaVisible}
            onToggleVisibility={onToggleEma}
          />
          <IndicatorLegendRow
            kind="ma"
            label="MA"
            values={values}
            isVisible={areMaVisible}
            onToggleVisibility={onToggleMa}
          />
        </div>
      </div>
    </div>
  );
}

interface IndicatorLegendRowProps {
  kind: IndicatorValue['kind'];
  label: string;
  values: IndicatorValue[];
  isVisible: boolean;
  onToggleVisibility: () => void;
}

function IndicatorLegendRow({ kind, label, values, isVisible, onToggleVisibility }: IndicatorLegendRowProps) {
  return (
    <div className="min-h-5 flex flex-nowrap items-center gap-x-3 border border-transparent hover:border-[#6b7280] rounded-sm transition-colors duration-200 px-1">
      {INDICATOR_CONFIG.map(({ period, color }) => {
        const indicatorValue = values.find((value) => value.kind === kind && value.period === period);

        return (
          <span key={`${kind}-${period}`} style={{ color }} className="whitespace-nowrap">
            {label}({period}): {indicatorValue ? formatChartValue(indicatorValue.value) : '--'}
          </span>
        );
      })}
      <button
        type="button"
        onClick={onToggleVisibility}
        className="h-5 w-5 shrink-0 text-[#9099aa] hover:text-white flex items-center justify-center transition-colors"
        title={isVisible ? `Hide ${label} lines` : `Show ${label} lines`}
      >
        <IndicatorEyeIcon isVisible={isVisible} />
      </button>
    </div>
  );
}
