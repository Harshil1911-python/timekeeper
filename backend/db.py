"""
db.py — SQLite connection handling + schema bootstrap for Timekeeper.
"""
import sqlite3
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "database", "timekeeper.db"))
SCHEMA_PATH = os.path.join(BASE_DIR, "database", "schema.sql")


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    """Create the database file and tables if they don't already exist,
    then apply any small forward migrations for columns added after the
    original schema (safe to run every startup — checks before altering)."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = get_connection()
    with open(SCHEMA_PATH, "r") as f:
        conn.executescript(f.read())
    conn.commit()
    _migrate(conn)
    conn.close()


def _migrate(conn):
    cols = [r["name"] for r in conn.execute("PRAGMA table_info(tasks)").fetchall()]
    if "delegated_to" not in cols:
        conn.execute("ALTER TABLE tasks ADD COLUMN delegated_to TEXT")
        conn.commit()


def row_to_dict(row):
    return dict(row) if row else None


def rows_to_list(rows):
    return [dict(r) for r in rows]
