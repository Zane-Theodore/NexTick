import json
import signal
import threading
import time
import sys
from datetime import datetime, timedelta, timezone

import psycopg2
from kafka import KafkaConsumer, KafkaProducer
from kafka.errors import NoBrokersAvailable

from data_pipeline.backfill.state import read_backfill_end
from data_pipeline.common import config
from data_pipeline.common.logger import get_logger

logger = get_logger(__name__)


def retry_with_backoff(
    operation,
    max_retries=60,
    base_delay=1.0,
    max_delay=10.0,
    operation_name="operation",
):
    """Execute an operation with exponential backoff retry logic.
    
    Args:
        operation: Callable to execute.
        max_retries: Maximum number of retry attempts.
        base_delay: Initial delay in seconds between retries.
        max_delay: Maximum delay in seconds between retries.
        operation_name: Descriptive name for logging.
        
    Returns:
        Result of the operation.
        
    Raises:
        Exception: If all retries are exhausted.
    """
    attempt = 0
    while attempt < max_retries:
        try:
            return operation()
        except NoBrokersAvailable:
            attempt += 1
            delay = min(base_delay * (2 ** (attempt - 1)), max_delay)
            logger.warning(
                f"{operation_name} failed (Kafka not ready). "
                f"Retrying in {delay:.1f}s... ({attempt}/{max_retries})"
            )
            time.sleep(delay)
        except Exception as error:
            attempt += 1
            if attempt >= max_retries:
                logger.error(f"{operation_name} failed after {attempt} attempts.", exc_info=True)
                raise
            delay = min(base_delay * (2 ** (attempt - 1)), max_delay)
            logger.warning(
                f"{operation_name} failed on attempt {attempt}: {error}. "
                f"Retrying in {delay:.1f}s..."
            )
            time.sleep(delay)


class SingleCandleManager:
    """Manages candle aggregation for a single timeframe using O(1) complexity.
    
    Maintains only the current candle state and updates OHLCV data efficiently
    without maintaining a buffer of past trades.
    """

    def __init__(self, symbol: str, interval: str, interval_ms: int):
        """Initialize candle manager for a specific timeframe.
        
        Args:
            symbol: Trading symbol (e.g., btcusdt).
            interval: Timeframe string (e.g., '1m', '5m', '1h').
            interval_ms: Interval duration in milliseconds.
        """
        self.symbol = symbol.lower()
        self.interval = interval
        self.interval_ms = interval_ms
        self.current_candle = None
        self.current_candle_start = None
        self.has_observed_interval_boundary = False
        self.lock = threading.Lock()
        self.closed = False

    def truncate_to_interval(self, timestamp: datetime) -> datetime:
        """Truncate timestamp to the start of the interval.
        
        Args:
            timestamp: Datetime object to truncate.
            
        Returns:
            Datetime truncated to interval boundary.
        """
        interval_unit = self.interval[-1]
        interval_value = int(self.interval[:-1]) if interval_unit != 'M' else 1

        if interval_unit == 'm':
            minutes = (timestamp.minute // interval_value) * interval_value
            return timestamp.replace(minute=minutes, second=0, microsecond=0)

        if interval_unit == 'h':
            hour = (timestamp.hour // interval_value) * interval_value
            return timestamp.replace(hour=hour, minute=0, second=0, microsecond=0)

        if interval_unit == 'd':
            day = ((timestamp.day - 1) // interval_value) * interval_value + 1
            return timestamp.replace(day=day, hour=0, minute=0, second=0, microsecond=0)

        if self.interval == '1w':
            week_start = timestamp - timedelta(days=timestamp.weekday())
            return week_start.replace(hour=0, minute=0, second=0, microsecond=0)

        if self.interval == '1M':
            return timestamp.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        raise ValueError(f"Unsupported candle interval: {self.interval}")

    def update_with_trade(
        self,
        trade_price: float,
        trade_volume: float,
        trade_time: datetime,
    ) -> dict:
        """Update candle with new trade data using O(1) algorithm.
        
        Args:
            trade_price: Price of the trade.
            trade_volume: Volume of the trade.
            trade_time: Timestamp of the trade.
            
        Returns:
            Dictionary with closed candle if interval boundary crossed, None otherwise.
        """
        with self.lock:
            candle_start = self.truncate_to_interval(trade_time)
            
            # Check if we've crossed into a new interval
            if self.current_candle_start and candle_start > self.current_candle_start:
                closed_candle = self.current_candle.copy() if self.current_candle else None
                self.current_candle = None
                self.current_candle_start = None
                self.has_observed_interval_boundary = True
            else:
                closed_candle = None
            
            # Initialize new candle if needed
            if self.current_candle is None:
                complete_from_start = (
                    self.has_observed_interval_boundary
                    or trade_time == candle_start
                )
                self.current_candle = {
                    'symbol': self.symbol.upper(),
                    'interval': self.interval,
                    'timestamp': candle_start,
                    'open': float(trade_price),
                    'high': float(trade_price),
                    'low': float(trade_price),
                    'close': float(trade_price),
                    'volume': float(trade_volume),
                    '_complete_from_start': complete_from_start,
                }
                self.current_candle_start = candle_start
            else:
                # Update current candle with O(1) operations
                self.current_candle['high'] = max(
                    self.current_candle['high'],
                    float(trade_price),
                )
                self.current_candle['low'] = min(
                    self.current_candle['low'],
                    float(trade_price),
                )
                self.current_candle['close'] = float(trade_price)
                self.current_candle['volume'] += float(trade_volume)
            
            return closed_candle

    def get_current_candle(self) -> dict:
        """Get a copy of the current candle for streaming updates.
        
        Returns:
            Current candle data or None if not initialized.
        """
        with self.lock:
            return self.current_candle.copy() if self.current_candle else None


class MultiTimeframeManager:
    """Manages multiple timeframes for a single trading symbol.
    
    Efficiently processes trades across multiple intervals (1m, 5m, 15m, 30m, 1h)
    with automatic streaming of non-final candles.
    """

    def __init__(self, symbol: str, broadcast_callback):
        """Initialize multi-timeframe manager.
        
        Args:
            symbol: Trading symbol (e.g., btcusdt).
            broadcast_callback: Callback function for broadcasting candles.
        """
        self.symbol = symbol.lower()
        self.broadcast_callback = broadcast_callback
        self.lock = threading.Lock()
        self.update_timer = None
        self.running = True
        
        # Load timeframes from config (format: CANDLE_INTERVALS=1m,5m,15m,30m,1h)
        self.timeframes = config.get_timeframes_with_ms()
        
        # Initialize managers for each timeframe
        self.managers = {}
        for interval_name, interval_ms in self.timeframes:
            self.managers[interval_name] = SingleCandleManager(symbol, interval_name, interval_ms)
        
        logger.info(
            f"Initialized multi-timeframe manager for {self.symbol.upper()} "
            f"with timeframes: {[t[0] for t in self.timeframes]}"
        )
        self.schedule_next_update()

    def process_trade(
        self,
        trade_price: float,
        trade_volume: float,
        trade_time: datetime,
    ) -> list:
        """Process a trade across all timeframes and emit closed candles.
        
        Args:
            trade_price: Price of the trade.
            trade_volume: Volume of the trade.
            trade_time: Timestamp of the trade.
            
        Returns:
            List of closed candles (if any interval boundary crossed).
        """
        closed_candles = []
        
        with self.lock:
            for interval_name, manager in self.managers.items():
                closed_candle = manager.update_with_trade(trade_price, trade_volume, trade_time)
                if closed_candle:
                    closed_candles.append(closed_candle)
                    if self.broadcast_callback:
                        self.broadcast_callback(closed_candle, is_final=True)
        
        return closed_candles

    def schedule_next_update(self):
        """Schedule periodic emission of non-final candle updates."""
        if self.running and not self.update_timer:
            self.update_timer = threading.Timer(
                config.CANDLE_UPDATE_INTERVAL_MS / 1000.0,
                self._emit_updating_candles
            )
            self.update_timer.daemon = True
            self.update_timer.start()

    def _emit_updating_candles(self):
        """Emit non-final (updating) candles for all timeframes at regular intervals."""
        if not self.running:
            return
        
        with self.lock:
            for interval_name, manager in self.managers.items():
                current_candle = manager.get_current_candle()
                if current_candle and self.broadcast_callback:
                    self.broadcast_callback(current_candle, is_final=False)
        
        if self.running:
            self.update_timer = threading.Timer(
                config.CANDLE_UPDATE_INTERVAL_MS / 1000.0,
                self._emit_updating_candles
            )
            self.update_timer.daemon = True
            self.update_timer.start()

    def cleanup(self):
        """Cancel any pending update timer."""
        self.running = False
        if self.update_timer:
            self.update_timer.cancel()


class CandleProcessor:
    """Processes trade streams and generates OHLCV candles.
    
    Consumes raw trade data from Kafka, aggregates into 1-minute candles
    for multiple symbols, persists to QuestDB, and broadcasts via Kafka.
    """

    def __init__(self):
        """Initialize the candle processor with Kafka and database connections."""
        self.table_name = "market_candles"
        self.managers = {}  # Dict[symbol] -> MultiTimeframeManager
        self.backfill_write_fence = read_backfill_end()
        if self.backfill_write_fence is not None:
            logger.info(
                "Processor DB write fence is active for startup-backfilled candles: "
                f"skip final 1m upserts before {self.backfill_write_fence.isoformat()}"
            )
        
        logger.info(
            "Starting multi-symbol multi-timeframe candle processor with O(1) "
            "complexity and synchronous database operations"
        )
        
        try:
            self.db_conn = psycopg2.connect(
                host=config.QUESTDB_HOST,
                port=config.QUESTDB_PORT,
                database=config.QUESTDB_DATABASE,
                user=config.QUESTDB_USER,
                password=config.QUESTDB_PASSWORD
            )
            self.db_conn.autocommit = True
            self.db_cursor = self.db_conn.cursor()
            logger.info("Connected to QuestDB via PostgreSQL wire protocol.")

            self.db_cursor.execute(
                f"""
                CREATE TABLE IF NOT EXISTS {self.table_name} (
                    symbol SYMBOL,
                    interval SYMBOL,
                    timestamp TIMESTAMP,
                    open DOUBLE,
                    high DOUBLE,
                    low DOUBLE,
                    close DOUBLE,
                    volume DOUBLE
                ) TIMESTAMP(timestamp)
                PARTITION BY MONTH
                DEDUP UPSERT KEYS(timestamp, symbol, interval);
                """
            )
            self._ensure_dedup_enabled()
            logger.info(
                f"Verified/Created table {self.table_name} with WAL dedup upsert keys "
                "(timestamp, symbol, interval)."
            )
        except Exception as e:
            logger.error(f"Failed to connect to QuestDB: {e}", exc_info=True)
            raise
        
        def _create_consumer():
            return KafkaConsumer(
                config.TOPIC_RAW_TRADES,
                bootstrap_servers=[config.KAFKA_SERVER],
                api_version=(3, 4, 0),
                auto_offset_reset=config.KAFKA_AUTO_OFFSET_RESET,
                enable_auto_commit=False,
                consumer_timeout_ms=1000,
                value_deserializer=lambda x: json.loads(x.decode('utf-8')),
                group_id=config.KAFKA_CONSUMER_GROUP_ID
            )
        
        self.consumer = retry_with_backoff(
            _create_consumer,
            operation_name='Kafka consumer creation',
        )
        logger.info(
            f"Kafka raw trade consumer initialized: topic={config.TOPIC_RAW_TRADES}, "
            f"groupId={config.KAFKA_CONSUMER_GROUP_ID}, "
            f"autoOffsetReset={config.KAFKA_AUTO_OFFSET_RESET}"
        )
        
        def _create_producer():
            return KafkaProducer(
                bootstrap_servers=[config.KAFKA_SERVER],
                api_version=(3, 4, 0),
                value_serializer=lambda v: json.dumps(v).encode('utf-8'),
                retries=5,
                linger_ms=5,
                request_timeout_ms=30000,
            )
        
        self.producer = retry_with_backoff(
            _create_producer,
            operation_name='Kafka producer creation',
        )
        self.running = True

    def _is_valid_candle(self, candle: dict) -> bool:
        try:
            open_price = float(candle["open"])
            high = float(candle["high"])
            low = float(candle["low"])
            close = float(candle["close"])
            volume = float(candle["volume"])
        except (KeyError, TypeError, ValueError):
            return False

        return (
            open_price > 0
            and high > 0
            and low > 0
            and close > 0
            and volume >= 0
            and high >= max(open_price, close)
            and low <= min(open_price, close)
            and high >= low
        )

    def _is_before_backfill_fence(self, candle: dict) -> bool:
        timestamp = candle.get("timestamp")
        return (
            self.backfill_write_fence is not None
            and isinstance(timestamp, datetime)
            and timestamp < self.backfill_write_fence
        )

    def _commit_consumer_offset(self, reason: str) -> bool:
        try:
            self.consumer.commit()
            return True
        except Exception:
            logger.warning(f"Failed to commit Kafka offset after {reason}.", exc_info=True)
            return False

    def _ensure_dedup_enabled(self) -> None:
        """Enable QuestDB deduplication when the table is WAL-capable."""

        try:
            self.db_cursor.execute(
                f"ALTER TABLE {self.table_name} "
                "DEDUP ENABLE UPSERT KEYS(timestamp, symbol, interval)"
            )
        except Exception as exc:
            logger.error(
                f"{self.table_name} does not accept DEDUP UPSERT KEYS"
                "(timestamp, symbol, interval). "
                "If this is an existing BYPASS WAL table, migrate it to a "
                "WAL table before running "
                "the live processor to prevent duplicate candles.",
                exc_info=True,
            )
            raise exc

    def check_price_continuity(self, candle: dict) -> bool:
        """Check if the given 1m candle's open price matches the previous candle's close price.
        
        This helper can detect price discontinuities that may indicate:
        - Missed candles from mid-minute startup gaps
        - Data corruption or inconsistency
        
        Args:
            candle: The candle to check (must have symbol, interval, timestamp, open).
            
        Returns:
            True if continuity is verified or no previous candle exists, False if there's a gap.
        """
        if candle.get('interval') != '1m':
            # Continuity check applies to 1m candles only
            return True
        
        try:
            symbol = candle.get('symbol')
            ts = candle.get('timestamp')
            current_open = float(candle.get('open', 0))
            
            if not ts or not symbol or current_open <= 0:
                return True
            
            # Get the previous candle's close price
            prev_ts = ts - timedelta(minutes=1)
            ts_str = prev_ts.strftime('%Y-%m-%d %H:%M:%S')
            
            self.db_cursor.execute(
                f"""
                SELECT close FROM {self.table_name}
                WHERE symbol = %s
                  AND interval = '1m'
                  AND timestamp = to_timestamp(%s, 'yyyy-MM-dd HH:mm:ss')
                """,
                (symbol, ts_str)
            )
            result = self.db_cursor.fetchone()
            
            if result is None:
                # No previous candle found - can't check continuity
                logger.debug(
                    f"No previous candle found for {symbol} at {prev_ts.isoformat()}. "
                    f"Cannot verify price continuity for {candle['timestamp'].isoformat()}."
                )
                return True
            
            prev_close = float(result[0])
            tolerance = 1e-8  # Tolerance for floating point comparison
            
            if abs(current_open - prev_close) > tolerance:
                logger.warning(
                    f"PRICE CONTINUITY BREAK detected for {symbol}: "
                    f"Previous candle close={prev_close:.8f}, "
                    f"Current candle open={current_open:.8f}, "
                    f"Difference={abs(current_open - prev_close):.8f} "
                    f"at {candle['timestamp'].isoformat()}. "
                    f"This may indicate missing candles or data sync issues."
                )
                return False
            
            return True
        except Exception as e:
            logger.warning(
                f"Could not verify price continuity for {candle.get('symbol')} "
                f"at {candle.get('timestamp')}: {e}",
                exc_info=True,
            )
            # Return True to not block processing if check fails
            return True

    def save_to_db(self, candle: dict) -> bool:
        """Upsert a candle to QuestDB.
        
        Args:
            candle: Candle data dictionary with OHLCV information.
            
        Returns:
            True if successfully persisted, False otherwise.
        """
        if not self._is_valid_candle(candle):
            logger.error(
                f"Refusing to upsert invalid candle: symbol={candle.get('symbol')}, "
                f"interval={candle.get('interval')}, open_time={candle.get('timestamp')}, "
                f"open={candle.get('open')}, high={candle.get('high')}, "
                f"low={candle.get('low')}, close={candle.get('close')}, "
                f"volume={candle.get('volume')}"
            )
            return False

        def _upsert():
            db_timestamp_str = candle['timestamp'].strftime('%Y-%m-%d %H:%M:%S')
            self.db_cursor.execute(
                f"""
                INSERT INTO {self.table_name} (
                    symbol,
                    interval,
                    timestamp,
                    open,
                    high,
                    low,
                    close,
                    volume
                )
                VALUES (%s, %s, to_timestamp(%s, 'yyyy-MM-dd HH:mm:ss'), %s, %s, %s, %s, %s)
                """,
                (
                    candle['symbol'],
                    candle['interval'],
                    db_timestamp_str,
                    candle['open'],
                    candle['high'],
                    candle['low'],
                    candle['close'],
                    candle['volume']
                )
            )
            self.consumer.commit()

        try:
            retry_with_backoff(_upsert, max_retries=3, operation_name='QuestDB candle upsert')
            logger.info(
                f"Upserted candle: symbol={candle['symbol']}, interval={candle['interval']}, "
                f"open_time={candle['timestamp'].isoformat()}, source=LIVE_PROCESSOR"
            )
            
            # Check price continuity for 1m candles to detect data gaps
            if candle.get('interval') == '1m':
                self.check_price_continuity(candle)
            
            return True
        except Exception:
            logger.error(
                f"Failed to upsert candle after retries: symbol={candle.get('symbol')}, "
                f"interval={candle.get('interval')}, open_time={candle.get('timestamp')}",
                exc_info=True,
            )
            return False

    def _send_to_topic(self, topic: str, value: dict):
        """Publish a message to a Kafka topic.
        
        Args:
            topic: Target Kafka topic.
            value: Message data to publish.
        """
        def _send():
            future = self.producer.send(
                topic,
                value=value,
                key=value['symbol'].encode('utf-8'),
            )
            result = future.get(timeout=15)
            return result

        retry_with_backoff(
            _send,
            max_retries=4,
            base_delay=0.5,
            operation_name=f'Kafka publish to {topic}',
        )

    def broadcast_candle(self, candle: dict, is_final: bool = False):
        """Broadcast a candle to Kafka topic and persist if final 1m candle.
        
        Args:
            candle: Candle data to broadcast.
            is_final: Whether this is a final (closed interval) candle. 
                     Only 1m candles are persisted to DB when final=True.
        """
        complete_from_start = bool(candle.get("_complete_from_start", True))
        public_candle = {key: value for key, value in candle.items() if not key.startswith('_')}

        kafka_candle = public_candle.copy()
        kafka_candle['is_final'] = is_final
        kafka_candle['timestamp'] = kafka_candle['timestamp'].isoformat()

        if not complete_from_start:
            logger.info(
                f"Skipping candle that began before processor observed its interval start: "
                f"symbol={candle['symbol']}, interval={candle['interval']}, "
                f"open_time={candle['timestamp'].isoformat()}, is_final={is_final}. "
                "Startup backfill owns prior closed candles; this partial live candle "
                "would have incomplete OHLCV."
            )
            if is_final and candle["interval"] == "1m":
                self._commit_consumer_offset("skipping incomplete startup candle")
            return

        # Only persist to DB for final 1m candles
        if is_final and self._is_before_backfill_fence(candle):
            logger.info(
                "Skipping final candle before startup backfill watermark: "
                f"symbol={candle['symbol']}, "
                f"interval={candle['interval']}, open_time={candle['timestamp'].isoformat()}, "
                f"backfill_end={self.backfill_write_fence.isoformat()}"
            )
            if candle["interval"] == "1m":
                self._commit_consumer_offset("skipping startup-backfilled final candle")
            return

        if is_final and candle['interval'] == '1m':
            if not self.save_to_db(candle):
                logger.warning(
                    f"Skipping final candle publish for {candle['symbol']} "
                    "because DB persistence failed."
                )
                return

        if not is_final and not self._is_valid_candle(candle):
            logger.debug(
                f"Skipping invalid non-final candle broadcast: symbol={candle.get('symbol')}, "
                f"interval={candle.get('interval')}, open_time={candle.get('timestamp')}, "
                f"open={candle.get('open')}, high={candle.get('high')}, "
                f"low={candle.get('low')}, close={candle.get('close')}, "
                f"volume={candle.get('volume')}"
            )
            return

        try:
            self._send_to_topic(config.TOPIC_KLINE_STREAM, kafka_candle)
        except Exception:
            logger.error(
                f"Failed to publish candle update for {candle['symbol']} to Kafka.",
                exc_info=True,
            )

    def run(self):
        """Start processing raw trades and generating multi-timeframe candles."""
        logger.info(
            f"Processor started; consuming Kafka topic={config.TOPIC_RAW_TRADES}, "
            f"groupId={config.KAFKA_CONSUMER_GROUP_ID}"
        )
        try:
            while self.running:
                raw_messages = self.consumer.poll(timeout_ms=1000)
                
                for topic_partition, messages in raw_messages.items():
                    for message in messages:
                        raw_trade = message.value
                        
                        try:
                            logger.debug(
                                f"Processor consumed Kafka message: topic={message.topic}, "
                                f"partition={message.partition}, offset={message.offset}"
                            )
                            trade = raw_trade.get('data', raw_trade)
                            symbol = trade.get('s') or trade.get('symbol')
                            
                            if not symbol:
                                logger.debug(f"Skipped trade with missing symbol: {raw_trade}")
                                continue
                                
                            if not all(k in trade for k in ('timestamp', 'price', 'volume')):
                                logger.debug(
                                    f"Skipped trade with missing required fields: {raw_trade}"
                                )
                                continue
                            
                            symbol = symbol.lower()
                            price = float(trade['price'])
                            volume = float(trade['volume'])
                            
                            if price <= 0 or volume <= 0:
                                continue
                                
                            trade_time = datetime.fromtimestamp(
                                trade['timestamp'] / 1000.0,
                                tz=timezone.utc,
                            )
                            if trade_time.year < 2020:
                                continue
                            
                            # Initialize multi-timeframe manager if new symbol
                            if symbol not in self.managers:
                                logger.info(
                                    f"Detected new trading stream for {symbol.upper()}. "
                                    "Initializing multi-timeframe candle manager..."
                                )
                                self.managers[symbol] = MultiTimeframeManager(
                                    symbol,
                                    self.broadcast_candle,
                                )
                            
                            # Process trade across all timeframes
                            manager = self.managers[symbol]
                            manager.process_trade(price, volume, trade_time)
                            logger.debug(
                                f"Candle aggregated from trade: symbol={symbol.upper()}, "
                                f"event_time={trade_time.isoformat()}, "
                                f"price={price}, volume={volume}"
                            )
                                    
                        except Exception as e:
                            logger.error(
                                f"Error processing individual trade from Kafka "
                                f"topic={message.topic}, partition={message.partition}, "
                                f"offset={message.offset}: {e}",
                                exc_info=True,
                            )
                            
        except KeyboardInterrupt:
            logger.info("Shutdown signal received")
        except Exception as e:
            logger.error(f"Unexpected error in processor: {e}", exc_info=True)
        finally:
            self.shutdown()

    def shutdown(self):
        """Gracefully shutdown the processor and close all connections."""
        self.running = False
        
        for manager in self.managers.values():
            manager.cleanup()

        try:
            self.consumer.close()
        except Exception as exc:
            logger.warning(f"Failed to close Kafka consumer cleanly: {exc}", exc_info=True)

        try:
            self.producer.flush(timeout=10)
            self.producer.close()
        except Exception as exc:
            logger.warning(f"Failed to flush/close Kafka producer cleanly: {exc}", exc_info=True)
        
        try:
            if hasattr(self, 'db_cursor'):
                self.db_cursor.close()
            if hasattr(self, 'db_conn'):
                self.db_conn.close()
        except Exception as exc:
            logger.warning(f"Failed to close QuestDB connection cleanly: {exc}", exc_info=True)
            
        logger.info("Processor shut down successfully")

if __name__ == "__main__":
    app = CandleProcessor()

    def _handle_signal(sig, frame):
        logger.info(f"Received signal {sig}. Initiating graceful shutdown...")
        app.shutdown()
        sys.exit(0)

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    app.run()
