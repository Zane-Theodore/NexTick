import { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, ColorType, type Time } from 'lightweight-charts';
import type { IChartApi } from 'lightweight-charts';
import axios from 'axios';
import { io } from 'socket.io-client';

export default function TradingChart() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<any>(null);
  const currentCandleRef = useRef<any>(null);
  const tradesBufferRef = useRef<any[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

    const updateCandleFromBuffer = () => {
      if (tradesBufferRef.current.length === 0) {
        return;
      }

      const trades = tradesBufferRef.current;
      const firstTrade = trades[0];
      const lastTrade = trades[trades.length - 1];

      const tradeTime = new Date(firstTrade.timestamp);
      
      const tradeMinute = new Date(
        tradeTime.getFullYear(),
        tradeTime.getMonth(),
        tradeTime.getDate(),
        tradeTime.getHours(),
        tradeTime.getMinutes(),
        0,
        0
      );
      
      const utcSeconds = Math.floor(tradeMinute.getTime() / 1000);

      const candleTime = utcSeconds - timezoneOffsetSeconds;

      const prices = trades.map((t: any) => parseFloat(t.price));
      const volumes = trades.map((t: any) => parseFloat(t.volume));

      if (!currentCandleRef.current || currentCandleRef.current.time !== candleTime) {
        if (currentCandleRef.current) {
          console.log(' - Saving previous candle:', currentCandleRef.current);
          candlestickSeries.update(currentCandleRef.current);
        }

        const newCandle = {
          time: candleTime as Time,
          open: parseFloat(firstTrade.price),
          high: Math.max(...prices),
          low: Math.min(...prices),
          close: parseFloat(lastTrade.price),
          volume: volumes.reduce((a: number, b: number) => a + b, 0),
        };

        console.log('🆕 Creating new candle:', newCandle);
        currentCandleRef.current = newCandle;
        candlestickSeries.update(newCandle);
      } else {
        const updatedCandle = {
          ...currentCandleRef.current,
          high: Math.max(currentCandleRef.current.high, ...prices),
          low: Math.min(currentCandleRef.current.low, ...prices),
          close: parseFloat(lastTrade.price),
          volume: currentCandleRef.current.volume + volumes.reduce((a: number, b: number) => a + b, 0),
        };

        currentCandleRef.current = updatedCandle;
        candlestickSeries.update(updatedCandle);
      }

      tradesBufferRef.current = [];
    };

    const socket = io('http://localhost:3000', {
      transports: ['websocket', 'polling'],
      withCredentials: true,
    });

    socket.on('candle.created', (newCandleData: any) => {
      candlestickSeries.update(formatCandle(newCandleData));
      currentCandleRef.current = null;
      tradesBufferRef.current = [];
    });

    socket.on('trade.raw', (trade: any) => {
      tradesBufferRef.current.push(trade);
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

    intervalRef.current = setInterval(() => {
      updateCandleFromBuffer();
    }, 500);

    return () => {
      socket.disconnect();
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
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