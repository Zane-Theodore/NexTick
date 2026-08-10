"""Reconcile closed 1-minute candles against Binance REST klines.

The startup backfill service runs this before the realtime processor starts. It
replaces a closed window in the WAL/dedup candle table, then the processor uses
the reconciled window end as a write fence while it drains buffered Kafka klines.
The same replacement path is used for manual repair workflows.
"""

import argparse
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

import psycopg2
from psycopg2 import OperationalError
from dotenv import load_dotenv

from data_pipeline.common.logger import get_logger
logger = get_logger(__name__)

TABLE_NAME = "market_candles"
TEMP_TABLE_PATTERN = re.compile(r"^market_candles_(backup|stage|replace|old|failed)_[A-Z0-9]+_[0-9]+$")
OLD_TABLE_PATTERN = re.compile(r"^market_candles_old_[A-Z0-9]+_([0-9]+)$")
INTERVAL = "1m"
INTERVAL_MS = 60_000
UPSERT_KEYS = "(timestamp, symbol, interval)"
DEFAULT_BINANCE_REST_URL = "https://api.binance.com"
DEFAULT_LIMIT = 1000
MAX_BACKFILL_MINUTES = 8 * 60
DEFAULT_BOOTSTRAP_CANDLES = MAX_BACKFILL_MINUTES
DEFAULT_TOLERANCE = Decimal("0.00000001")
DEFAULT_CLOSE_GRACE_SECONDS = 2.0
WAL_APPLY_TIMEOUT_SECONDS = 120.0
DDL_RETRY_ATTEMPTS = 30
DDL_RETRY_DELAY_SECONDS = 1.0


@dataclass(frozen=True)
class CandleRow:
    """Canonical in-memory representation of one closed candle row."""

    symbol: str
    interval: str
    timestamp: datetime
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal


@dataclass(frozen=True)
class ReconciliationResult:
    """Summary of one startup reconciliation run fenced at one cutover."""

    symbols: list[str]
    interval: str
    start: datetime
    end: datetime
    expected_count: int
    dry_run: bool
    ranges: list["SymbolReconciliationRange"]


@dataclass(frozen=True)
class SymbolReconciliationRange:
    """One symbol's independently selected startup fetch range."""

    symbol: str
    start: datetime | None
    end: datetime
    watermark: datetime | None
    bootstrap: bool
    expected_count: int


def load_environment() -> None:
    """Load data_pipeline/.env without overriding values injected by Docker."""

    env_path = Path(__file__).resolve().parents[1] / ".env"
    load_dotenv(env_path)


def get_env_or_raise(name: str) -> str:
    """Return a required environment variable or fail with a clear message."""

    value = os.getenv(name)
    if not value or not value.strip():
        raise ValueError(f"Environment variable {name} is required")
    return value.strip()


def parse_positive_int(value: str | int | None, default: int, minimum: int = 1) -> int:
    """Parse a positive integer config value with a lower bound."""

    if value is None or str(value).strip() == "":
        return default
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        logger.warning(f"Invalid integer value {value!r}; using {default}.")
        return default
    return max(parsed, minimum)


def parse_symbols(value: str | None) -> list[str]:
    """Parse comma-separated trading symbols into uppercase Binance symbols."""

    symbols = [item.strip().upper() for item in (value or "BTCUSDT").split(",") if item.strip()]
    if not symbols:
        raise ValueError("At least one trading symbol is required")
    return symbols


def to_questdb_timestamp(value: datetime) -> str:
    """Format a UTC timestamp for QuestDB's PostgreSQL wire protocol."""

    return value.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def normalize_db_timestamp(value) -> datetime:
    """Normalize a QuestDB timestamp value into a timezone-aware UTC datetime."""

    if isinstance(value, datetime):
        timestamp = value
    else:
        timestamp = datetime.fromisoformat(str(value).replace("Z", "+00:00"))

    if timestamp.tzinfo is None:
        return timestamp.replace(tzinfo=timezone.utc)
    return timestamp.astimezone(timezone.utc)


def decimal_from_api(value, field_name: str) -> Decimal:
    """Convert a Binance numeric string into Decimal for validation."""

    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"Invalid Binance {field_name}: {value}") from exc


def decimal_from_db(value) -> Decimal:
    """Convert a QuestDB numeric value into Decimal for comparison."""

    return Decimal(str(value))


def is_valid_candle_row(row: CandleRow) -> bool:
    """Return whether a candle row has sane OHLCV values."""

    return (
        all(value.is_finite() for value in (row.open, row.high, row.low, row.close, row.volume))
        and
        row.open > 0
        and row.high > 0
        and row.low > 0
        and row.close > 0
        and row.volume >= 0
        and row.high >= max(row.open, row.close)
        and row.low <= min(row.open, row.close)
        and row.high >= row.low
    )


def build_table_name(prefix: str, symbol: str, run_id: str) -> str:
    """Build a temporary table name using only safe identifier characters."""

    safe_symbol = "".join(ch for ch in symbol.upper() if ch.isalnum())
    return f"{prefix}_{safe_symbol}_{run_id}"


def ensure_safe_table_name(table_name: str) -> None:
    """Reject dynamic table names that cannot be safely interpolated into SQL."""

    if not table_name.replace("_", "").isalnum():
        raise ValueError(f"Unsafe internal table name: {table_name}")


def is_reconciler_temp_table(table_name: str) -> bool:
    """Return True only for temporary tables created by this script."""

    return bool(TEMP_TABLE_PATTERN.match(table_name))


def request_json(url: str, max_retries: int = 5):
    """Fetch JSON over HTTP with bounded retries for transient Binance errors."""

    last_error = None

    for attempt in range(1, max_retries + 1):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "NexTick-candle-reconcile/1.0"})
            with urllib.request.urlopen(request, timeout=20) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code in (418, 429) or exc.code >= 500:
                delay = min(2 ** attempt, 30)
                logger.warning(f"Binance request failed with HTTP {exc.code}. Retrying in {delay}s...")
                time.sleep(delay)
                continue
            raise
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
            delay = min(2 ** attempt, 30)
            logger.warning(f"Binance request failed: {exc}. Retrying in {delay}s...")
            time.sleep(delay)

    raise RuntimeError(f"Binance request failed after {max_retries} attempts: {last_error}")


def fetch_binance_server_time(base_url: str) -> datetime:
    """Read Binance server time as the exchange clock source."""

    url = f"{base_url.rstrip('/')}/api/v3/time"
    data = request_json(url)

    if not isinstance(data, dict) or "serverTime" not in data:
        raise ValueError(f"Unexpected Binance server time response: {data}")

    server_time_ms = int(data["serverTime"])
    return datetime.fromtimestamp(server_time_ms / 1000, tz=timezone.utc)


def resolve_startup_cutover(base_url: str) -> datetime:
    """Return the next Binance UTC minute boundary after startup.

    This is intentionally resolved before waiting.  Resolving it after the
    wait would move the handoff one minute forward and leave the startup minute
    available to the realtime processor as a partial candle.
    """

    server_time = fetch_binance_server_time(base_url)
    return server_time.replace(second=0, microsecond=0) + timedelta(minutes=1)


def wait_for_open_candle_close(
    base_url: str,
    cutover: datetime | None = None,
    close_grace_seconds: float = DEFAULT_CLOSE_GRACE_SECONDS,
) -> datetime:
    """Wait until the startup minute is closed and Binance REST is stable.

    The short grace period avoids requesting a candle exactly at the exchange
    boundary, while keeping startup latency low. The caller may increase it
    when an exchange endpoint needs more time to expose closed candles.
    """

    server_time = fetch_binance_server_time(base_url)
    startup_cutover = cutover or (
        server_time.replace(second=0, microsecond=0) + timedelta(minutes=1)
    )
    stable_next_boundary = startup_cutover + timedelta(
        seconds=max(0.0, close_grace_seconds),
    )
    wait_seconds = max(0.0, (stable_next_boundary - server_time).total_seconds())

    if wait_seconds > 0:
        logger.info(
            f"Binance server time is {server_time.isoformat()}; waiting {wait_seconds:.1f}s "
            "so startup backfill includes the candle that was open when the pipeline started."
        )
        time.sleep(wait_seconds)

    return fetch_binance_server_time(base_url)


def fetch_binance_klines(
    base_url: str,
    symbol: str,
    start_inclusive: datetime,
    end_exclusive: datetime,
) -> list[CandleRow]:
    """Fetch all Binance `1m` klines for [start_inclusive, end_exclusive)."""

    start_ms = int(start_inclusive.timestamp() * 1000)
    end_exclusive_ms = int(end_exclusive.timestamp() * 1000)
    cursor_ms = start_ms
    rows: list[CandleRow] = []

    while cursor_ms < end_exclusive_ms:
        batch_end_ms = min(cursor_ms + DEFAULT_LIMIT * INTERVAL_MS - 1, end_exclusive_ms - 1)
        query = urllib.parse.urlencode(
            {
                "symbol": symbol,
                "interval": INTERVAL,
                "startTime": cursor_ms,
                "endTime": batch_end_ms,
                "limit": DEFAULT_LIMIT,
            }
        )
        url = f"{base_url.rstrip('/')}/api/v3/klines?{query}"
        data = request_json(url)

        if not isinstance(data, list):
            raise ValueError(f"Unexpected Binance response for {symbol}: {data}")
        if not data:
            break

        last_open_time = None
        for item in data:
            if not isinstance(item, list) or len(item) < 7:
                raise ValueError(f"Unexpected Binance kline item for {symbol}: {item}")

            open_time_ms = int(item[0])
            close_time_ms = int(item[6])
            last_open_time = open_time_ms
            if open_time_ms < start_ms or open_time_ms >= end_exclusive_ms:
                continue
            if open_time_ms % INTERVAL_MS != 0:
                raise ValueError(f"{symbol}: Binance kline open time is not minute-aligned: {open_time_ms}")
            if close_time_ms != open_time_ms + INTERVAL_MS - 1:
                raise ValueError(
                    f"{symbol}: Binance kline close time does not match 1m interval: "
                    f"open={open_time_ms}, close={close_time_ms}"
                )

            rows.append(
                CandleRow(
                    symbol=symbol,
                    interval=INTERVAL,
                    timestamp=datetime.fromtimestamp(open_time_ms / 1000, tz=timezone.utc),
                    open=decimal_from_api(item[1], "open"),
                    high=decimal_from_api(item[2], "high"),
                    low=decimal_from_api(item[3], "low"),
                    close=decimal_from_api(item[4], "close"),
                    volume=decimal_from_api(item[5], "volume"),
                )
            )

        if last_open_time is None:
            break
        next_cursor_ms = last_open_time + INTERVAL_MS
        if next_cursor_ms <= cursor_ms:
            raise RuntimeError(f"Binance pagination did not advance for {symbol}")
        cursor_ms = next_cursor_ms

    return rows


def validate_rows(rows: list[CandleRow], symbol: str, start: datetime, end: datetime) -> None:
    """Validate that Binance returned a complete, continuous, sane candle set."""

    expected_count = int((end - start).total_seconds() // 60)
    if len(rows) != expected_count:
        raise ValueError(f"{symbol}: expected {expected_count} Binance candles, got {len(rows)}")

    seen = set()
    expected_timestamp = start
    for row in rows:
        if row.symbol != symbol or row.interval != INTERVAL:
            raise ValueError(f"{symbol}: invalid row identity: {row}")

        if row.timestamp in seen:
            raise ValueError(f"{symbol}: duplicate Binance candle at {row.timestamp.isoformat()}")
        seen.add(row.timestamp)

        if row.timestamp != expected_timestamp:
            raise ValueError(
                f"{symbol}: expected candle at {expected_timestamp.isoformat()}, "
                f"got {row.timestamp.isoformat()}"
            )

        if not is_valid_candle_row(row):
            raise ValueError(f"{symbol}: invalid OHLCV at {row.timestamp.isoformat()}")

        expected_timestamp += timedelta(minutes=1)


def create_connection():
    """Create a QuestDB PostgreSQL wire connection from environment variables.

    If the script is run on the host while `.env` still contains Docker's
    internal hostname `questdb`, retrying `localhost` makes the standalone
    `python -m data_pipeline.backfill.reconciler` path work with the Compose
    port mapping.
    """

    host = get_env_or_raise("QUESTDB_HOST")
    port = int(get_env_or_raise("QUESTDB_PORT"))
    database = get_env_or_raise("QUESTDB_DB_NAME")
    user = get_env_or_raise("QUESTDB_USER")
    password = get_env_or_raise("QUESTDB_PASSWORD")

    try:
        conn = psycopg2.connect(
            host=host,
            port=port,
            database=database,
            user=user,
            password=password,
        )
    except OperationalError:
        if host != "questdb":
            raise

        logger.warning("Could not connect to QuestDB at host 'questdb'. Retrying with 'localhost'.")
        conn = psycopg2.connect(
            host="localhost",
            port=port,
            database=database,
            user=user,
            password=password,
        )

    conn.autocommit = True
    return conn


def ensure_market_table(cursor, allow_migration: bool = True) -> None:
    """Ensure the main candle table exists and is configured for upserts."""

    for attempt in range(1, DDL_RETRY_ATTEMPTS + 1):
        try:
            table_state = get_market_table_state(cursor)
            if table_state is not None:
                wal_enabled, dedup_enabled, table_suspended = table_state
                if table_suspended:
                    raise RuntimeError(
                        f"{TABLE_NAME} is suspended in QuestDB. Resume or repair the WAL table "
                        "before running candle reconciliation."
                    )
                if wal_enabled and dedup_enabled:
                    return
                if not allow_migration:
                    raise RuntimeError(
                        f"{TABLE_NAME} exists but is not a WAL/dedup table "
                        f"(walEnabled={wal_enabled}, dedup={dedup_enabled}). "
                        "Stop the processor before running a repair that migrates or recreates "
                        "the live table."
                    )

                logger.warning(
                    f"{TABLE_NAME} exists but is not configured as a WAL/dedup table "
                    f"(walEnabled={wal_enabled}, dedup={dedup_enabled}). "
                    "Attempting one-time WAL/dedup table migration before reconciliation."
                )
                migrate_market_table_to_dedup(cursor)
                cursor.execute(f"ALTER TABLE {TABLE_NAME} DEDUP ENABLE UPSERT KEYS {UPSERT_KEYS}")
                return

            cursor.execute(
                f"""
                CREATE TABLE {TABLE_NAME} (
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
                DEDUP UPSERT KEYS {UPSERT_KEYS};
                """
            )
            wait_for_table_state(cursor, TABLE_NAME, should_exist=True)
            return
        except psycopg2.DatabaseError as exc:
            try:
                cursor.connection.rollback()
            except Exception:
                logger.warning("Failed to rollback connection after market table DDL error", exc_info=True)

            if attempt == DDL_RETRY_ATTEMPTS:
                raise

            logger.warning(
                f"Ensuring {TABLE_NAME} failed on attempt {attempt}/{DDL_RETRY_ATTEMPTS}: "
                f"{exc}. Retrying..."
            )
            time.sleep(DDL_RETRY_DELAY_SECONDS)


def get_market_table_state(cursor) -> tuple[bool, bool, bool] | None:
    """Return WAL/dedup/suspended metadata for the live candle table."""

    cursor.execute(
        "SELECT walEnabled, dedup, table_suspended FROM tables() WHERE table_name = %s",
        (TABLE_NAME,),
    )
    row = cursor.fetchone()
    if row is None:
        return None
    return bool(row[0]), bool(row[1]), bool(row[2])


def migrate_market_table_to_dedup(cursor) -> None:
    """Recreate an existing live table as WAL/dedup, keeping a rollback copy."""

    run_id = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
    old_table = build_table_name("market_candles_old", "SCHEMA", run_id)
    failed_table = build_table_name("market_candles_failed", "SCHEMA", run_id)
    old_created = False
    live_dropped = False

    try:
        old_count = create_table_from_source(cursor, old_table, TABLE_NAME)
        old_created = True
        logger.warning(
            f"Backed up existing {TABLE_NAME} to {old_table} with {old_count} row(s) "
            "before WAL/dedup migration."
        )

        drop_table(cursor, TABLE_NAME)
        wait_for_table_state(cursor, TABLE_NAME, should_exist=False)
        live_dropped = True

        migrated_count = create_table_from_source(cursor, TABLE_NAME, old_table, dedup=True)
        logger.warning(
            f"Migrated {TABLE_NAME} to WAL DEDUP UPSERT KEYS {UPSERT_KEYS} "
            f"with {migrated_count} row(s). Backup retained as {old_table}."
        )
    except Exception:
        logger.error(f"Failed to migrate {TABLE_NAME} to WAL/dedup.", exc_info=True)
        if old_created:
            try:
                if table_exists(cursor, TABLE_NAME):
                    create_table_from_source(cursor, failed_table, TABLE_NAME)
                    drop_table(cursor, TABLE_NAME)
                    wait_for_table_state(cursor, TABLE_NAME, should_exist=False)
                if live_dropped:
                    create_table_from_source(cursor, TABLE_NAME, old_table, dedup=True)
                    logger.warning(f"Restored {TABLE_NAME} from {old_table} after migration failure.")
            except Exception:
                logger.error(
                    f"Rollback failed after WAL/dedup migration error. Backup table: {old_table}",
                    exc_info=True,
                )
        raise


def create_candle_table(cursor, table_name: str, dedup: bool = False) -> None:
    """Create a candle-shaped table.

    Temporary reconciler tables stay BYPASS WAL so row-count verification is
    synchronous. The live table uses WAL dedup so repeated candle keys upsert.
    """

    ensure_safe_table_name(table_name)
    wal_clause = f"DEDUP UPSERT KEYS {UPSERT_KEYS}" if dedup else "BYPASS WAL"
    cursor.execute(
        f"""
        CREATE TABLE {table_name} (
            symbol SYMBOL,
            interval SYMBOL,
            timestamp TIMESTAMP,
            open DOUBLE,
            high DOUBLE,
            low DOUBLE,
            close DOUBLE,
            volume DOUBLE
        ) TIMESTAMP(timestamp)
        PARTITION BY DAY
        {wal_clause};
        """
    )


def insert_rows(cursor, table_name: str, rows: list[CandleRow]) -> None:
    """Insert canonical candle rows into a validated table name."""

    ensure_safe_table_name(table_name)
    invalid_rows = [row for row in rows if not is_valid_candle_row(row)]
    if invalid_rows:
        samples = [
            {
                "symbol": row.symbol,
                "interval": row.interval,
                "timestamp": row.timestamp.isoformat(),
                "open": str(row.open),
                "high": str(row.high),
                "low": str(row.low),
                "close": str(row.close),
                "volume": str(row.volume),
            }
            for row in invalid_rows[:5]
        ]
        raise ValueError(
            f"Refusing to insert {len(invalid_rows)} invalid candle row(s) into {table_name}: {samples}"
        )

    cursor.executemany(
        f"""
        INSERT INTO {table_name} (symbol, interval, timestamp, open, high, low, close, volume)
        VALUES (%s, %s, to_timestamp(%s, 'yyyy-MM-dd HH:mm:ss'), %s, %s, %s, %s, %s)
        """,
        [
            (
                row.symbol,
                row.interval,
                to_questdb_timestamp(row.timestamp),
                float(row.open),
                float(row.high),
                float(row.low),
                float(row.close),
                float(row.volume),
            )
            for row in rows
        ],
    )


def backup_existing_rows(cursor, backup_table: str, symbol: str, start: datetime, end: datetime) -> int:
    """Copy existing target-range rows into a backup table for rollback."""

    create_candle_table(cursor, backup_table)
    cursor.execute(
        f"""
        INSERT INTO {backup_table} (symbol, interval, timestamp, open, high, low, close, volume)
        SELECT symbol, interval, timestamp, open, high, low, close, volume
        FROM {TABLE_NAME}
        WHERE symbol = %s AND interval = %s AND timestamp >= %s AND timestamp < %s
        """,
        (symbol, INTERVAL, to_questdb_timestamp(start), to_questdb_timestamp(end)),
    )
    cursor.execute(f"SELECT count() AS count FROM {backup_table}")
    return int(cursor.fetchone()[0])


def count_invalid_target_rows(cursor, symbol: str, start: datetime, end: datetime) -> int:
    """Count invalid candle rows in the live target window."""

    cursor.execute(
        f"""
        SELECT count() AS count
        FROM {TABLE_NAME}
        WHERE symbol = %s
          AND interval = %s
          AND timestamp >= %s
          AND timestamp < %s
          AND NOT (
            open > 0
            AND high > 0
            AND low > 0
            AND close > 0
            AND volume >= 0
            AND high >= open
            AND high >= close
            AND low <= open
            AND low <= close
            AND high >= low
          )
        """,
        (symbol, INTERVAL, to_questdb_timestamp(start), to_questdb_timestamp(end)),
    )
    return int(cursor.fetchone()[0])


def copy_rows_except_symbol_window(cursor, target_table: str, symbol: str, start: datetime, end: datetime) -> int:
    """Copy current market data except the symbol/window being replaced."""

    ensure_safe_table_name(target_table)
    cursor.execute(
        f"""
        INSERT INTO {target_table} (symbol, interval, timestamp, open, high, low, close, volume)
        SELECT symbol, interval, timestamp, open, high, low, close, volume
        FROM {TABLE_NAME}
        WHERE NOT (
            symbol = %s
            AND interval = %s
            AND timestamp >= %s
            AND timestamp < %s
        )
        """,
        (symbol, INTERVAL, to_questdb_timestamp(start), to_questdb_timestamp(end)),
    )
    cursor.execute(f"SELECT count() AS count FROM {target_table}")
    return int(cursor.fetchone()[0])


def create_full_backup_table(cursor, backup_table: str) -> int:
    """Create a full copy of the live candle table for rollback before drop/swap."""

    ensure_safe_table_name(backup_table)
    return create_table_from_source(cursor, backup_table, TABLE_NAME)


def create_table_from_source(cursor, target_table: str, source_table: str, dedup: bool = False) -> int:
    """Create a candle table by copying all rows from another candle-shaped table."""

    ensure_safe_table_name(target_table)
    ensure_safe_table_name(source_table)
    cursor.execute(f"SELECT count() AS count FROM {source_table}")
    source_count = int(cursor.fetchone()[0])
    wal_clause = f"DEDUP UPSERT KEYS {UPSERT_KEYS}" if dedup else "BYPASS WAL"
    cursor.execute(
        f"""
        CREATE TABLE {target_table} (
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
        {wal_clause};
        """
    )
    cursor.execute(
        f"""
        INSERT INTO {target_table} (symbol, interval, timestamp, open, high, low, close, volume)
        SELECT symbol, interval, timestamp, open, high, low, close, volume
        FROM {source_table}
        WHERE open > 0
          AND high > 0
          AND low > 0
          AND close > 0
          AND volume >= 0
          AND timestamp >= to_timestamp('2020-01-01 00:00:00', 'yyyy-MM-dd HH:mm:ss')
          AND high >= open
          AND high >= close
          AND low <= open
          AND low <= close
          AND high >= low
        ORDER BY timestamp ASC
        """
    )
    if dedup and source_count > 0:
        return wait_for_non_empty_table(cursor, target_table)
    if dedup:
        return 0

    cursor.execute(f"SELECT count() AS count FROM {target_table}")
    return int(cursor.fetchone()[0])


def create_replacement_table_from_staging(
    cursor,
    replacement_table: str,
    staging_table: str,
    symbol: str,
    start: datetime,
    end: datetime,
) -> int:
    """Build a full replacement table from existing rows plus staged candles.

    The replacement table is temporary and synchronous. The live table receives
    this data through WAL dedup during the final swap.
    """

    ensure_safe_table_name(replacement_table)
    ensure_safe_table_name(staging_table)
    cursor.execute(
        f"""
        CREATE TABLE {replacement_table} (
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
        BYPASS WAL;
        """
    )
    cursor.execute(
        f"""
        INSERT INTO {replacement_table} (symbol, interval, timestamp, open, high, low, close, volume)
        SELECT symbol, interval, timestamp, open, high, low, close, volume
        FROM (
            SELECT symbol, interval, timestamp, open, high, low, close, volume
            FROM {TABLE_NAME}
            WHERE NOT (
                symbol = %s
                AND interval = %s
                AND timestamp >= %s
                AND timestamp < %s
            )
            AND open > 0
            AND high > 0
            AND low > 0
            AND close > 0
            AND volume >= 0
            AND timestamp >= to_timestamp('2020-01-01 00:00:00', 'yyyy-MM-dd HH:mm:ss')
            AND high >= open
            AND high >= close
            AND low <= open
            AND low <= close
            AND high >= low
            UNION ALL
            SELECT symbol, interval, timestamp, open, high, low, close, volume
            FROM {staging_table}
        ) AS replacement_rows
        ORDER BY timestamp ASC
        """,
        (symbol, INTERVAL, to_questdb_timestamp(start), to_questdb_timestamp(end)),
    )
    cursor.execute(f"SELECT count() AS count FROM {replacement_table}")
    return int(cursor.fetchone()[0])


def assert_no_duplicate_target_rows(cursor, symbol: str, start: datetime, end: datetime) -> None:
    """Fail before writing if the target range already contains duplicate keys."""

    cursor.execute(
        f"""
        SELECT timestamp
        FROM {TABLE_NAME}
        WHERE symbol = %s AND interval = %s AND timestamp >= %s AND timestamp < %s
        ORDER BY timestamp ASC
        """,
        (symbol, INTERVAL, to_questdb_timestamp(start), to_questdb_timestamp(end)),
    )
    seen = set()
    duplicates = []
    for row in cursor.fetchall():
        timestamp = normalize_db_timestamp(row[0])
        if timestamp in seen:
            duplicates.append(timestamp)
            if len(duplicates) >= 5:
                break
        seen.add(timestamp)

    if duplicates:
        sample = ", ".join(timestamp.isoformat() for timestamp in duplicates)
        raise RuntimeError(
            f"{symbol}: duplicate rows already exist in target range. "
            f"Sample duplicate timestamps: {sample}. "
            "This table requires a full replacement reconcile so stale duplicates are excluded."
        )


def create_staging_rows(cursor, staging_table: str, rows: list[CandleRow]) -> None:
    """Write replacement rows to staging and verify the staged row count."""

    create_candle_table(cursor, staging_table)
    insert_rows(cursor, staging_table, rows)
    cursor.execute(f"SELECT count() AS count FROM {staging_table}")
    staged_count = int(cursor.fetchone()[0])
    if staged_count != len(rows):
        raise RuntimeError(f"Staging row count mismatch: expected {len(rows)}, got {staged_count}")


def insert_from_table(cursor, source_table: str, target_table: str = TABLE_NAME) -> None:
    """Copy all rows from a temporary table into the target candle table."""

    ensure_safe_table_name(source_table)
    ensure_safe_table_name(target_table)
    cursor.execute(
        f"""
        INSERT INTO {target_table} (symbol, interval, timestamp, open, high, low, close, volume)
        SELECT symbol, interval, timestamp, open, high, low, close, volume
        FROM {source_table}
        """
    )


def fetch_existing_timestamps(cursor, symbol: str, start: datetime, end: datetime) -> set[datetime]:
    """Fetch existing target timestamps for deciding which staged rows to insert."""

    cursor.execute(
        f"""
        SELECT timestamp
        FROM {TABLE_NAME}
        WHERE symbol = %s AND interval = %s AND timestamp >= %s AND timestamp < %s
        ORDER BY timestamp ASC
        """,
        (symbol, INTERVAL, to_questdb_timestamp(start), to_questdb_timestamp(end)),
    )
    return {normalize_db_timestamp(row[0]) for row in cursor.fetchall()}


def is_minute_timestamp(timestamp: datetime) -> bool:
    """Return whether a timestamp can identify a canonical UTC 1m candle."""

    timestamp = timestamp.astimezone(timezone.utc)
    return timestamp.second == 0 and timestamp.microsecond == 0


def _row_from_db_values(values) -> CandleRow | None:
    """Convert one QuestDB row without allowing malformed data to be a watermark."""

    try:
        row = CandleRow(
            symbol=str(values[0]).upper(),
            interval=str(values[1]),
            timestamp=normalize_db_timestamp(values[2]),
            open=decimal_from_db(values[3]),
            high=decimal_from_db(values[4]),
            low=decimal_from_db(values[5]),
            close=decimal_from_db(values[6]),
            volume=decimal_from_db(values[7]),
        )
    except (TypeError, ValueError, InvalidOperation):
        return None
    try:
        valid = is_minute_timestamp(row.timestamp) and is_valid_candle_row(row)
    except InvalidOperation:
        return None
    return row if valid else None


def fetch_latest_valid_watermark(cursor, symbol: str, cutover: datetime) -> datetime | None:
    """Find the newest valid final 1m row for one symbol before ``cutover``.

    A plain ``MAX(timestamp)`` is not enough: malformed OHLCV rows must not
    advance the catch-up start and hide a missing interval.
    """

    cursor.execute(
        f"""
        SELECT symbol, interval, timestamp, open, high, low, close, volume
        FROM {TABLE_NAME}
        WHERE symbol = %s AND interval = %s AND timestamp < %s
        ORDER BY timestamp DESC
        """,
        (symbol, INTERVAL, to_questdb_timestamp(cutover)),
    )
    for values in cursor.fetchall():
        row = _row_from_db_values(values)
        if row is not None and row.symbol == symbol and row.interval == INTERVAL:
            return row.timestamp
    return None


def resolve_symbol_range(
    cursor,
    symbol: str,
    cutover: datetime,
    bootstrap_candles: int,
) -> SymbolReconciliationRange:
    """Resolve a per-symbol range ending at ``cutover``, capped at eight hours."""

    watermark = fetch_latest_valid_watermark(cursor, symbol, cutover)
    if watermark is None:
        expected_count = min(bootstrap_candles, MAX_BACKFILL_MINUTES)
        start = cutover - timedelta(minutes=expected_count)
        return SymbolReconciliationRange(
            symbol=symbol,
            start=start,
            end=cutover,
            watermark=None,
            bootstrap=True,
            expected_count=expected_count,
        )

    start = max(
        watermark + timedelta(minutes=1),
        cutover - timedelta(minutes=MAX_BACKFILL_MINUTES),
    )
    expected_count = max(0, int((cutover - start).total_seconds() // 60))
    return SymbolReconciliationRange(
        symbol=symbol,
        start=start if expected_count else None,
        end=cutover,
        watermark=watermark,
        bootstrap=False,
        expected_count=expected_count,
    )


def fetch_db_rows(cursor, symbol: str, start: datetime, end: datetime) -> list[CandleRow]:
    """Read target-range rows back from QuestDB for post-write verification."""

    return fetch_rows_from_table(cursor, TABLE_NAME, symbol, start, end)


def fetch_rows_from_table(cursor, table_name: str, symbol: str, start: datetime, end: datetime) -> list[CandleRow]:
    """Read one symbol/window from a validated candle table."""

    ensure_safe_table_name(table_name)
    cursor.execute(
        f"""
        SELECT symbol, interval, timestamp, open, high, low, close, volume
        FROM {table_name}
        WHERE symbol = %s AND interval = %s AND timestamp >= %s AND timestamp < %s
        ORDER BY timestamp ASC
        """,
        (symbol, INTERVAL, to_questdb_timestamp(start), to_questdb_timestamp(end)),
    )

    return [
        CandleRow(
            symbol=row[0],
            interval=row[1],
            timestamp=normalize_db_timestamp(row[2]),
            open=decimal_from_db(row[3]),
            high=decimal_from_db(row[4]),
            low=decimal_from_db(row[5]),
            close=decimal_from_db(row[6]),
            volume=decimal_from_db(row[7]),
        )
        for row in cursor.fetchall()
    ]


def fetch_all_rows_from_table(cursor, table_name: str) -> list[CandleRow]:
    """Read all rows from a validated temporary candle table."""

    ensure_safe_table_name(table_name)
    cursor.execute(
        f"""
        SELECT symbol, interval, timestamp, open, high, low, close, volume
        FROM {table_name}
        ORDER BY timestamp ASC
        """
    )
    return [
        CandleRow(
            symbol=row[0],
            interval=row[1],
            timestamp=normalize_db_timestamp(row[2]),
            open=decimal_from_db(row[3]),
            high=decimal_from_db(row[4]),
            low=decimal_from_db(row[5]),
            close=decimal_from_db(row[6]),
            volume=decimal_from_db(row[7]),
        )
        for row in cursor.fetchall()
    ]


def rows_match(actual_row: CandleRow, expected_row: CandleRow, tolerance: Decimal) -> bool:
    """Return whether one DB row matches one Binance canonical row."""

    if actual_row.timestamp != expected_row.timestamp:
        return False

    comparisons = (
        (actual_row.open, expected_row.open),
        (actual_row.high, expected_row.high),
        (actual_row.low, expected_row.low),
        (actual_row.close, expected_row.close),
        (actual_row.volume, expected_row.volume),
    )
    return all(abs(actual_value - expected_value) <= tolerance for actual_value, expected_value in comparisons)


def assert_rows_match(
    actual: list[CandleRow],
    expected: list[CandleRow],
    tolerance: Decimal,
    symbol: str,
    log_duplicates: bool = True,
    require_no_duplicates: bool = False,
) -> None:
    """Assert that QuestDB contains Binance rows."""

    actual_by_timestamp: dict[datetime, list[CandleRow]] = {}
    for actual_row in actual:
        actual_by_timestamp.setdefault(actual_row.timestamp, []).append(actual_row)

    duplicate_timestamps = [
        timestamp for timestamp, rows in actual_by_timestamp.items() if len(rows) > 1
    ]
    if duplicate_timestamps and log_duplicates:
        logger.warning(
            f"{symbol}: duplicate candle rows detected during verification; "
            f"duplicate_count={len(duplicate_timestamps)}, "
            f"samples={[timestamp.isoformat() for timestamp in duplicate_timestamps[:5]]}"
        )
    if duplicate_timestamps and require_no_duplicates:
        raise RuntimeError(
            f"{symbol}: duplicate candle rows are still visible after WAL upsert; "
            f"duplicate_count={len(duplicate_timestamps)}, "
            f"samples={[timestamp.isoformat() for timestamp in duplicate_timestamps[:5]]}"
        )

    if len(actual_by_timestamp) != len(expected):
        raise RuntimeError(
            f"{symbol}: verification key count mismatch: "
            f"expected={len(expected)}, got_distinct={len(actual_by_timestamp)}, got_rows={len(actual)}"
        )

    for expected_row in expected:
        candidate_rows = actual_by_timestamp.get(expected_row.timestamp)
        if not candidate_rows:
            raise RuntimeError(f"{symbol}: missing candle at {expected_row.timestamp.isoformat()}")
        if any(rows_match(actual_row, expected_row, tolerance) for actual_row in candidate_rows):
            continue

        actual_row = candidate_rows[-1]
        comparisons = (
            ("open", actual_row.open, expected_row.open),
            ("high", actual_row.high, expected_row.high),
            ("low", actual_row.low, expected_row.low),
            ("close", actual_row.close, expected_row.close),
            ("volume", actual_row.volume, expected_row.volume),
        )
        for field_name, actual_value, expected_value in comparisons:
            if abs(actual_value - expected_value) > tolerance:
                raise RuntimeError(
                    f"{symbol}: {field_name} mismatch at {actual_row.timestamp.isoformat()}: "
                    f"expected {expected_value}, got {actual_value}; "
                    f"candidate_rows={len(candidate_rows)}"
                )


def drop_table(cursor, table_name: str) -> None:
    """Drop a temporary table after validating the generated table name."""

    ensure_safe_table_name(table_name)
    cursor.execute(f"DROP TABLE IF EXISTS {table_name}")


def table_exists(cursor, table_name: str) -> bool:
    """Return whether QuestDB currently exposes a table in metadata."""

    ensure_safe_table_name(table_name)
    cursor.execute("SELECT count() AS count FROM tables() WHERE table_name = %s", (table_name,))
    return int(cursor.fetchone()[0]) > 0


def wait_for_table_state(cursor, table_name: str, should_exist: bool) -> None:
    """Wait briefly for QuestDB table metadata to reflect a DDL operation."""

    deadline = time.monotonic() + (DDL_RETRY_ATTEMPTS * DDL_RETRY_DELAY_SECONDS)
    while True:
        if table_exists(cursor, table_name) == should_exist:
            return
        if time.monotonic() >= deadline:
            state = "visible" if should_exist else "absent"
            raise RuntimeError(f"Timed out waiting for {table_name} to become {state}")
        time.sleep(DDL_RETRY_DELAY_SECONDS)


def wait_for_non_empty_table(cursor, table_name: str) -> int:
    """Wait for at least one row to become visible after a WAL insert."""

    ensure_safe_table_name(table_name)
    deadline = time.monotonic() + (DDL_RETRY_ATTEMPTS * DDL_RETRY_DELAY_SECONDS)
    last_count = 0

    while True:
        cursor.execute(f"SELECT count() AS count FROM {table_name}")
        last_count = int(cursor.fetchone()[0])
        if last_count > 0:
            return last_count
        if time.monotonic() >= deadline:
            logger.warning(f"Timed out waiting for WAL rows in {table_name}; latest visible count={last_count}")
            return last_count
        time.sleep(DDL_RETRY_DELAY_SECONDS)


def wait_for_symbol_window_count(cursor, symbol: str, start: datetime, end: datetime, expected_count: int) -> None:
    """Wait for reconciled WAL candle keys to become visible before verification."""

    deadline = time.monotonic() + (DDL_RETRY_ATTEMPTS * DDL_RETRY_DELAY_SECONDS)
    last_row_count = 0
    last_key_count = 0

    while True:
        cursor.execute(
            f"""
            SELECT timestamp
            FROM {TABLE_NAME}
            WHERE symbol = %s AND interval = %s AND timestamp >= %s AND timestamp < %s
            """,
            (symbol, INTERVAL, to_questdb_timestamp(start), to_questdb_timestamp(end)),
        )
        timestamps = [normalize_db_timestamp(row[0]) for row in cursor.fetchall()]
        last_row_count = len(timestamps)
        last_key_count = len(set(timestamps))

        if last_key_count >= expected_count:
            if last_row_count > last_key_count:
                logger.warning(
                    f"{symbol}: duplicate rows visible in reconciled WAL window; "
                    f"distinct_keys={last_key_count}, raw_rows={last_row_count}, "
                    f"window=[{start.isoformat()}, {end.isoformat()})"
                )
            return
        if time.monotonic() >= deadline:
            raise RuntimeError(
                f"{symbol}: timed out waiting for reconciled WAL rows to become visible; "
                f"expected_keys={expected_count}, got_distinct={last_key_count}, "
                f"got_rows={last_row_count}, window=[{start.isoformat()}, {end.isoformat()})"
            )
        time.sleep(DDL_RETRY_DELAY_SECONDS)


def wait_for_symbol_window_match(
    cursor,
    symbol: str,
    start: datetime,
    end: datetime,
    expected: list[CandleRow],
    tolerance: Decimal,
    timeout_seconds: float = WAL_APPLY_TIMEOUT_SECONDS,
    require_no_duplicates: bool = False,
) -> None:
    """Wait until WAL/dedup upserts are visible with the expected OHLCV values."""

    deadline = time.monotonic() + timeout_seconds
    last_error: Exception | None = None

    while True:
        actual_rows = fetch_db_rows(cursor, symbol, start, end)
        try:
            assert_rows_match(
                actual_rows,
                expected,
                tolerance,
                symbol,
                log_duplicates=False,
                require_no_duplicates=require_no_duplicates,
            )
            return
        except Exception as exc:
            last_error = exc

        if time.monotonic() >= deadline:
            raise RuntimeError(
                f"{symbol}: timed out waiting for REST reconcile upsert values to become visible; "
                f"window=[{start.isoformat()}, {end.isoformat()}), last_error={last_error}"
            ) from last_error

        time.sleep(DDL_RETRY_DELAY_SECONDS)


def rename_table(cursor, old_name: str, new_name: str) -> None:
    """Rename a QuestDB table after validating both dynamic names."""

    ensure_safe_table_name(old_name)
    ensure_safe_table_name(new_name)
    for attempt in range(1, DDL_RETRY_ATTEMPTS + 1):
        try:
            cursor.execute(f"RENAME TABLE {old_name} TO {new_name}")
            wait_for_table_state(cursor, old_name, should_exist=False)
            wait_for_table_state(cursor, new_name, should_exist=True)
            return
        except psycopg2.DatabaseError as exc:
            if attempt == DDL_RETRY_ATTEMPTS:
                raise
            try:
                cursor.connection.rollback()
            except Exception:
                logger.warning("Failed to rollback connection after rename error", exc_info=True)
            logger.warning(
                f"RENAME TABLE {old_name} TO {new_name} failed on attempt "
                f"{attempt}/{DDL_RETRY_ATTEMPTS}: {exc}. Retrying..."
            )
            time.sleep(DDL_RETRY_DELAY_SECONDS)


def list_reconciler_temp_tables(cursor) -> list[str]:
    """List backup/staging tables left by previous reconciler runs."""

    cursor.execute("SELECT table_name FROM tables()")
    table_names = []
    for row in cursor.fetchall():
        table_name = str(row[0])
        if is_reconciler_temp_table(table_name):
            table_names.append(table_name)
    return sorted(table_names)


def cleanup_reconciler_temp_tables(cursor, protected_tables: set[str] | None = None) -> None:
    """Drop old reconciler temporary tables that are not part of this active run."""

    protected_tables = protected_tables or set()
    temp_tables = [table for table in list_reconciler_temp_tables(cursor) if table not in protected_tables]
    if not temp_tables:
        logger.info("No old reconciler temporary tables to clean up.")
        return

    dropped_count = 0
    for table_name in temp_tables:
        try:
            drop_table(cursor, table_name)
            dropped_count += 1
        except Exception:
            logger.warning(f"Failed to drop old reconciler temporary table {table_name}", exc_info=True)

    logger.info(f"Dropped {dropped_count}/{len(temp_tables)} old reconciler temporary tables.")


def find_latest_old_table(cursor) -> str | None:
    """Find the newest full live-table backup left by the reconciler."""

    candidates: list[tuple[str, str]] = []
    for table_name in list_reconciler_temp_tables(cursor):
        match = OLD_TABLE_PATTERN.match(table_name)
        if match:
            candidates.append((match.group(1), table_name))

    if not candidates:
        return None
    return max(candidates)[1]


def recover_missing_live_table(cursor) -> None:
    """Restore `market_candles` from the newest backup if a previous swap lost it."""

    if table_exists(cursor, TABLE_NAME):
        return

    backup_table = find_latest_old_table(cursor)
    if not backup_table:
        raise RuntimeError(
            f"{TABLE_NAME} is missing and no reconciler backup table was found. "
            "Manual QuestDB recovery is required before reconciliation can continue."
        )

    restored_count = create_table_from_source(cursor, TABLE_NAME, backup_table, dedup=True)
    logger.warning(f"Restored missing {TABLE_NAME} from {backup_table} with {restored_count} rows.")


def reconcile_symbol(
    base_url: str,
    symbol: str,
    start: datetime,
    end: datetime,
    run_id: str,
    tolerance: Decimal,
    dry_run: bool,
    keep_temp: bool,
) -> None:
    """Reconcile one symbol from Binance data through staging and verification."""

    logger.info(f"{symbol}: fetching Binance {INTERVAL} candles from {start.isoformat()} to {end.isoformat()}")
    binance_rows = fetch_binance_klines(base_url, symbol, start, end)
    validate_rows(binance_rows, symbol, start, end)

    if dry_run:
        logger.info(f"{symbol}: dry run passed. {len(binance_rows)} Binance candles are complete and valid.")
        return

    replacement_table = build_table_name("market_candles_replace", symbol, run_id)
    staging_table = build_table_name("market_candles_stage", symbol, run_id)
    old_table = build_table_name("market_candles_old", symbol, run_id)
    failed_table = build_table_name("market_candles_failed", symbol, run_id)
    replacement_created = False
    staging_created = False
    old_table_created = False
    live_table_dropped = False
    replacement_is_live = False
    build_conn = None

    try:
        build_conn = create_connection()
        with build_conn.cursor() as cursor:
            ensure_market_table(cursor)
            create_staging_rows(cursor, staging_table, binance_rows)
            staging_created = True
            logger.info(f"{symbol}: staged {len(binance_rows)} replacement rows in {staging_table}")

            replacement_count = create_replacement_table_from_staging(
                cursor,
                replacement_table,
                staging_table,
                symbol,
                start,
                end,
            )
            replacement_created = True
            logger.info(f"{symbol}: built {replacement_table} with {replacement_count} total rows")

            replacement_rows = fetch_rows_from_table(cursor, replacement_table, symbol, start, end)
            assert_rows_match(replacement_rows, binance_rows, tolerance, symbol)
            logger.info(f"{symbol}: replacement table verified before swap")
        build_conn.close()
        build_conn = None

        backup_conn = create_connection()
        try:
            with backup_conn.cursor() as cursor:
                backup_count = create_full_backup_table(cursor, old_table)
                old_table_created = True
                logger.info(f"{symbol}: backed up live table to {old_table} with {backup_count} rows")

                drop_table(cursor, TABLE_NAME)
                wait_for_table_state(cursor, TABLE_NAME, should_exist=False)
                live_table_dropped = True
                logger.info(f"{symbol}: dropped live table before replacement swap")
        finally:
            backup_conn.close()

        swap_conn = create_connection()
        try:
            with swap_conn.cursor() as cursor:
                live_count = create_table_from_source(cursor, TABLE_NAME, replacement_table, dedup=True)
                replacement_is_live = True
                logger.info(f"{symbol}: created live table from {replacement_table} with {live_count} rows")

                wait_for_symbol_window_count(cursor, symbol, start, end, len(binance_rows))
                wait_for_symbol_window_match(
                    cursor,
                    symbol,
                    start,
                    end,
                    binance_rows,
                    tolerance,
                    require_no_duplicates=True,
                )
                actual_rows = fetch_db_rows(cursor, symbol, start, end)
                validate_rows(actual_rows, symbol, start, end)
                assert_rows_match(
                    actual_rows,
                    binance_rows,
                    tolerance,
                    symbol,
                    require_no_duplicates=True,
                )
                logger.info(f"{symbol}: swapped and verified {len(binance_rows)} candles")
        finally:
            swap_conn.close()
    except Exception:
        if build_conn is not None:
            build_conn.close()
        logger.error(f"{symbol}: replacement failed. Attempting rollback.", exc_info=True)
        rollback_conn = create_connection()
        try:
            with rollback_conn.cursor() as cursor:
                if replacement_is_live:
                    try:
                        if table_exists(cursor, TABLE_NAME):
                            create_table_from_source(cursor, failed_table, TABLE_NAME)
                            drop_table(cursor, TABLE_NAME)
                            wait_for_table_state(cursor, TABLE_NAME, should_exist=False)
                        create_table_from_source(cursor, TABLE_NAME, old_table, dedup=True)
                        logger.warning(f"{symbol}: rollback completed. Failed table retained as {failed_table}")
                    except Exception:
                        logger.error(
                            f"{symbol}: rollback failed. Old table retained for manual recovery: {old_table}",
                            exc_info=True,
                        )
                elif old_table_created and live_table_dropped:
                    try:
                        create_table_from_source(cursor, TABLE_NAME, old_table, dedup=True)
                        logger.warning(f"{symbol}: restored original table name from {old_table}")
                    except Exception:
                        logger.error(f"{symbol}: failed to restore original table name from {old_table}", exc_info=True)
                elif old_table_created and not keep_temp:
                    try:
                        drop_table(cursor, old_table)
                    except Exception:
                        logger.warning(f"{symbol}: failed to drop unused backup table {old_table}", exc_info=True)

                if replacement_created and not replacement_is_live and not keep_temp:
                    try:
                        drop_table(cursor, replacement_table)
                    except Exception:
                        logger.warning(f"{symbol}: failed to drop replacement table {replacement_table}", exc_info=True)
                if staging_created and not keep_temp:
                    try:
                        drop_table(cursor, staging_table)
                    except Exception:
                        logger.warning(f"{symbol}: failed to drop staging table {staging_table}", exc_info=True)
        finally:
            rollback_conn.close()
        raise

    if not keep_temp:
        cleanup_conn = create_connection()
        try:
            with cleanup_conn.cursor() as cursor:
                for table_name in (old_table, replacement_table, staging_table):
                    try:
                        drop_table(cursor, table_name)
                    except Exception:
                        logger.warning(f"{symbol}: failed to drop temporary table {table_name}", exc_info=True)
        finally:
            cleanup_conn.close()


def parse_args():
    """Parse command-line options for the maintenance script."""

    parser = argparse.ArgumentParser(
        description=(
            "Overwrite the configured closed 1m market_candles window from Binance REST klines, "
            "excluding the currently streaming candle."
        )
    )
    parser.add_argument(
        "--symbols",
        help="Comma-separated symbols. Defaults to TRADING_SYMBOLS from data_pipeline/.env, or BTCUSDT.",
    )
    parser.add_argument(
        "--binance-rest-url",
        default=os.getenv("BINANCE_REST_URL") or DEFAULT_BINANCE_REST_URL,
        help="Binance REST base URL.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Fetch and validate Binance data without writing DB.")
    parser.add_argument("--keep-temp", action="store_true", help="Keep replacement/old tables after success.")
    parser.add_argument(
        "--bootstrap-candles",
        type=int,
        default=None,
        help=f"Closed 1m candles to fetch only when a symbol has no valid DB watermark. Defaults to {DEFAULT_BOOTSTRAP_CANDLES}.",
    )
    parser.add_argument(
        "--tolerance",
        default=str(DEFAULT_TOLERANCE),
        help="Allowed numeric difference when verifying written DOUBLE values.",
    )
    return parser.parse_args()


def run_reconciliation(
    symbols_arg: str | None = None,
    binance_rest_url: str | None = None,
    dry_run: bool = False,
    keep_temp: bool = False,
    tolerance_arg: str | Decimal | None = None,
    bootstrap_candles: int | None = None,
    cutover: datetime | None = None,
) -> ReconciliationResult:
    """Catch each symbol up from its valid DB watermark to one Binance cutover."""

    load_environment()

    base_url = binance_rest_url or os.getenv("BINANCE_REST_URL") or DEFAULT_BINANCE_REST_URL
    symbols = parse_symbols(symbols_arg or os.getenv("TRADING_SYMBOLS"))
    tolerance = Decimal(str(tolerance_arg or DEFAULT_TOLERANCE))
    requested_bootstrap_candles = parse_positive_int(
        bootstrap_candles if bootstrap_candles is not None else os.getenv("STARTUP_RECONCILE_BOOTSTRAP_CANDLES"),
        DEFAULT_BOOTSTRAP_CANDLES,
    )
    resolved_bootstrap_candles = min(
        requested_bootstrap_candles,
        MAX_BACKFILL_MINUTES,
    )
    if requested_bootstrap_candles > MAX_BACKFILL_MINUTES:
        logger.warning(
            "STARTUP_RECONCILE_BOOTSTRAP_CANDLES exceeds the eight-hour backfill cap; "
            f"using {MAX_BACKFILL_MINUTES} minutes."
        )
    if cutover is None:
        cutover = resolve_startup_cutover(base_url)
        wait_for_open_candle_close(base_url, cutover)
    cutover = cutover.astimezone(timezone.utc).replace(second=0, microsecond=0)
    logger.info(
        f"Reconciling {len(symbols)} symbol(s), interval={INTERVAL}, "
        f"cutover={cutover.isoformat()}; bootstrap_candles={resolved_bootstrap_candles}; "
        "mode=DB_WATERMARK_BINANCE_CUTOVER"
    )
    active_temp_tables: set[str] = set()

    conn = create_connection()
    try:
        with conn.cursor() as cursor:
            if table_exists(cursor, TABLE_NAME):
                if not dry_run:
                    ensure_market_table(cursor, allow_migration=True)
                ranges = [
                    resolve_symbol_range(cursor, symbol, cutover, resolved_bootstrap_candles)
                    for symbol in symbols
                ]
            elif not dry_run and find_latest_old_table(cursor):
                recover_missing_live_table(cursor)
                ensure_market_table(cursor, allow_migration=True)
                ranges = [
                    resolve_symbol_range(cursor, symbol, cutover, resolved_bootstrap_candles)
                    for symbol in symbols
                ]
            else:
                if not dry_run:
                    ensure_market_table(cursor, allow_migration=True)
                ranges = [
                    SymbolReconciliationRange(
                        symbol=symbol,
                        start=cutover - timedelta(minutes=resolved_bootstrap_candles),
                        end=cutover,
                        watermark=None,
                        bootstrap=True,
                        expected_count=resolved_bootstrap_candles,
                    )
                    for symbol in symbols
                ]
    finally:
        conn.close()

    for symbol_range in ranges:
        if symbol_range.start is None:
            logger.info(
                f"{symbol_range.symbol}: valid watermark={symbol_range.watermark.isoformat()} is at the cutover; "
                "no REST fetch or DB write is needed."
            )
            continue
        run_id = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
        reconcile_symbol(
            base_url=base_url,
            symbol=symbol_range.symbol,
            start=symbol_range.start,
            end=cutover,
            run_id=run_id,
            tolerance=tolerance,
            dry_run=dry_run,
            keep_temp=keep_temp,
        )

    if not keep_temp and not dry_run:
        conn = create_connection()
        try:
            with conn.cursor() as cursor:
                cleanup_reconciler_temp_tables(cursor, protected_tables=active_temp_tables)
        finally:
            conn.close()

    fetch_starts = [item.start for item in ranges if item.start is not None]
    return ReconciliationResult(
        symbols=symbols,
        interval=INTERVAL,
        start=min(fetch_starts) if fetch_starts else cutover,
        end=cutover,
        expected_count=sum(item.expected_count for item in ranges),
        dry_run=dry_run,
        ranges=ranges,
    )


def main() -> None:
    """Run candle reconciliation from the command line."""

    load_environment()
    args = parse_args()
    run_reconciliation(
        symbols_arg=args.symbols,
        binance_rest_url=args.binance_rest_url,
        dry_run=args.dry_run,
        keep_temp=args.keep_temp,
        tolerance_arg=args.tolerance,
        bootstrap_candles=args.bootstrap_candles,
    )


if __name__ == "__main__":
    main()
