# Serenia Timekeeper

A personal time-management logbook: hour-by-hour time tracking, a task
Inbox for triaging what to do/defer/delegate/delete, an Important/Urgent
task matrix with an auto-computed effectiveness ratio, a Calendly-style
weekly schedule grid, recurring-task detection, a distraction budget
tracker, performance graphs, and a synced notebook — all backed by one
SQLite database.

## Structure

```
timekeeper/
├── requirements.txt
├── database/
│   └── schema.sql          # SQLite schema (tables created on first run)
├── backend/
│   ├── app.py              # Flask app + all REST API routes
│   └── db.py               # SQLite connection + schema bootstrap
└── frontend/
    ├── index.html
    ├── css/style.css
    └── js/app.js
```

## Run it

```bash
cd timekeeper
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
cd backend
python app.py
```

Then open **http://localhost:5000** in your browser. The database file
`database/timekeeper.db` is created automatically on first run — nothing
else to configure.

## How the pieces connect

- **Inbox** — every open task, from every date, in one triage list.
  Capture a task quickly, then for each one: **Do it** (marks complete),
  **Defer** (move it to a different day), **Delegate** (assign it to
  someone by name — it stays in the inbox tagged with who it's with),
  or **Delete**. Deferring or completing a task automatically
  recomputes the effectiveness ratio for both the old and new date.
- **Hour Log** — log what you did each hour of the day (activity + category
  + optional "distraction" flag). This is the raw ledger everything else
  reads from.
- **Tasks** — add tasks and flag them Important / Urgent. Completing an
  important-and-urgent task feeds the day's **effectiveness ratio**
  (important&urgent completed ÷ all completed), shown on the Dashboard.
- **Schedule** — click a cell in the weekly grid to block that hour for a
  named activity; click again to clear it. Recurring by default.
- **Recurring** — add tasks you know repeat, or hit "Scan past weeks" to
  have the backend flag any task title that showed up in 2+ of the last
  4 weeks.
- **Distractions** — set a daily minute budget per distraction and log
  usage against it; the bar goes red once you're over budget.
- **Notebook** — freeform notes, independent of date, always available.
- **Dashboard** — pulls from all of the above: today's category
  breakdown, effectiveness over the last 7 days, hours logged vs. tasks
  completed, and a tap-to-set 1–5 self rating.

Everything is read from and written to the same SQLite database, so
changes in any view show up wherever else they're relevant (e.g.
completing a task on the Tasks screen updates the Dashboard's
effectiveness ratio immediately).

## Deploying on Render

**Build command:**
```
pip install -r requirements.txt
```

**Start command:**
```
gunicorn --chdir backend app:app --bind 0.0.0.0:$PORT
```

**Persisting your data.** Render's filesystem resets on every deploy/restart
unless you attach a **Render Disk**. Without one, `database/timekeeper.db`
gets wiped each time you redeploy. To persist it:
1. In the Render dashboard, add a Disk to the service (e.g. mount path `/var/data`).
2. Set an environment variable `DB_PATH=/var/data/timekeeper.db`.
   `backend/db.py` reads this env var automatically and falls back to the
   local `database/timekeeper.db` path if it isn't set.

**Cold starts.** On Render's free tier, the service spins down after ~15
minutes of inactivity and takes a few seconds to wake back up on the next
request. That's a platform limit, not a bug in the app — if you need the
app to always respond instantly, that requires an always-on (paid) instance.

## Notes on scope

This is a self-contained single-user local app — no auth, no multi-user
support, no external services. It's meant to be run on your own machine
(`localhost`) or deployed as above. If you want to extend it (user
accounts, cloud sync, mobile notifications for distraction limits, etc.)
the Flask API in `backend/app.py` is a reasonable place to start.
