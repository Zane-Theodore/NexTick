import { formatChartValue } from '../../utils/formatters';
import type { VisiblePriceExtreme, VisiblePriceExtrema } from '../../types/chart';

const LABEL_HEIGHT = 18;
const LABEL_PADDING = 7;
const LINE_WIDTH = 52;
const EDGE_PADDING = 8;
const TEXT_SIZE = 12;

export default function VisibleExtremaOverlay({ extrema }: { extrema: VisiblePriceExtrema }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      <ExtremeMarker extreme={extrema.high} extrema={extrema} verticalPreference="above" />
      <ExtremeMarker extreme={extrema.low} extrema={extrema} verticalPreference="below" />
    </div>
  );
}

function ExtremeMarker({
  extreme,
  extrema,
  verticalPreference,
}: {
  extreme: VisiblePriceExtreme;
  extrema: VisiblePriceExtrema;
  verticalPreference: 'above' | 'below';
}) {
  const text = formatChartValue(extreme.value);
  const labelWidth = getLabelWidth(text);
  const layout = getMarkerLayout(extreme, extrema, labelWidth, verticalPreference);

  return (
    <div
      className="absolute font-mono text-xs leading-none text-white"
      style={{
        left: layout.labelLeft,
        top: layout.labelTop,
        width: labelWidth,
        height: LABEL_HEIGHT,
      }}
    >
      <span className="block whitespace-nowrap drop-shadow-[0_1px_1px_rgba(0,0,0,0.85)]">
        {text}
      </span>
      <span
        className="absolute h-px bg-white/90"
        style={{
          left: layout.lineLeft - layout.labelLeft,
          top: layout.lineTop - layout.labelTop,
          width: layout.lineWidth,
        }}
      />
    </div>
  );
}

function getMarkerLayout(
  extreme: VisiblePriceExtreme,
  extrema: VisiblePriceExtrema,
  labelWidth: number,
  verticalPreference: 'above' | 'below',
) {
  const clampedX = clamp(extreme.x, EDGE_PADDING, extrema.width - EDGE_PADDING);
  const hasLeftRoom = clampedX - LINE_WIDTH - labelWidth >= EDGE_PADDING;
  const hasRightRoom = clampedX + LINE_WIDTH + labelWidth <= extrema.width - EDGE_PADDING;
  const placeLeft = hasLeftRoom || !hasRightRoom;
  const anchorX = clampedX;
  const rawLabelLeft = placeLeft
    ? anchorX - LINE_WIDTH - labelWidth
    : anchorX + LINE_WIDTH;
  const labelLeft = clamp(rawLabelLeft, EDGE_PADDING, extrema.width - labelWidth - EDGE_PADDING);
  const lineStart = placeLeft ? labelLeft + labelWidth : anchorX;
  const lineEnd = placeLeft ? anchorX : labelLeft;
  const lineTop = extreme.y;
  const preferredLabelTop = verticalPreference === 'above'
    ? extreme.y - LABEL_HEIGHT - 3
    : extreme.y + 3;
  const labelTop = clamp(preferredLabelTop, EDGE_PADDING, extrema.height - LABEL_HEIGHT - EDGE_PADDING);

  return {
    labelLeft,
    labelTop,
    lineLeft: Math.min(lineStart, lineEnd),
    lineTop,
    lineWidth: Math.max(0, Math.abs(lineEnd - lineStart)),
  };
}

function getLabelWidth(text: string): number {
  return Math.ceil((text.length * TEXT_SIZE * 0.62) + LABEL_PADDING);
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}
