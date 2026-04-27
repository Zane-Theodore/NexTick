import { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, ColorType } from 'lightweight-charts';
import type { IChartApi } from 'lightweight-charts';
import axios from 'axios';
import { io } from 'socket.io-client';

export default function TradingChart() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 500,
      layout: {
        background: { type: ColorType.Solid, color: '#131722' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: '#2B2B43' },
        horzLines: { color: '#2B2B43' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
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

    const formatCandle = (candle: any) => ({
      time: Math.floor(new Date(candle.timestamp).getTime() / 1000) as any,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    });

    const fetchHistory = async () => {
      try {
        const { data } = await axios.get('http://localhost:3000/candles?symbol=BTCUSDT&limit=100');
        candlestickSeries.setData(data.data.map(formatCandle));
      } catch (error) {
        console.error('API Error:', error);
      }
    };

    fetchHistory();

    const socket = io('http://localhost:3000');

    socket.on('candle.created', (newCandleData: any) => {
      candlestickSeries.update(formatCandle(newCandleData));
    });

    return () => {
      socket.disconnect();
      chart.remove();
    };
  }, []);

  return (
    <div style={{ padding: '20px', backgroundColor: '#000', minHeight: '100vh' }}>
      <h2 style={{ color: 'white', textAlign: 'center', fontFamily: 'sans-serif', marginBottom: '20px' }}>
        NexTick - BTC/USDT Live Chart
      </h2>
      <div 
        ref={chartContainerRef} 
        style={{ width: '100%', maxWidth: '1000px', margin: '0 auto', border: '1px solid #2B2B43' }} 
      />
    </div>
  );
}