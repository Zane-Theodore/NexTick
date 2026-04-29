import { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, ColorType } from 'lightweight-charts';
import type { IChartApi } from 'lightweight-charts';
import axios from 'axios';
import { io } from 'socket.io-client';

export default function TradingChart() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<any>(null);

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

    candlestickSeriesRef.current = candlestickSeries;

    const timezoneOffsetSeconds = new Date().getTimezoneOffset() * 60;

    const formatCandle = (candle: any) => {
      const utcSeconds = Math.floor(new Date(candle.timestamp).getTime() / 1000);
      
      // Validate dữ liệu candle
      if (!candle.open || !candle.high || !candle.low || !candle.close) {
        console.error('❌ Invalid candle data:', { 
          open: candle.open, 
          high: candle.high, 
          low: candle.low, 
          close: candle.close 
        });
        return null;
      }
      
      return {
        time: (utcSeconds - timezoneOffsetSeconds) as any,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      };
    };

    const fetchHistory = async () => {
      try {
        const { data } = await axios.get('http://localhost:3000/candles?symbol=BTCUSDT&limit=1000');
        candlestickSeries.setData(data.data.map(formatCandle));
      } catch (error) {
        console.error('API Error:', error);
      }
    };

    fetchHistory();

    const socket = io('http://localhost:3000', {
      transports: ['websocket', 'polling'],
      withCredentials: true,
    });

    // Lắng nghe candle.updating từ server (được tính từ Python processor)
    socket.on('candle.updating', (updatingCandleData: any) => {
      const formattedCandle = formatCandle(updatingCandleData);
      if (formattedCandle) {
        candlestickSeries.update(formattedCandle);
        console.log('📊 Updated candle:', formattedCandle);
      } else {
        console.warn('⚠️ Received invalid candle.updating data:', updatingCandleData);
      }
    });

    // Lắng nghe candle.created để nhận nến chốt phút
    socket.on('candle.created', (newCandleData: any) => {
      const formattedCandle = formatCandle(newCandleData);
      if (formattedCandle) {
        candlestickSeries.update(formattedCandle);
        console.log('✅ Final candle:', formattedCandle);
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