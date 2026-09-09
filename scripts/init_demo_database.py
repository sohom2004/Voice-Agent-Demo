#!/usr/bin/env python3
"""Initialize (or rebuild) the medical-billing BPO demo SQLite database.

Usage:
  python3 scripts/init_demo_database.py
  python3 scripts/init_demo_database.py --path /tmp/demo_billing.db
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "sql-mcp"))

from sql_mcp.demo_billing import REQUIRED_TABLES, initialize_demo_database  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Initialize medical billing demo database")
    parser.add_argument(
        "--path",
        default=str(ROOT / "demo_database.db"),
        help="SQLite database path (default: ./demo_database.db)",
    )
    args = parser.parse_args()
    path = initialize_demo_database(args.path, overwrite=True)

    conn = sqlite3.connect(str(path))
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        tables = [r[0] for r in cur.fetchall()]
        counts = {}
        for table in tables:
            cur.execute(f"SELECT COUNT(*) FROM {table}")
            counts[table] = cur.fetchone()[0]
    finally:
        conn.close()

    missing = [t for t in REQUIRED_TABLES if t not in tables]
    if missing:
        print(f"ERROR: missing tables: {missing}", file=sys.stderr)
        return 1

    print(f"Initialized demo database at {path}")
    for table, count in counts.items():
        print(f"  {table}: {count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
