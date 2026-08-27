import { useState } from 'react';

import { useMarketData } from '../../hooks/useMarketData';
import IndicatorLegend from '../indicators/IndicatorLegend';
import ChartFilterBar from './ChartFilterBar';
import OhlcvTooltip from './OhlcvTooltip';
import ScrollToLatestButton from './ScrollToLatestButton';
import VisibleExtremaOverlay from './VisibleExtremaOverlay';
import { DEFAULT_INDICATOR_SETTINGS, SUPPORTED_INTERVALS, SUPPORTED_SYMBOLS } from './chartConstants';
import { useTradingChartSetup } from './useTradingChartSetup';
import { useTradingChartState } from './useTradingChartState';

const COLLAPSED_LEGEND_HEIGHT = 28;
const OHLCV_LEGEND_TOP = 4;
const LEGEND_VERTICAL_GAP = 2;

interface TradingChartProps {
  symbol?: string;
  onSymbolChange?: (symbol: string) => void;
}

export default function TradingChart({ symbol: controlledSymbol, onSymbolChange }: TradingChartProps) {
  const [ohlcvLegendHeight, setOhlcvLegendHeight] = useState(COLLAPSED_LEGEND_HEIGHT);
  const chartState = useTradingChartState();
  const {
    chartContainerRef,
    chartInstanceRef,
    candlestickSeriesRef,
    volumeSeriesRef,
    indicatorSeriesRef,
    volumeByTimeRef,
    latestCandleRef,
    candleHistoryRef,
    isChartReady,
    symbol: chartSymbol,
    interval,
    legendData,
    visiblePriceExtrema,
    marketDataVersion,
    indicatorSettings,
    chartIndicatorSettings,
    chartViewSettings,
    visibleIndicatorValues,
    hiddenIndicatorGroups,
    paneLayouts,
    indicatorSettingsWindow,
    setSymbol: setChartSymbol,
    setInterval,
    setIsChartReady,
    setLegendData,
    setHoverIndicatorValues,
    setPaneLayouts,
    setVisiblePriceExtrema,
    setIndicatorSettingsWindow,
    handleIndicatorValuesChange,
    handleCandleHistoryChange,
    handleToggleIndicatorGroupVisibility,
    handleApplyIndicatorSettings,
    handleDismissIndicatorGroup,
    handleOpenIndicatorSettingsWindow,
    handleChartViewSettingsChange,
  } = chartState;
  const symbol = controlledSymbol ?? chartSymbol;
  const handleSymbolChange = onSymbolChange ?? setChartSymbol;

  useTradingChartSetup({
    chartContainerRef,
    chartInstanceRef,
    candlestickSeriesRef,
    volumeSeriesRef,
    indicatorSeriesRef,
    volumeByTimeRef,
    latestCandleRef,
    candleHistoryRef,
    indicatorSettings: chartIndicatorSettings,
    chartViewSettings,
    marketDataVersion,
    setIsChartReady,
    setLegendData,
    setHoverIndicatorValues,
    setPaneLayouts,
    setVisiblePriceExtrema,
    onChartViewSettingsChange: handleChartViewSettingsChange,
  });

  useMarketData(
    chartInstanceRef,
    candlestickSeriesRef,
    volumeSeriesRef,
    symbol,
    interval,
    volumeByTimeRef,
    latestCandleRef,
    candleHistoryRef,
    indicatorSeriesRef,
    indicatorSettings,
    chartIndicatorSettings,
    handleIndicatorValuesChange,
    handleCandleHistoryChange,
    isChartReady,
  );

  return (
    <div className="h-full flex flex-col bg-[#0b0f16] overflow-hidden">
      <ChartFilterBar
        symbol={symbol}
        interval={interval}
        supportedSymbols={SUPPORTED_SYMBOLS}
        supportedIntervals={SUPPORTED_INTERVALS}
        onSymbolChange={handleSymbolChange}
        onIntervalChange={setInterval}
        onOpenIndicatorSettings={() => handleOpenIndicatorSettingsWindow(null)}
      />

      <div className="min-h-0 flex flex-1">
        <div className="relative min-h-90 flex-1 overflow-hidden bg-[#0b0f16]">
          {legendData && (
            <OhlcvTooltip
              legendData={legendData}
              onHeightChange={setOhlcvLegendHeight}
            />
          )}

          <div ref={chartContainerRef} className="nextick-chart w-full h-full" />

          {visiblePriceExtrema && (
            <VisibleExtremaOverlay extrema={visiblePriceExtrema} />
          )}

          <IndicatorLegend
            settings={indicatorSettings}
            allSettings={indicatorSettings}
            allDefaultSettings={DEFAULT_INDICATOR_SETTINGS}
            values={visibleIndicatorValues}
            hiddenGroups={hiddenIndicatorGroups}
            paneLayouts={paneLayouts}
            mainPaneTopOffset={OHLCV_LEGEND_TOP + ohlcvLegendHeight + LEGEND_VERTICAL_GAP}
            settingsWindow={indicatorSettingsWindow}
            onToggleGroupVisibility={handleToggleIndicatorGroupVisibility}
            onDismissGroup={handleDismissIndicatorGroup}
            onOpenSettingsWindow={handleOpenIndicatorSettingsWindow}
            onCloseSettingsWindow={() => setIndicatorSettingsWindow(null)}
            onApplySettings={handleApplyIndicatorSettings}
          />

          <ScrollToLatestButton onClick={() => chartInstanceRef.current?.timeScale().scrollToPosition(10, false)} />
        </div>
      </div>
    </div>
  );
}
