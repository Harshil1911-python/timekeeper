"""
Timekeeper — backend API (Flask + SQLite, stdlib only besides Flask).

Run with:  python app.py
Serves the frontend from ../frontend and the API under /api/*.
"""
from flask import Flask, request, jsonify, send_from_directory
from datetime import datetime, timedelta
from collections import defaultdict, Counter
import os

from db import get_connection, init_db, rows_to_list, row_to_dict

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")

# ------------------------------------------------------------------ #
# Static frontend
# ------------------------------------------------------------------ #

@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/<path:path>")
def static_proxy(path):
    return send_from_directory(FRONTEND_DIR, path)


# ------------------------------------------------------------------ #
# Helpers
# ------------------------------------------------------------------ #

def today_str():
    return datetime.now().strftime("%Y-%m-%d")


def parse_date(s):
    return datetime.strptime(s, "%Y-%m-%d")


def week_bounds(date_str):
    """Return (monday, sunday) date strings for the week containing date_str."""
    d = parse_date(date_str)
    monday = d - timedelta(days=d.weekday())
    sunday = monday + timedelta(days=6)
    return monday.strftime("%Y-%m-%d"), sunday.strftime("%Y-%m-%d")


def date_range(start_str, end_str):
    start, end = parse_date(start_str), parse_date(end_str)
    out = []
    cur = start
    while cur <= end:
        out.append(cur.strftime("%Y-%m-%d"))
        cur += timedelta(days=1)
    return out


def recompute_daily_rating(conn, log_date):
    """Recompute the cached effective_ratio for a given date based on completed tasks."""
    tasks = conn.execute(
        "SELECT * FROM tasks WHERE task_date = ? AND is_completed = 1", (log_date,)
    ).fetchall()
    total = len(tasks)
    effective = sum(1 for t in tasks if t["is_important"] and t["is_urgent"])
    ratio = (effective / total) if total else 0.0

    existing = conn.execute(
        "SELECT * FROM daily_ratings WHERE log_date = ?", (log_date,)
    ).fetchone()
    if existing:
        conn.execute(
            "UPDATE daily_ratings SET effective_ratio = ?, updated_at = datetime('now') WHERE log_date = ?",
            (ratio, log_date),
        )
    else:
        conn.execute(
            "INSERT INTO daily_ratings (log_date, rating, effective_ratio) VALUES (?, NULL, ?)",
            (log_date, ratio),
        )
    conn.commit()
    return ratio


# ------------------------------------------------------------------ #
# TIME LOGS — hour-by-hour tracking
# ------------------------------------------------------------------ #

@app.route("/api/timelog", methods=["GET"])
def get_timelog():
    date = request.args.get("date", today_str())
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM time_logs WHERE log_date = ? ORDER BY hour", (date,)
    ).fetchall()
    conn.close()
    return jsonify(rows_to_list(rows))


@app.route("/api/timelog", methods=["POST"])
def upsert_timelog():
    data = request.get_json(force=True)
    date = data.get("log_date", today_str())
    hour = int(data["hour"])
    activity = data.get("activity", "")
    category = data.get("category", "uncategorized")
    is_distraction = 1 if data.get("is_distraction") else 0

    conn = get_connection()
    existing = conn.execute(
        "SELECT id FROM time_logs WHERE log_date = ? AND hour = ?", (date, hour)
    ).fetchone()
    if existing:
        conn.execute(
            """UPDATE time_logs SET activity=?, category=?, is_distraction=?,
               updated_at=datetime('now') WHERE log_date=? AND hour=?""",
            (activity, category, is_distraction, date, hour),
        )
    else:
        conn.execute(
            """INSERT INTO time_logs (log_date, hour, activity, category, is_distraction)
               VALUES (?, ?, ?, ?, ?)""",
            (date, hour, activity, category, is_distraction),
        )
    conn.commit()
    row = conn.execute(
        "SELECT * FROM time_logs WHERE log_date = ? AND hour = ?", (date, hour)
    ).fetchone()
    conn.close()
    return jsonify(row_to_dict(row))


@app.route("/api/timelog/<int:log_id>", methods=["DELETE"])
def delete_timelog(log_id):
    conn = get_connection()
    conn.execute("DELETE FROM time_logs WHERE id = ?", (log_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ------------------------------------------------------------------ #
# TASKS — important / urgent, feeds effectiveness ratio
# ------------------------------------------------------------------ #

@app.route("/api/tasks", methods=["GET"])
def get_tasks():
    date = request.args.get("date")
    start = request.args.get("start")
    end = request.args.get("end")
    conn = get_connection()
    if start and end:
        rows = conn.execute(
            "SELECT * FROM tasks WHERE task_date BETWEEN ? AND ? ORDER BY task_date, id",
            (start, end),
        ).fetchall()
    else:
        date = date or today_str()
        rows = conn.execute(
            "SELECT * FROM tasks WHERE task_date = ? ORDER BY id", (date,)
        ).fetchall()
    conn.close()
    return jsonify(rows_to_list(rows))


@app.route("/api/tasks", methods=["POST"])
def create_task():
    data = request.get_json(force=True)
    conn = get_connection()
    cur = conn.execute(
        """INSERT INTO tasks (title, description, task_date, is_important, is_urgent, is_completed)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (
            data["title"],
            data.get("description", ""),
            data.get("task_date", today_str()),
            1 if data.get("is_important") else 0,
            1 if data.get("is_urgent") else 0,
            1 if data.get("is_completed") else 0,
        ),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM tasks WHERE id = ?", (cur.lastrowid,)).fetchone()
    conn.close()
    return jsonify(row_to_dict(row))


@app.route("/api/tasks/<int:task_id>", methods=["PUT"])
def update_task(task_id):
    data = request.get_json(force=True)
    conn = get_connection()
    existing = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not existing:
        conn.close()
        return jsonify({"error": "not found"}), 404

    is_completed = data.get("is_completed", existing["is_completed"])
    completed_at = existing["completed_at"]
    if is_completed and not existing["is_completed"]:
        completed_at = datetime.now().isoformat()
    elif not is_completed:
        completed_at = None

    conn.execute(
        """UPDATE tasks SET title=?, description=?, task_date=?, is_important=?,
           is_urgent=?, is_completed=?, completed_at=? WHERE id=?""",
        (
            data.get("title", existing["title"]),
            data.get("description", existing["description"]),
            data.get("task_date", existing["task_date"]),
            1 if data.get("is_important", existing["is_important"]) else 0,
            1 if data.get("is_urgent", existing["is_urgent"]) else 0,
            1 if is_completed else 0,
            completed_at,
            task_id,
        ),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    recompute_daily_rating(conn, row["task_date"])
    conn.close()
    return jsonify(row_to_dict(row))


@app.route("/api/tasks/<int:task_id>", methods=["DELETE"])
def delete_task(task_id):
    conn = get_connection()
    row = conn.execute("SELECT task_date FROM tasks WHERE id = ?", (task_id,)).fetchone()
    conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    conn.commit()
    if row:
        recompute_daily_rating(conn, row["task_date"])
    conn.close()
    return jsonify({"ok": True})


# ------------------------------------------------------------------ #
# SCHEDULE — weekly time-blocking (Calendly-style grid)
# ------------------------------------------------------------------ #

@app.route("/api/schedule", methods=["GET"])
def get_schedule():
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM schedule_blocks ORDER BY day_of_week, start_hour"
    ).fetchall()
    conn.close()
    return jsonify(rows_to_list(rows))


@app.route("/api/schedule", methods=["POST"])
def create_schedule_block():
    data = request.get_json(force=True)
    conn = get_connection()
    cur = conn.execute(
        """INSERT INTO schedule_blocks (day_of_week, start_hour, end_hour, title, category, recurring, week_start)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            int(data["day_of_week"]),
            int(data["start_hour"]),
            int(data["end_hour"]),
            data.get("title", "Untitled block"),
            data.get("category", "work"),
            1 if data.get("recurring", True) else 0,
            data.get("week_start"),
        ),
    )
    conn.commit()
    row = conn.execute(
        "SELECT * FROM schedule_blocks WHERE id = ?", (cur.lastrowid,)
    ).fetchone()
    conn.close()
    return jsonify(row_to_dict(row))


@app.route("/api/schedule/<int:block_id>", methods=["DELETE"])
def delete_schedule_block(block_id):
    conn = get_connection()
    conn.execute("DELETE FROM schedule_blocks WHERE id = ?", (block_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ------------------------------------------------------------------ #
# RECURRING TASKS — user-declared + auto-detected from history
# ------------------------------------------------------------------ #

@app.route("/api/recurring", methods=["GET"])
def get_recurring():
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM recurring_tasks WHERE is_active = 1 ORDER BY occurrences DESC"
    ).fetchall()
    conn.close()
    return jsonify(rows_to_list(rows))


@app.route("/api/recurring", methods=["POST"])
def add_recurring():
    data = request.get_json(force=True)
    conn = get_connection()
    conn.execute(
        """INSERT INTO recurring_tasks (title, source, occurrences, last_seen_date)
           VALUES (?, 'user', 1, ?)
           ON CONFLICT(title, source) DO UPDATE SET occurrences = occurrences + 1""",
        (data["title"], today_str()),
    )
    conn.commit()
    row = conn.execute(
        "SELECT * FROM recurring_tasks WHERE title = ? AND source = 'user'",
        (data["title"],),
    ).fetchone()
    conn.close()
    return jsonify(row_to_dict(row))


@app.route("/api/recurring/<int:rec_id>", methods=["DELETE"])
def delete_recurring(rec_id):
    conn = get_connection()
    conn.execute("DELETE FROM recurring_tasks WHERE id = ?", (rec_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/recurring/detect", methods=["POST"])
def detect_recurring():
    """
    Scan the last N weeks (default 4) of completed+pending tasks and flag any
    task title that shows up in 2+ distinct weeks as an auto-detected recurring task.
    """
    weeks = int(request.get_json(force=True).get("weeks", 4)) if request.data else 4
    conn = get_connection()
    cutoff = (datetime.now() - timedelta(weeks=weeks)).strftime("%Y-%m-%d")
    rows = conn.execute(
        "SELECT title, task_date FROM tasks WHERE task_date >= ?", (cutoff,)
    ).fetchall()

    title_weeks = defaultdict(set)
    for r in rows:
        monday, _ = week_bounds(r["task_date"])
        title_weeks[r["title"].strip().lower()].add(monday)

    detected = []
    for title, weekset in title_weeks.items():
        if len(weekset) >= 2:
            conn.execute(
                """INSERT INTO recurring_tasks (title, source, occurrences, last_seen_date)
                   VALUES (?, 'auto', ?, ?)
                   ON CONFLICT(title, source) DO UPDATE SET occurrences = ?, last_seen_date = ?""",
                (title, len(weekset), today_str(), len(weekset), today_str()),
            )
            detected.append({"title": title, "weeks_seen": len(weekset)})
    conn.commit()
    conn.close()
    return jsonify(detected)


# ------------------------------------------------------------------ #
# DISTRACTIONS — budget + actual usage
# ------------------------------------------------------------------ #

@app.route("/api/distractions", methods=["GET"])
def get_distractions():
    date = request.args.get("date", today_str())
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM distractions WHERE log_date = ? ORDER BY id", (date,)
    ).fetchall()
    conn.close()
    return jsonify(rows_to_list(rows))


@app.route("/api/distractions", methods=["POST"])
def create_distraction():
    data = request.get_json(force=True)
    date = data.get("log_date", today_str())
    conn = get_connection()
    conn.execute(
        """INSERT INTO distractions (name, log_date, allotted_minutes, used_minutes)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(name, log_date) DO UPDATE SET allotted_minutes = ?""",
        (data["name"], date, int(data.get("allotted_minutes", 30)),
         int(data.get("used_minutes", 0)), int(data.get("allotted_minutes", 30))),
    )
    conn.commit()
    row = conn.execute(
        "SELECT * FROM distractions WHERE name = ? AND log_date = ?", (data["name"], date)
    ).fetchone()
    conn.close()
    return jsonify(row_to_dict(row))


@app.route("/api/distractions/<int:dist_id>", methods=["PUT"])
def update_distraction(dist_id):
    data = request.get_json(force=True)
    conn = get_connection()
    existing = conn.execute("SELECT * FROM distractions WHERE id = ?", (dist_id,)).fetchone()
    if not existing:
        conn.close()
        return jsonify({"error": "not found"}), 404
    conn.execute(
        "UPDATE distractions SET used_minutes = ?, allotted_minutes = ? WHERE id = ?",
        (
            int(data.get("used_minutes", existing["used_minutes"])),
            int(data.get("allotted_minutes", existing["allotted_minutes"])),
            dist_id,
        ),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM distractions WHERE id = ?", (dist_id,)).fetchone()
    conn.close()
    return jsonify(row_to_dict(row))


@app.route("/api/distractions/<int:dist_id>", methods=["DELETE"])
def delete_distraction(dist_id):
    conn = get_connection()
    conn.execute("DELETE FROM distractions WHERE id = ?", (dist_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ------------------------------------------------------------------ #
# NOTES — notebook
# ------------------------------------------------------------------ #

@app.route("/api/notes", methods=["GET"])
def get_notes():
    conn = get_connection()
    rows = conn.execute("SELECT * FROM notes ORDER BY updated_at DESC").fetchall()
    conn.close()
    return jsonify(rows_to_list(rows))


@app.route("/api/notes", methods=["POST"])
def create_note():
    data = request.get_json(force=True)
    conn = get_connection()
    cur = conn.execute(
        "INSERT INTO notes (title, content, tags, linked_date) VALUES (?, ?, ?, ?)",
        (data.get("title", "Untitled"), data.get("content", ""),
         data.get("tags", ""), data.get("linked_date")),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM notes WHERE id = ?", (cur.lastrowid,)).fetchone()
    conn.close()
    return jsonify(row_to_dict(row))


@app.route("/api/notes/<int:note_id>", methods=["PUT"])
def update_note(note_id):
    data = request.get_json(force=True)
    conn = get_connection()
    existing = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    if not existing:
        conn.close()
        return jsonify({"error": "not found"}), 404
    conn.execute(
        """UPDATE notes SET title=?, content=?, tags=?, linked_date=?, updated_at=datetime('now')
           WHERE id=?""",
        (
            data.get("title", existing["title"]),
            data.get("content", existing["content"]),
            data.get("tags", existing["tags"]),
            data.get("linked_date", existing["linked_date"]),
            note_id,
        ),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    conn.close()
    return jsonify(row_to_dict(row))


@app.route("/api/notes/<int:note_id>", methods=["DELETE"])
def delete_note(note_id):
    conn = get_connection()
    conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ------------------------------------------------------------------ #
# RATINGS + DASHBOARD (aggregation for graphs)
# ------------------------------------------------------------------ #

@app.route("/api/rating", methods=["POST"])
def set_rating():
    data = request.get_json(force=True)
    date = data.get("log_date", today_str())
    conn = get_connection()
    recompute_daily_rating(conn, date)
    conn.execute(
        "UPDATE daily_ratings SET rating = ?, notes = ?, updated_at = datetime('now') WHERE log_date = ?",
        (data.get("rating"), data.get("notes", ""), date),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM daily_ratings WHERE log_date = ?", (date,)).fetchone()
    conn.close()
    return jsonify(row_to_dict(row))


@app.route("/api/dashboard/day", methods=["GET"])
def dashboard_day():
    date = request.args.get("date", today_str())
    conn = get_connection()

    tasks = conn.execute("SELECT * FROM tasks WHERE task_date = ?", (date,)).fetchall()
    logs = conn.execute("SELECT * FROM time_logs WHERE log_date = ?", (date,)).fetchall()
    distractions = conn.execute(
        "SELECT * FROM distractions WHERE log_date = ?", (date,)
    ).fetchall()
    rating = conn.execute("SELECT * FROM daily_ratings WHERE log_date = ?", (date,)).fetchone()

    recompute_daily_rating(conn, date)
    rating = conn.execute("SELECT * FROM daily_ratings WHERE log_date = ?", (date,)).fetchone()

    category_minutes = Counter()
    for l in logs:
        category_minutes[l["category"]] += 60

    conn.close()
    return jsonify({
        "date": date,
        "tasks": rows_to_list(tasks),
        "time_logs": rows_to_list(logs),
        "distractions": rows_to_list(distractions),
        "rating": row_to_dict(rating),
        "category_breakdown": dict(category_minutes),
        "hours_logged": len(logs),
    })


@app.route("/api/dashboard/week", methods=["GET"])
def dashboard_week():
    date = request.args.get("date", today_str())
    monday, sunday = week_bounds(date)
    days = date_range(monday, sunday)
    conn = get_connection()

    daily = []
    for d in days:
        recompute_daily_rating(conn, d)
        rating = conn.execute("SELECT * FROM daily_ratings WHERE log_date = ?", (d,)).fetchone()
        hours = conn.execute(
            "SELECT COUNT(*) c FROM time_logs WHERE log_date = ?", (d,)
        ).fetchone()["c"]
        completed = conn.execute(
            "SELECT COUNT(*) c FROM tasks WHERE task_date = ? AND is_completed = 1", (d,)
        ).fetchone()["c"]
        daily.append({
            "date": d,
            "effective_ratio": rating["effective_ratio"] if rating else 0,
            "rating": rating["rating"] if rating else None,
            "hours_logged": hours,
            "tasks_completed": completed,
        })

    schedule = conn.execute(
        "SELECT * FROM schedule_blocks ORDER BY day_of_week, start_hour"
    ).fetchall()

    conn.close()
    return jsonify({
        "week_start": monday,
        "week_end": sunday,
        "daily": daily,
        "schedule": rows_to_list(schedule),
    })


if __name__ == "__main__":
    init_db()
    app.run(debug=True, port=5000)
