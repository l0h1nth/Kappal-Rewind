"""Shared CSV schema and timestamp policy for audit and ingestion."""

import re
from datetime import datetime, timedelta, timezone, tzinfo

IST = timezone(timedelta(hours=5, minutes=30))
COLUMNS = ["track_id", "timestamp", "lat", "lon", "speed_knots", "heading"]
TIMESTAMP_FORMAT = re.compile(
    r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?"
    r"(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?"
)


def parse_timestamp(value: str, *, naive_timezone: tzinfo = IST) -> datetime:
    """Return UTC; existing callers retain IST, uploads supply their configured zone."""
    if not TIMESTAMP_FORMAT.fullmatch(value):
        raise ValueError("expected ISO date and time with seconds (up to 6 fractional digits)")
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        first = parsed.replace(tzinfo=naive_timezone, fold=0)
        second = parsed.replace(tzinfo=naive_timezone, fold=1)
        if first.utcoffset() != second.utcoffset():
            raise ValueError("naive time is ambiguous or nonexistent in the configured timezone; supply an explicit offset")
        parsed = first
    return parsed.astimezone(timezone.utc)
