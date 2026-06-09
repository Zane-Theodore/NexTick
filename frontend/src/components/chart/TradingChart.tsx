import { useMarketData } from '../../hooks/useMarketData';
import IndicatorLegend from '../indicators/IndicatorLegend';
import ChartFilterBar from './ChartFilterBar';
import OhlcvTooltip from './OhlcvTooltip';
import ScrollToLatestButton from './ScrollToLatestButton';
import VisibleExtremaOverlay from './VisibleExtremaOverlay';
import { DEFAULT_INDICATOR_SETTINGS, SUPPORTED_INTERVALS, SUPPORTED_SYMBOLS } from './chartConstants';
import { useTradingChartSetup } from './useTradingChartSetup';
import { useTradingChartState } from './useTradingChartState';

export default function TradingChart() {
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
    symbol,
    interval,
    legendData,
    visiblePriceExtrema,
    marketDataVersion,
    indicatorSettings,
    chartIndicatorSettings,
    visibleIndicatorValues,
    hiddenIndicatorGroups,
    paneLayouts,
    indicatorSettingsWindow,
    setSymbol,
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
  } = chartState;

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
    marketDataVersion,
    setIsChartReady,
    setLegendData,
    setHoverIndicatorValues,
    setPaneLayouts,
    setVisiblePriceExtrema,
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
    handleIndicatorValuesChange,
    handleCandleHistoryChange,
    isChartReady,
  );

  return (
    <div className="h-full flex flex-col bg-[#0f1117] overflow-hidden">
      <ChartFilterBar
        symbol={symbol}
        interval={interval}
        supportedSymbols={SUPPORTED_SYMBOLS}
        supportedIntervals={SUPPORTED_INTERVALS}
        onSymbolChange={setSymbol}
        onIntervalChange={setInterval}
        onOpenIndicatorSettings={() => handleOpenIndicatorSettingsWindow(null)}
      />

      <div className="min-h-0 flex flex-1">
        <div className="relative min-h-90 flex-1 overflow-hidden bg-[#0b0f16]">
          {legendData && (
            <OhlcvTooltip
              legendData={legendData}
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
