-- ============================================================
-- TIMEKEEPER — Database Schema (SQLite)
-- ============================================================

PRAGMA foreign_keys = ON;

-- Hour-by-hour time log: what did you actually do in each hour?
CREATE TABLE IF NOT EXISTS time_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    log_date    TEXT    NOT NULL,             -- 'YYYY-MM-DD'
    hour        INTEGER NOT NULL,             -- 0-23
    activity    TEXT    NOT NULL DEFAULT '',
    category    TEXT    NOT NULL DEFAULT 'uncategorized', -- work/personal/distraction/rest/etc
    is_distraction INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(log_date, hour)
);

-- Tasks with Eisenhower flags (important / urgent) used to compute the
-- "effectiveness ratio" for a day (important+urgent completed / total completed).
CREATE TABLE IF NOT EXISTS tasks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT    NOT NULL,
    description  TEXT    DEFAULT '',
    task_date    TEXT    NOT NULL,            -- 'YYYY-MM-DD' the task belongs to
    is_important INTEGER NOT NULL DEFAULT 0,
    is_urgent    INTEGER NOT NULL DEFAULT 0,
    is_completed INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    delegated_to TEXT,                         -- name of person a task was delegated to
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Weekly schedule / time-blocking, Calendly-style. Each block sits on a
-- day-of-week (0=Mon..6=Sun) and an hour range, and can repeat every week.
CREATE TABLE IF NOT EXISTS schedule_blocks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    day_of_week INTEGER NOT NULL,             -- 0=Mon ... 6=Sun
    start_hour  INTEGER NOT NULL,             -- 0-23
    end_hour    INTEGER NOT NULL,             -- exclusive, e.g. 9-10
    title       TEXT    NOT NULL,
    category    TEXT    NOT NULL DEFAULT 'work',
    recurring   INTEGER NOT NULL DEFAULT 1,
    week_start  TEXT,                          -- only used when recurring=0 (a one-off week)
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Recurring tasks — can be entered manually by the user, or detected
-- automatically by the backend from repeated task titles across past weeks.
CREATE TABLE IF NOT EXISTS recurring_tasks (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    title          TEXT    NOT NULL,
    source         TEXT    NOT NULL DEFAULT 'user',  -- 'user' or 'auto'
    occurrences    INTEGER NOT NULL DEFAULT 1,
    last_seen_date TEXT,
    is_active      INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(title, source)
);

-- Distractions: name a distraction, cap it with an allotted time budget
-- per day, and log how much of it actually got used.
CREATE TABLE IF NOT EXISTS distractions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    log_date        TEXT    NOT NULL,
    allotted_minutes INTEGER NOT NULL DEFAULT 30,
    used_minutes    INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(name, log_date)
);

-- Freeform notebook, can optionally link back to a task or a date.
CREATE TABLE IF NOT EXISTS notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL DEFAULT 'Untitled',
    content     TEXT    NOT NULL DEFAULT '',
    tags        TEXT    NOT NULL DEFAULT '',       -- comma-separated
    linked_date TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- End-of-day self rating (1-5) plus a cached effectiveness ratio, so the
-- performance graphs don't need to recompute history every time.
CREATE TABLE IF NOT EXISTS daily_ratings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    log_date        TEXT    NOT NULL UNIQUE,
    rating          INTEGER,                        -- 1-5, user supplied
    effective_ratio REAL    NOT NULL DEFAULT 0,      -- 0-1, computed
    notes           TEXT    DEFAULT '',
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_time_logs_date ON time_logs(log_date);
CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(task_date);
CREATE INDEX IF NOT EXISTS idx_distractions_date ON distractions(log_date);

-- Habit tracker: a habit you check off each day it's done.
CREATE TABLE IF NOT EXISTS habits (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE,
    frequency   TEXT    NOT NULL DEFAULT 'daily',   -- 'daily' or 'weekly'
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One row = one habit checked-off on one date.
CREATE TABLE IF NOT EXISTS habit_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id    INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    log_date    TEXT    NOT NULL,
    UNIQUE(habit_id, log_date)
);
CREATE INDEX IF NOT EXISTS idx_habit_logs_date ON habit_logs(log_date);

-- Focus / Pomodoro sessions — completed timer runs, logged for the day.
CREATE TABLE IF NOT EXISTS focus_sessions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    log_date     TEXT    NOT NULL,
    minutes      INTEGER NOT NULL,
    label        TEXT    DEFAULT '',
    completed_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_focus_date ON focus_sessions(log_date);
