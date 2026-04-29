import { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, ColorType } from 'lightweight-charts';
import type { IChartApi } from 'lightweight-charts';

import { formatCandle } from '../utils/formatters';

export default function TradingChart() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<any>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 900,
      layout: {
        background: { type: ColorType.Solid, color: '#131722' },
        textColor: '#d1d4dc',
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: '#2B2B43' },
        horzLines: { color: '#2B2B43' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
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

    chartRef.current = chart;

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });

    candlestickSeriesRef.current = candlestickSeries;

    const fetchHistory = async () => {
      try {
        const rawCandles = await getHistoricalCandles('BTCUSDT', 1000);
        candlestickSeries.setData(rawCandles.map(formatCandle));
        chart.timeScale().fitContent(); 
      } catch (error) {
        console.error('API Error:', error);
      }
    };

    fetchHistory();

    const socket = io('http://localhost:3000', {
      transports: ['websocket', 'polling'],
      withCredentials: true,
    });

    socket.on('candle.updating', (updatingCandleData: any) => {
      const formattedCandle = formatCandle(updatingCandleData);
      if (formattedCandle) {
        candlestickSeries.update(formattedCandle);
        console.log('📊 Updated candle:', formattedCandle);
      } else {
        console.warn('⚠️ Received invalid candle.updating data:', updatingCandleData);
      }
    });

    socket.on('candle.created', (newCandleData: any) => {
      const formattedCandle = formatCandle(newCandleData);
      if (formattedCandle) {
        candlestickSeries.update(formattedCandle);
        console.log('✓ Final candle:', formattedCandle);
      } else {
        console.warn('⚠️ Received invalid candle.created data:', newCandleData);
      }
    });

    socket.on('connect', () => {
      console.log('✓ WebSocket connected');
    });

    socket.on('disconnect', () => {
      console.log('✗ WebSocket disconnected');
    });

    socket.on('error', (error: any) => {
      console.error('✗ WebSocket error:', error);
    });

    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 0 || entries[0].target !== chartContainerRef.current) return;
      const newRect = entries[0].contentRect;
      chart.applyOptions({ width: newRect.width });
    });
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      socket.disconnect();
      chart.remove();
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#131722] pt-5">
      <h2 className="text-[#d1d4dc] text-center font-sans mb-5 text-2xl font-bold">
        NexTick - BTC/USDT Live Chart
      </h2>
      <div 
        ref={chartContainerRef} 
        className="w-full border-y border-[#2B2B43]"
      />
    </div>
  );
}