const timezoneOffsetSeconds = new Date().getTimezoneOffset() * 60;

export const formatCandle = (candle: any) => {
  const utcSeconds = Math.floor(new Date(candle.timestamp).getTime() / 1000);
  
  if (!candle.open || !candle.high || !candle.low || !candle.close) {
    console.error('✗ Invalid candle data:', { 
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