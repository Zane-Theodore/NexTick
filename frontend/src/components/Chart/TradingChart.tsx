import { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, ColorType } from 'lightweight-charts';
import type { ISeriesApi, IChartApi } from 'lightweight-charts';

import { useMarketData } from '../../hooks/useMarketData';

export default function TradingChart() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  
  const [chartInstance, setChartInstance] = useState<IChartApi | null>(null);
  const [series, setSeries] = useState<ISeriesApi<"Candlestick"> | null>(null);

  useMarketData(chartInstance, series, 'BTCUSDT');

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
      <div 
        ref={chartContainerRef} 
        className="w-full border-y border-[#2B2B43]"
      />

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