import json
from datetime import datetime, timedelta
import psycopg2
from kafka import KafkaConsumer, KafkaProducer
import threading
import time

from data_pipeline import config
from data_pipeline.logger_config import get_logger

logger = get_logger(__name__)


class IntervalManager:
    """
    Manages candle generation for all configured intervals.
    
    Design: Each interval (1m, 5m, etc.) is processed independently
    - Stores all raw trades in a buffer
    - Calculates OHLCV for each interval from the raw trades buffer
    - Broadcasts updates for each interval separately
    """
    
    def __init__(self, symbol: str, intervals: list):
        """
        Initialize interval manager for a symbol.
        
        Args:
            symbol: Trading symbol (e.g., 'btcusdt')
            intervals: List of interval strings (e.g., ['1m', '5m', '1h'])
        """
        self.symbol = symbol.lower()
        self.intervals = intervals
        
        # Dictionary to track current minute for each interval
        # Key: interval, Value: current_minute timestamp
        self.current_minute = {}
        
        # Shared raw trades buffer - all trades for this symbol
        self.trades_buffer = []
        self.lock = threading.Lock()
        
        # Timer for broadcasting updates
        self.update_timer = None
        self.running = True
        
        # Track first trade price for each interval
        self.first_trade_price = {}
        
        logger.info(f"Initialized interval manager for {self.symbol.upper()} with intervals: {', '.join(intervals)}")

    def get_interval_minutes(self, interval: str) -> int:
        """Convert interval string to minutes."""
        if interval.endswith('m'):
            return int(interval[:-1])
        elif interval.endswith('h'):
            return int(interval[:-1]) * 60
        elif interval.endswith('d'):
            return int(interval[:-1]) * 24 * 60
        else:
            raise ValueError(f"Unsupported interval format: {interval}")

    def truncate_to_interval(self, timestamp: datetime, interval: str) -> datetime:
        """Truncate timestamp to the start of interval period."""
        minutes = self.get_interval_minutes(interval)
        total_minutes = int(timestamp.timestamp() / 60)
        interval_start_minutes = (total_minutes // minutes) * minutes
        return datetime.fromtimestamp(interval_start_minutes * 60)

    def calculate_ohlcv(self, interval: str) -> dict:
        """
        Calculate OHLCV for a specific interval from trades buffer.
        
        Filters trades that belong to the current interval period.
        """
        if not self.trades_buffer:
            return None
        
        current_minute = self.current_minute.get(interval)
        if not current_minute:
            return None
        
        # Filter trades for this interval period
        minutes = self.get_interval_minutes(interval)
        interval_end = current_minute + timedelta(minutes=minutes)
        
        trades_in_interval = [
            t for t in self.trades_buffer
            if current_minute <= t['datetime'] < interval_end
        ]
        
        if not trades_in_interval:
            return None
        
        prices = [t['price'] for t in trades_in_interval]
        volumes = [t['volume'] for t in trades_in_interval]
        
        if not prices or not volumes:
            return None
        
        open_price = prices[0]
        high_price = max(prices)
        low_price = min(prices)
        close_price = prices[-1]
        total_volume = sum(volumes)
        
        # Validation
        if open_price <= 0 or high_price <= 0 or low_price <= 0 or close_price <= 0:
            logger.warning(
                f"Invalid OHLCV for {self.symbol.upper()} [{interval}]: "
                f"O={open_price}, H={high_price}, L={low_price}, C={close_price}"
            )
            return None
        
        return {
            'symbol': self.symbol.upper(),
            'interval': interval,
            'timestamp': current_minute,
            'open': open_price,
            'high': high_price,
            'low': low_price,
            'close': close_price,
            'volume': total_volume
        }

    def should_process_interval(self, trade_time: datetime, interval: str) -> bool:
        """Check if trade time indicates a new interval period for this interval."""
        if interval not in self.current_minute:
            return False
        
        trade_minute = self.truncate_to_interval(trade_time, interval)
        return trade_minute > self.current_minute[interval]

    def schedule_next_update(self):
        """Schedule periodic candle updates for all intervals."""
        if self.running and not self.update_timer:
            self.update_timer = threading.Timer(
                config.CANDLE_UPDATE_INTERVAL_MS / 1000.0,
                self._emit_updating_candles
            )
            self.update_timer.daemon = True
            self.update_timer.start()

    def _emit_updating_candles(self):
        """Broadcast updating candles for all intervals."""
        if not self.running:
            return
        
        with self.lock:
            for interval in self.intervals:
                if self.current_minute.get(interval) and self.trades_buffer:
                    candle = self.calculate_ohlcv(interval)
                    if candle:
                        # Broadcast as updating (is_final=False)
                        self._broadcast_candle(candle, is_final=False)
        
        if self.running:
            self.update_timer = threading.Timer(
                config.CANDLE_UPDATE_INTERVAL_MS / 1000.0,
                self._emit_updating_candles
            )
            self.update_timer.daemon = True
            self.update_timer.start()

    def _broadcast_candle(self, candle: dict, is_final: bool):
        """
        Broadcast candle to Kafka topic.
        
        Topic: TOPIC_KLINE_STREAM
        Message includes: symbol, interval, OHLCV, is_final flag
        """
        kafka_candle = candle.copy()
        kafka_candle['is_final'] = is_final
        kafka_candle['timestamp'] = kafka_candle['timestamp'].isoformat()
        
        # This will be broadcasted by CandleProcessor
        return kafka_candle

    def cleanup(self):
        """Clean up resources."""
        self.running = False
        if self.update_timer:
            self.update_timer.cancel()


class CandleProcessor:
    """
    Processes raw trade data and generates candles for multiple intervals.
    
    Design principles:
    - Single symbol responsibility
    - Multiple interval support
    - Scalable: Each processor instance handles one symbol
    - Future: Can be distributed with Kafka partitions by symbol
    """
    
    def __init__(self, symbol: str = "btcusdt", intervals: list = None):
        """
        Initialize candle processor.
        
        Args:
            symbol: Trading symbol (e.g., 'btcusdt')
            intervals: List of intervals (default: from config)
        """
        self.symbol = symbol.lower()
        self.intervals = intervals or config.CANDLE_INTERVALS
        self.table_name = "candles"  # Unified table for all symbols and intervals
        
        logger.info(f"Initializing candle processor for {self.symbol.upper()} with intervals: {', '.join(self.intervals)}")
        
        # Kafka consumer - filter by symbol partition key
        self.consumer = KafkaConsumer(
            config.TOPIC_RAW_TRADES,
            bootstrap_servers=[config.KAFKA_SERVER],
            auto_offset_reset='latest',
            value_deserializer=lambda x: json.loads(x.decode('utf-8')),
            group_id=f'candle-processor-{symbol}',
            # Note: partition key filtering would be done at consumer group level
        )
        
        # Kafka producer for candles
        self.producer = KafkaProducer(
            bootstrap_servers=[config.KAFKA_SERVER],
            value_serializer=lambda v: json.dumps(v).encode('utf-8')
        )
        
        # Connect to database
        self._connect_db()
        self._setup_database()
        
        # Interval manager handles all interval logic
        self.interval_manager = IntervalManager(self.symbol, self.intervals)
        self.running = True
        
        logger.info(f"Successfully initialized candle processor for {self.symbol.upper()}")

    def _connect_db(self):
        """Connect to QuestDB."""
        try:
            self.db_conn = psycopg2.connect(
                host=config.QUESTDB_HOST,
                port=config.QUESTDB_PORT,
                user=config.QUESTDB_USER,
                password=config.QUESTDB_PASSWORD,
                database=config.QUESTDB_DATABASE
            )
            self.db_conn.autocommit = True
            self.cursor = self.db_conn.cursor()
            logger.info(f"Connected to QuestDB for {self.symbol.upper()}")
        except Exception as e:
            logger.error(f"Database connection error: {e}")
            exit()

    def _setup_database(self):
        """
        Create unified candles table with symbol and interval columns.
        
        This table stores all candles for all symbols and intervals.
        """
        query = f"""
        CREATE TABLE IF NOT EXISTS {self.table_name} (
            timestamp TIMESTAMP,
            symbol VARCHAR,
            interval VARCHAR,
            open DOUBLE,
            high DOUBLE,
            low DOUBLE,
            close DOUBLE,
            volume DOUBLE
        ) timestamp(timestamp) PARTITION BY DAY;
        """
        try:
            self.cursor.execute(query)
            logger.info(f"Table '{self.table_name}' is ready")
        except Exception as e:
            logger.warning(f"Database setup: {e}")

    def _validate_trade(self, trade: dict) -> bool:
        """Validate raw trade data from Kafka."""
        try:
            if not trade or not isinstance(trade, dict):
                return False
            
            required_fields = ['timestamp', 'price', 'volume']
            for field in required_fields:
                if field not in trade:
                    return False
            
            price = trade.get('price')
            volume = trade.get('volume')
            
            if not isinstance(price, (int, float)) or not isinstance(volume, (int, float)):
                return False
            
            if price <= 0 or volume < 0:
                return False
            
            # Check for NaN
            if price != price or volume != volume:
                return False
            
            return True
        except Exception as e:
            logger.warning(f"Trade validation error: {e}")
            return False

    def save_to_db(self, candle: dict):
        """Save candle to database."""
        query = f"INSERT INTO {self.table_name} VALUES (%s, %s, %s, %s, %s, %s, %s, %s)"
        self.cursor.execute(
            query,
            (
                candle['timestamp'],
                candle['symbol'],
                candle['interval'],
                candle['open'],
                candle['high'],
                candle['low'],
                candle['close'],
                candle['volume']
            )
        )

    def broadcast_candle(self, candle: dict, is_final: bool = True):
        """
        Broadcast candle to Kafka for frontend/backend.
        
        Sends to TOPIC_KLINE_STREAM with:
        - symbol, interval, OHLCV
        - is_final flag (True for completed, False for updating)
        """
        kafka_candle = candle.copy()
        kafka_candle['is_final'] = is_final
        kafka_candle['timestamp'] = kafka_candle['timestamp'].isoformat()
        
        status = "FINAL" if is_final else "UPDATING"
        logger.info(
            f"Broadcasting {status} candle - {self.symbol.upper()} [{candle['interval']}] | "
            f"O: {candle['open']:,.2f} | H: {candle['high']:,.2f} | "
            f"L: {candle['low']:,.2f} | C: {candle['close']:,.2f} | V: {candle['volume']:,.0f}"
        )
        
        self.producer.send(config.TOPIC_KLINE_STREAM, value=kafka_candle)

    def process_interval_completion(self, interval: str, last_close_price: float):
        """
        Handle interval completion and generate missing interval candles.
        
        When an interval period ends:
        1. Calculate and broadcast final candle
        2. If multiple periods missed, auto-fill with flat candles
        """
        candle = self.interval_manager.calculate_ohlcv(interval)
        
        if candle is None:
            logger.debug(f"Skipped candle with invalid data [{interval}]")
            return
        
        # Save and broadcast final candle
        self.save_to_db(candle)
        self.broadcast_candle(candle, is_final=True)
        
        # Auto-fill missing periods
        minutes = self.interval_manager.get_interval_minutes(interval)
        current_minute = self.interval_manager.current_minute[interval]
        next_minute = current_minute + timedelta(minutes=minutes)
        
        # Check if multiple periods were skipped
        # (This would be handled by comparing next trade time with expected time)
        
        logger.info(
            f"Processed interval {interval} for {self.symbol.upper()} | "
            f"Time: {candle['timestamp'].strftime('%Y-%m-%d %H:%M')} | "
            f"Trades: {len([t for t in self.interval_manager.trades_buffer])}"
        )

    def run(self):
        """Main loop to process trade data into candles."""
        try:
            logger.info(f"Starting candle processing for {self.symbol.upper()}")
            
            for message in self.consumer:
                try:
                    trade = message.value
                    
                    if not self._validate_trade(trade):
                        logger.debug(f"Skipped invalid trade: {trade}")
                        continue
                    
                    # Parse trade time
                    trade_time = datetime.fromtimestamp(trade['timestamp'] / 1000.0)
                    
                    with self.interval_manager.lock:
                        # Add trade to buffer with datetime
                        trade_with_time = trade.copy()
                        trade_with_time['datetime'] = trade_time
                        self.interval_manager.trades_buffer.append(trade_with_time)
                        
                        # Keep only trades for the longest interval (cleanup old trades)
                        max_interval_minutes = max(
                            self.interval_manager.get_interval_minutes(i)
                            for i in self.intervals
                        )
                        cutoff_time = trade_time - timedelta(minutes=max_interval_minutes)
                        self.interval_manager.trades_buffer = [
                            t for t in self.interval_manager.trades_buffer
                            if t['datetime'] >= cutoff_time
                        ]
                        
                        # Initialize intervals on first trade
                        if not self.interval_manager.current_minute:
                            for interval in self.intervals:
                                self.interval_manager.current_minute[interval] = \
                                    self.interval_manager.truncate_to_interval(trade_time, interval)
                                self.interval_manager.first_trade_price[interval] = trade['price']
                            self.interval_manager.schedule_next_update()
                            logger.info(f"Initialized intervals for {self.symbol.upper()}: {self.intervals}")
                            continue
                        
                        # Check for interval completions
                        for interval in self.intervals:
                            if self.interval_manager.should_process_interval(trade_time, interval):
                                # Get last close before resetting
                                last_candle = self.interval_manager.calculate_ohlcv(interval)
                                last_close = last_candle['close'] if last_candle else self.interval_manager.first_trade_price[interval]
                                
                                # Process completed interval
                                self.process_interval_completion(interval, last_close)
                                
                                # Reset for new interval period
                                self.interval_manager.current_minute[interval] = \
                                    self.interval_manager.truncate_to_interval(trade_time, interval)
                                self.interval_manager.first_trade_price[interval] = trade['price']
                
                except Exception as e:
                    logger.error(f"Error processing trade: {e}")
                    continue
        
        except KeyboardInterrupt:
            logger.info("Shutdown signal received")
        finally:
            self.shutdown()

    def shutdown(self):
        """Release all resources."""
        self.running = False
        self.interval_manager.cleanup()
        
        self.consumer.close()
        self.producer.close()
        if hasattr(self, 'cursor'):
            self.cursor.close()
        if hasattr(self, 'db_conn'):
            self.db_conn.close()
        
        logger.info(f"Processor for {self.symbol.upper()} shut down successfully")


# ==========================================
# PROGRAM STARTUP
# ==========================================
if __name__ == "__main__":
    # Run processor for a specific symbol
    app = CandleProcessor(symbol="btcusdt", intervals=config.CANDLE_INTERVALS)
    app.run()
