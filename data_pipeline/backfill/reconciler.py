"""Reconcile closed 1-minute candles against Binance REST klines.

The startup backfill service runs this before the realtime processor starts. It
upserts a closed window into the WAL/dedup candle table, then the processor uses
the reconciled window end as a write fence while it drains buffered Kafka trades.
The full table replacement helpers remain for manual repair workflows.
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
RECONCILE_WINDOW_HOURS = 24
DEFAULT_LIMIT = 1000
DEFAULT_TOLERANCE = Decimal("0.00000001")
MIN_SERVER_SECONDS_AFTER_BOUNDARY = 10
RECONCILE_END_LAG_MINUTES = 2
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
    """Summary of one bounded reconciliation run."""

    symbols: list[str]
    interval: str
    start: datetime
    end: datetime
    expected_count: int
    dry_run: bool


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


def resolve_latest_closed_end(base_url: str, end_lag_minutes: int | None = None) -> datetime:
    """Return the exclusive end timestamp after Binance's newest closed candle.

    The short wait after a fresh minute boundary avoids choosing an unstable
    exchange boundary. The returned value is the current Binance minute floor
    minus the configured safety lag, so the open in-progress candle and the
    newest live-processor write targets are excluded.
    """

    server_time = fetch_binance_server_time(base_url)
    if server_time.second < MIN_SERVER_SECONDS_AFTER_BOUNDARY:
        wait_seconds = MIN_SERVER_SECONDS_AFTER_BOUNDARY - server_time.second
        logger.info(
            f"Binance server time is {server_time.isoformat()}, waiting {wait_seconds}s "
            "to avoid reconciling during the minute boundary."
        )
        time.sleep(wait_seconds)
        server_time = fetch_binance_server_time(base_url)

    safe_lag = parse_positive_int(end_lag_minutes, RECONCILE_END_LAG_MINUTES, minimum=0)
    return server_time.replace(second=0, microsecond=0) - timedelta(minutes=safe_lag)


def resolve_reconcile_window(
    base_url: str,
    window_hours: int | None = None,
    end_lag_minutes: int | None = None,
) -> tuple[datetime, datetime]:
    """Return the one-shot closed candle window aligned to Binance time."""

    hours = parse_positive_int(window_hours, RECONCILE_WINDOW_HOURS)
    end = resolve_latest_closed_end(base_url, end_lag_minutes=end_lag_minutes)
    start = end - timedelta(hours=hours)
    return start, end


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

        if row.open <= 0 or row.high <= 0 or row.low <= 0 or row.close <= 0:
            raise ValueError(f"{symbol}: non-positive OHLC at {row.timestamp.isoformat()}")
        if row.volume < 0:
            raise ValueError(f"{symbol}: negative volume at {row.timestamp.isoformat()}")
        if row.high < max(row.open, row.close) or row.low > min(row.open, row.close) or row.high < row.low:
            raise ValueError(f"{symbol}: inconsistent OHLC at {row.timestamp.isoformat()}")

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
            cursor.execute(
                f"""
                CREATE TABLE IF NOT EXISTS {TABLE_NAME} (
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
            cursor.execute(f"ALTER TABLE {TABLE_NAME} DEDUP ENABLE UPSERT KEYS {UPSERT_KEYS}")
            wait_for_table_state(cursor, TABLE_NAME, should_exist=True)
            return
        except psycopg2.DatabaseError as exc:
            try:
                cursor.connection.rollback()
            except Exception:
                logger.warning("Failed to rollback connection after market table DDL error", exc_info=True)

            if table_exists(cursor, TABLE_NAME):
                if not allow_migration:
                    raise RuntimeError(
                        f"{TABLE_NAME} exists but cannot enable DEDUP UPSERT KEYS {UPSERT_KEYS}. "
                        "The concurrent startup reconciler will not migrate/drop the live table while "
                        "the processor may be writing. Run a manual full repair with the processor stopped."
                    )
                logger.warning(
                    f"{TABLE_NAME} exists but cannot enable DEDUP UPSERT KEYS {UPSERT_KEYS}. "
                    "Attempting one-time WAL/dedup table migration before reconciliation."
                )
                migrate_market_table_to_dedup(cursor)
                cursor.execute(f"ALTER TABLE {TABLE_NAME} DEDUP ENABLE UPSERT KEYS {UPSERT_KEYS}")
                return

            if attempt == DDL_RETRY_ATTEMPTS:
                raise

            logger.warning(
                f"Ensuring {TABLE_NAME} failed on attempt {attempt}/{DDL_RETRY_ATTEMPTS}: "
                f"{exc}. Retrying..."
            )
            time.sleep(DDL_RETRY_DELAY_SECONDS)


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
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
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


def assert_rows_match(actual: list[CandleRow], expected: list[CandleRow], tolerance: Decimal, symbol: str) -> None:
    """Assert that QuestDB contains Binance rows, tolerating duplicate stale rows."""

    actual_by_timestamp: dict[datetime, list[CandleRow]] = {}
    for actual_row in actual:
        actual_by_timestamp.setdefault(actual_row.timestamp, []).append(actual_row)

    duplicate_timestamps = [
        timestamp for timestamp, rows in actual_by_timestamp.items() if len(rows) > 1
    ]
    if duplicate_timestamps:
        logger.warning(
            f"{symbol}: duplicate candle rows detected during verification; "
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
                actual_rows = fetch_db_rows(cursor, symbol, start, end)
                assert_rows_match(actual_rows, binance_rows, tolerance, symbol)
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


def reconcile_tail_append(
    base_url: str,
    symbols: list[str],
    start: datetime,
    end: datetime,
    tolerance: Decimal,
    dry_run: bool,
) -> None:
    """Replace a closed catch-up window using the full replacement path."""

    if dry_run:
        for symbol in symbols:
            logger.info(
                f"{symbol}: fetching Binance {INTERVAL} tail candles from "
                f"{start.isoformat()} to {end.isoformat()}"
            )
            rows = fetch_binance_klines(base_url, symbol, start, end)
            validate_rows(rows, symbol, start, end)
            logger.info(f"{symbol}: tail dry run passed. {len(rows)} Binance candles are complete and valid.")
        return

    total_rows = 0
    expected_count = int((end - start).total_seconds() // 60)
    for symbol in symbols:
        run_id = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
        logger.info(
            f"{symbol}: replacing REST reconcile window via table rebuild; "
            f"window=[{start.isoformat()}, {end.isoformat()}), expected_candles={expected_count}"
        )
        reconcile_symbol(
            base_url=base_url,
            symbol=symbol,
            start=start,
            end=end,
            run_id=run_id,
            tolerance=tolerance,
            dry_run=False,
            keep_temp=False,
        )
        total_rows += expected_count

    if total_rows:
        logger.info(f"Replaced {total_rows} REST reconcile candle row(s) in {TABLE_NAME}.")
    else:
        logger.info("No REST reconcile candle rows to replace.")


def run_recent_reconciliation(
    lookback_minutes: int = 30,
    symbols_arg: str | None = None,
    binance_rest_url: str | None = None,
    dry_run: bool = False,
    tolerance_arg: str | Decimal | None = None,
) -> None:
    """Replace a short closed-candle window after the live processor has started."""

    load_environment()

    base_url = binance_rest_url or os.getenv("BINANCE_REST_URL") or DEFAULT_BINANCE_REST_URL
    symbols = parse_symbols(symbols_arg or os.getenv("TRADING_SYMBOLS"))
    tolerance = Decimal(str(tolerance_arg or DEFAULT_TOLERANCE))
    end = resolve_latest_closed_end(base_url)
    start = end - timedelta(minutes=max(1, lookback_minutes))
    expected_count = int((end - start).total_seconds() // 60)

    logger.info(
        f"Recent REST reconcile started: symbols={symbols}, interval={INTERVAL}, "
        f"window=[{start.isoformat()}, {end.isoformat()}), expected_candles={expected_count}"
    )
    reconcile_tail_append(
        base_url=base_url,
        symbols=symbols,
        start=start,
        end=end,
        tolerance=tolerance,
        dry_run=dry_run,
    )
    logger.info("Recent REST reconcile completed.")


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
        "--window-hours",
        type=int,
        default=None,
        help=f"Closed 1m lookback window to reconcile. Defaults to {RECONCILE_WINDOW_HOURS}.",
    )
    parser.add_argument(
        "--end-lag-minutes",
        type=int,
        default=None,
        help=(
            "Minutes to leave between the reconcile end and Binance's current minute floor. "
            f"Defaults to {RECONCILE_END_LAG_MINUTES}."
        ),
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
    window_hours: int | None = None,
    end_lag_minutes: int | None = None,
) -> ReconciliationResult:
    """Run candle reconciliation for the configured symbols.

    This function is used by both the CLI maintenance command and the pipeline
    startup runner. It runs a single bounded window and leaves a safety lag so
    it does not target candles the realtime processor is currently closing.
    """

    load_environment()

    base_url = binance_rest_url or os.getenv("BINANCE_REST_URL") or DEFAULT_BINANCE_REST_URL
    symbols = parse_symbols(symbols_arg or os.getenv("TRADING_SYMBOLS"))
    tolerance = Decimal(str(tolerance_arg or DEFAULT_TOLERANCE))
    resolved_window_hours = parse_positive_int(
        window_hours if window_hours is not None else os.getenv("STARTUP_RECONCILE_WINDOW_HOURS"),
        RECONCILE_WINDOW_HOURS,
    )
    resolved_end_lag_minutes = parse_positive_int(
        end_lag_minutes if end_lag_minutes is not None else os.getenv("STARTUP_RECONCILE_END_LAG_MINUTES"),
        RECONCILE_END_LAG_MINUTES,
        minimum=0,
    )
    start, end = resolve_reconcile_window(
        base_url,
        window_hours=resolved_window_hours,
        end_lag_minutes=resolved_end_lag_minutes,
    )
    expected_count = int((end - start).total_seconds() // 60)
    logger.info(
        f"Reconciling {len(symbols)} symbol(s), interval={INTERVAL}, "
        f"window=[{start.isoformat()}, {end.isoformat()}); "
        f"expected_candles={expected_count}; "
        f"window_hours={resolved_window_hours}; "
        f"end_lag_minutes={resolved_end_lag_minutes}; "
        "mode=ONE_SHOT_REPLACE"
    )
    active_temp_tables: set[str] = set()

    if not dry_run:
        conn = create_connection()
        try:
            with conn.cursor() as cursor:
                if table_exists(cursor, TABLE_NAME):
                    ensure_market_table(cursor, allow_migration=True)
                elif find_latest_old_table(cursor):
                    recover_missing_live_table(cursor)
                else:
                    ensure_market_table(cursor, allow_migration=True)
        finally:
            conn.close()

    for symbol in symbols:
        run_id = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
        reconcile_symbol(
            base_url=base_url,
            symbol=symbol,
            start=start,
            end=end,
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

    return ReconciliationResult(
        symbols=symbols,
        interval=INTERVAL,
        start=start,
        end=end,
        expected_count=expected_count,
        dry_run=dry_run,
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
        window_hours=args.window_hours,
        end_lag_minutes=args.end_lag_minutes,
    )


if __name__ == "__main__":
    main()
