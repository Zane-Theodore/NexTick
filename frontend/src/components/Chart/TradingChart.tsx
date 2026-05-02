import { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, ColorType } from 'lightweight-charts';
import type { ISeriesApi, IChartApi } from 'lightweight-charts';

import { useMarketData } from '../../hooks/useMarketData';

const SUPPORTED_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT'];
const SUPPORTED_INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'];

export default function TradingChart() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  
  const [chartInstance, setChartInstance] = useState<IChartApi | null>(null);
  const [series, setSeries] = useState<ISeriesApi<"Candlestick"> | null>(null);
  const [symbol, setSymbol] = useState<string>('BTCUSDT');
  const [interval, setInterval] = useState<string>('1m');
  const [loading, setLoading] = useState(false);

  useMarketData(chartInstance, series, symbol, interval);

  // Handle symbol change
  const handleSymbolChange = (newSymbol: string) => {
    setLoading(true);
    setSymbol(newSymbol);
  };

  // Handle interval change
  const handleIntervalChange = (newInterval: string) => {
    setLoading(true);
    setInterval(newInterval);
  };

  // Mark loading as complete when chart updates
  useEffect(() => {
    if (chartInstance && series && loading) {
      const timer = setTimeout(() => setLoading(false), 500);
      return () => clearTimeout(timer);
    }
  }, [symbol, interval, chartInstance, series, loading]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 800,
      layout: {
        background: { type: ColorType.Solid, color: '#131722' },
        textColor: '#d1d4dc',
        attributionLogo: false,
      },
      handleScale: {
        axisPressedMouseMove: {
          time: true,
          price: false,
        },
      },
      rightPriceScale: {
        autoScale: true,
        alignLabels: true,
        borderVisible: false,
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
      },
      grid: {
        vertLines: { color: '#2B2B43' },
        horzLines: { color: '#2B2B43' },
      },
      timeScale: { 
        timeVisible: true, 
        secondsVisible: false, 
        rightOffset: 10,
        minBarSpacing: 10,
        maxBarSpacing: 50,
      },
      localization: {
        priceFormatter: (price: number) => {
          return new Intl.NumberFormat('vi-VN', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }).format(price);
        },
      },
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });

    setChartInstance(chart);
    setSeries(candlestickSeries);

    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 0 || entries[0].target !== chartContainerRef.current) return;
      chart.applyOptions({ width: entries[0].contentRect.width });
    });
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#131722] pt-5">
      {/* Filter Bar */}
      <div className="px-5 pb-4 flex items-center gap-6 bg-[#131722] border-b border-[#2B2B43]">
        {/* Symbol Selector */}
        <div className="flex flex-col">
          <label className="text-xs text-[#9099aa] mb-2 font-semibold">Symbol</label>
          <select
            value={symbol}
            onChange={(e) => handleSymbolChange(e.target.value)}
            className="px-3 py-2 bg-[#1e1e2e] border border-[#3f3f5a] text-[#d1d4dc] rounded hover:border-[#5a5a7a] focus:border-blue-500 focus:outline-none transition-colors"
          >
            {SUPPORTED_SYMBOLS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* Interval Selector */}
        <div className="flex flex-col">
          <label className="text-xs text-[#9099aa] mb-2 font-semibold">Interval</label>
          <div className="flex gap-2">
            {SUPPORTED_INTERVALS.map((iv) => (
              <button
                key={iv}
                onClick={() => handleIntervalChange(iv)}
                className={`px-3 py-2 rounded text-sm font-medium transition-all border ${
                  interval === iv
                    ? 'bg-blue-600 border-blue-500 text-white shadow-lg'
                    : 'bg-[#1e1e2e] border-[#3f3f5a] text-[#d1d4dc] hover:border-[#5a5a7a]'
                }`}
              >
                {iv}
              </button>
            ))}
          </div>
        </div>

        {/* Loading Indicator */}
        {loading && (
          <div className="flex items-center gap-2 ml-auto">
            <div className="w-3 h-3 rounded-full bg-blue-500 animate-pulse" />
            <span className="text-xs text-[#9099aa]">Loading...</span>
          </div>
        )}

        {/* Current Info */}
        <div className="ml-auto text-right">
          <div className="text-sm text-[#d1d4dc] font-semibold">
            {symbol} • {interval}
          </div>
          <div className="text-xs text-[#9099aa]">Real-time updates</div>
        </div>
      </div>

      {/* Chart */}
      <div 
        ref={chartContainerRef} 
        className="w-full border-y border-[#2B2B43]"
      />

      {/* Scroll to Latest Button */}
      <button 
        onClick={() => chartInstance?.timeScale().scrollToPosition(10, false)}
        className="absolute bottom-8 right-20 z-10 w-10 h-10 bg-[#2B2B43]/80 hover:bg-blue-600 text-[#d1d4dc] hover:text-white rounded-full flex items-center justify-center backdrop-blur shadow-lg transition-all border border-[#3f3f5a] hover:border-blue-500"
        title="Scroll to latest"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
    </div>
  );
}