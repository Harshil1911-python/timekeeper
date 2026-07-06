/* ==========================================================
   TIMEKEEPER — frontend app logic (vanilla JS, no build step)
   ========================================================== */

const API = "/api";

const state = {
  activeDate: new Date().toISOString().slice(0, 10),
  activeView: "dashboard",
  activeNoteId: null,
  charts: {},
  focus: { seconds: 25 * 60, totalSeconds: 25 * 60, running: false, timer: null },
  calendar: { monthDate: new Date(), selectedDate: new Date().toISOString().slice(0, 10), clipboard: null },
};

function chartsAvailable() {
  return typeof Chart !== "undefined";
}

const CATEGORY_COLORS = {
  work: "#6C8EBF",
  personal: "#4FA69E",
  rest: "#8A93A0",
  learning: "#CC9E4F",
  admin: "#C0603A",
  distraction: "#C0603A",
  uncategorized: "#3A4655",
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/* ---------------- fetch helpers ---------------- */
async function apiGet(path) {
  const res = await fetch(API + path);
  return res.json();
}
async function apiSend(path, method, body) {
  const res = await fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return res.json();
}
const apiPost = (p, b) => apiSend(p, "POST", b);
const apiPut = (p, b) => apiSend(p, "PUT", b);
async function apiDelete(path) {
  const res = await fetch(API + path, { method: "DELETE" });
  return res.json();
}

/* ==========================================================
   NAVIGATION
   ========================================================== */
function initNav() {
  document.querySelectorAll(".switch").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
}

function switchView(view) {
  state.activeView = view;
  document.querySelectorAll(".switch").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + view));

  const dateless = ["schedule", "recurring", "notes", "inbox", "calendar"];
  document.getElementById("dateNav").style.display = dateless.includes(view) ? "none" : "flex";

  loadView(view);
}

function loadView(view) {
  if (view === "dashboard") return loadDashboard();
  if (view === "log") return loadLedger();
  if (view === "inbox") return loadInbox();
  if (view === "habits") return loadHabits();
  if (view === "focus") return loadFocus();
  if (view === "calendar") return loadCalendar();
  if (view === "tasks") return loadTasks();
  if (view === "schedule") return loadSchedule();
  if (view === "recurring") return loadRecurring();
  if (view === "distractions") return loadDistractions();
  if (view === "notes") return loadNotes();
}

/* ==========================================================
   CLOCK + DATE NAV
   ========================================================== */
function tickClock() {
  const now = new Date();
  document.getElementById("railClock").textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  document.getElementById("railDate").textContent = now.toDateString();
}

function initDateNav() {
  const input = document.getElementById("activeDate");
  input.value = state.activeDate;
  input.addEventListener("change", () => {
    state.activeDate = input.value;
    loadView(state.activeView);
  });
  document.getElementById("prevDay").addEventListener("click", () => shiftDate(-1));
  document.getElementById("nextDay").addEventListener("click", () => shiftDate(1));
  document.getElementById("gotoToday").addEventListener("click", () => {
    state.activeDate = new Date().toISOString().slice(0, 10);
    input.value = state.activeDate;
    loadView(state.activeView);
  });
}

function shiftDate(days) {
  const d = new Date(state.activeDate);
  d.setDate(d.getDate() + days);
  state.activeDate = d.toISOString().slice(0, 10);
  document.getElementById("activeDate").value = state.activeDate;
  loadView(state.activeView);
}

/* ==========================================================
   DASHBOARD
   ========================================================== */
async function loadDashboard() {
  const day = await apiGet(`/dashboard/day?date=${state.activeDate}`);
  const week = await apiGet(`/dashboard/week?date=${state.activeDate}`);

  document.getElementById("effRatio").textContent = Math.round((day.rating?.effective_ratio || 0) * 100) + "%";
  document.getElementById("hoursLogged").textContent = day.hours_logged + " / 24";
  document.getElementById("tasksCompleted").textContent = day.tasks.filter((t) => t.is_completed).length;
  document.getElementById("plannedActual").textContent = `${day.hours_logged} / ${day.planned_hours}h`;
  document.getElementById("focusTime").textContent = day.focus_minutes + " min";
  document.getElementById("focusNote").textContent = day.focus_sessions + " session" + (day.focus_sessions === 1 ? "" : "s");
  document.getElementById("habitsDone").textContent = `${day.habits_done} / ${day.habits_total}`;

  const rating = day.rating?.rating;
  document.getElementById("selfRatingDisplay").textContent = rating ? "★".repeat(rating) + "☆".repeat(5 - rating) : "—";
  const ratingNote = document.getElementById("ratingStars");
  ratingNote.textContent = "tap to rate";
  ratingNote.onclick = async () => {
    const val = prompt("Rate today 1-5:", rating || 3);
    if (val && val >= 1 && val <= 5) {
      await apiPost("/rating", { log_date: state.activeDate, rating: parseInt(val) });
      loadDashboard();
    }
  };

  if (chartsAvailable()) {
    renderCategoryChart(day.category_breakdown);
    renderWeekCharts(week.daily);
  } else {
    console.warn("Chart.js did not load — graphs are skipped, everything else still works.");
  }
}

function initExportButton() {
  document.getElementById("exportBtn").addEventListener("click", async () => {
    const data = await apiGet("/export");
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `serenia-timekeeper-export-${state.activeDate}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function renderCategoryChart(breakdown) {
  const ctx = document.getElementById("categoryChart");
  const labels = Object.keys(breakdown);
  const data = Object.values(breakdown);
  if (state.charts.category) state.charts.category.destroy();
  if (!labels.length) {
    ctx.getContext("2d").clearRect(0, 0, ctx.width, ctx.height);
    return;
  }
  state.charts.category = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{ data, backgroundColor: labels.map((l) => CATEGORY_COLORS[l] || "#666") }],
    },
    options: {
      plugins: { legend: { position: "right", labels: { color: cssVar("--text"), font: { family: "IBM Plex Sans" } } } },
    },
  });
}

function renderWeekCharts(daily) {
  const labels = daily.map((d) => DAY_NAMES[new Date(d.date).getDay() === 0 ? 6 : new Date(d.date).getDay() - 1]);
  const textDim = cssVar("--text-dim");
  const text = cssVar("--text");
  const gridColor = cssVar("--line-soft");
  const brass = cssVar("--brass");
  const blue = cssVar("--blue");
  const teal = cssVar("--teal");

  const effCtx = document.getElementById("weekEffChart");
  if (state.charts.eff) state.charts.eff.destroy();
  state.charts.eff = new Chart(effCtx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Effectiveness",
        data: daily.map((d) => Math.round(d.effective_ratio * 100)),
        borderColor: brass,
        backgroundColor: brass + "26",
        tension: 0.3,
        fill: true,
      }],
    },
    options: {
      scales: {
        y: { min: 0, max: 100, ticks: { color: textDim }, grid: { color: gridColor } },
        x: { ticks: { color: textDim }, grid: { display: false } },
      },
      plugins: { legend: { display: false } },
    },
  });

  const hoursCtx = document.getElementById("weekHoursChart");
  if (state.charts.hours) state.charts.hours.destroy();
  state.charts.hours = new Chart(hoursCtx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Hours logged", data: daily.map((d) => d.hours_logged), backgroundColor: blue },
        { label: "Tasks completed", data: daily.map((d) => d.tasks_completed), backgroundColor: teal },
      ],
    },
    options: {
      scales: {
        y: { ticks: { color: textDim }, grid: { color: gridColor } },
        x: { ticks: { color: textDim }, grid: { display: false } },
      },
      plugins: { legend: { labels: { color: text } } },
    },
  });
}

/* ==========================================================
   HOUR LOG (ledger)
   ========================================================== */
async function loadLedger() {
  const logs = await apiGet(`/timelog?date=${state.activeDate}`);
  const byHour = {};
  logs.forEach((l) => (byHour[l.hour] = l));

  const currentHour = state.activeDate === new Date().toISOString().slice(0, 10) ? new Date().getHours() : -1;

  const ledger = document.getElementById("ledger");
  ledger.innerHTML = "";
  for (let h = 0; h < 24; h++) {
    const entry = byHour[h] || { hour: h, activity: "", category: "uncategorized", is_distraction: 0 };
    const row = document.createElement("div");
    row.className = "ledger-row" + (h === currentHour ? " current-hour" : "");
    row.innerHTML = `
      <div class="ledger-hour">${String(h).padStart(2, "0")}:00</div>
      <input class="ledger-activity" placeholder="What happened this hour?" value="${escapeHtml(entry.activity)}">
      <select class="ledger-cat">
        ${Object.keys(CATEGORY_COLORS).filter(c=>c!=='distraction').map((c) => `<option value="${c}" ${c === entry.category ? "selected" : ""}>${c}</option>`).join("")}
      </select>
      <button class="ledger-flag ${entry.is_distraction ? "on" : ""}" title="Mark as distraction">⚡</button>
    `;
    const activityInput = row.querySelector(".ledger-activity");
    const catSelect = row.querySelector(".ledger-cat");
    const flagBtn = row.querySelector(".ledger-flag");

    const save = () =>
      apiPost("/timelog", {
        log_date: state.activeDate,
        hour: h,
        activity: activityInput.value,
        category: catSelect.value,
        is_distraction: flagBtn.classList.contains("on"),
      });

    activityInput.addEventListener("blur", save);
    catSelect.addEventListener("change", save);
    flagBtn.addEventListener("click", () => {
      flagBtn.classList.toggle("on");
      save();
    });

    ledger.appendChild(row);
  }
}

/* ==========================================================
   INBOX — task triage: do / defer / delegate / delete
   ========================================================== */
async function loadInbox() {
  const tasks = await apiGet("/inbox");
  const list = document.getElementById("inboxList");
  list.innerHTML = "";

  if (!tasks.length) {
    list.innerHTML = '<div style="color:#7C8896;font-size:13px;">Inbox is empty — nothing open right now.</div>';
    return;
  }

  tasks.forEach((t) => {
    const item = document.createElement("div");
    item.className = "inbox-item";
    item.innerHTML = `
      <div class="inbox-item-top">
        <span class="inbox-item-title">${escapeHtml(t.title)}</span>
        <span class="inbox-badge badge-date">${t.task_date}</span>
        ${t.is_important ? '<span class="inbox-badge badge-important">Important</span>' : ""}
        ${t.is_urgent ? '<span class="inbox-badge badge-urgent">Urgent</span>' : ""}
        ${t.delegated_to ? `<span class="inbox-badge badge-delegated">→ ${escapeHtml(t.delegated_to)}</span>` : ""}
      </div>
      <div class="inbox-actions">
        <button class="act-do">✓ Do it</button>
        <button class="act-defer">⏭ Defer</button>
        <button class="act-delegate">↪ Delegate</button>
        <button class="act-delete">✕ Delete</button>
      </div>
      <div class="inbox-inline" data-role="defer">
        <input type="date" value="${t.task_date}">
        <button class="btn-primary confirm-defer">Move</button>
      </div>
      <div class="inbox-inline" data-role="delegate">
        <input type="text" placeholder="Delegate to…" value="${t.delegated_to || ""}">
        <button class="btn-primary confirm-delegate">Assign</button>
      </div>
    `;

    item.querySelector(".act-do").addEventListener("click", async () => {
      await apiPut(`/tasks/${t.id}`, { is_completed: true });
      loadInbox();
    });

    item.querySelector(".act-delete").addEventListener("click", async () => {
      await apiDelete(`/tasks/${t.id}`);
      loadInbox();
    });

    const deferPanel = item.querySelector('[data-role="defer"]');
    const delegatePanel = item.querySelector('[data-role="delegate"]');

    item.querySelector(".act-defer").addEventListener("click", () => {
      deferPanel.classList.toggle("open");
      delegatePanel.classList.remove("open");
    });
    item.querySelector(".act-delegate").addEventListener("click", () => {
      delegatePanel.classList.toggle("open");
      deferPanel.classList.remove("open");
    });

    item.querySelector(".confirm-defer").addEventListener("click", async () => {
      const newDate = deferPanel.querySelector("input").value;
      if (!newDate) return;
      await apiPost(`/tasks/${t.id}/defer`, { task_date: newDate });
      loadInbox();
    });
    item.querySelector(".confirm-delegate").addEventListener("click", async () => {
      const to = delegatePanel.querySelector("input").value.trim();
      await apiPost(`/tasks/${t.id}/delegate`, { delegated_to: to });
      loadInbox();
    });

    list.appendChild(item);
  });
}

function initInboxForm() {
  document.getElementById("inboxForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("inboxTitle").value.trim();
    if (!title) return;
    await apiPost("/tasks", { title, task_date: new Date().toISOString().slice(0, 10) });
    document.getElementById("inboxForm").reset();
    loadInbox();
  });
}

/* ==========================================================
   HABIT TRACKER
   ========================================================== */
async function loadHabits() {
  const grid = await apiGet(`/habits/grid?days=7&end_date=${state.activeDate}`);
  const wrap = document.getElementById("habitGrid");
  wrap.innerHTML = "";

  if (!grid.habits.length) {
    wrap.innerHTML = '<div style="color:#7C8896;font-size:13px;">No habits yet — add one above.</div>';
    return;
  }

  const table = document.createElement("div");
  table.className = "habit-table";

  const header = document.createElement("div");
  header.className = "habit-row habit-header";
  header.innerHTML =
    '<div class="habit-name-col">Habit</div>' +
    grid.dates.map((d) => `<div class="habit-day-col">${new Date(d).toLocaleDateString(undefined, { weekday: "short" })}<br><span>${d.slice(5)}</span></div>`).join("") +
    '<div class="habit-streak-col">Streak</div><div class="habit-del-col"></div>';
  table.appendChild(header);

  grid.habits.forEach((h) => {
    const row = document.createElement("div");
    row.className = "habit-row";
    row.innerHTML =
      `<div class="habit-name-col">${escapeHtml(h.name)}</div>` +
      grid.dates.map((d) => `<div class="habit-day-col"><button class="habit-check ${h.checks[d] ? "on" : ""}" data-date="${d}">${h.checks[d] ? "✓" : ""}</button></div>`).join("") +
      `<div class="habit-streak-col">🔥 ${h.streak}</div>` +
      `<div class="habit-del-col"><button class="habit-delete">✕</button></div>`;

    row.querySelectorAll(".habit-check").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await apiPost(`/habits/${h.id}/toggle`, { log_date: btn.dataset.date });
        loadHabits();
      });
    });
    row.querySelector(".habit-delete").addEventListener("click", async () => {
      await apiDelete(`/habits/${h.id}`);
      loadHabits();
    });
    table.appendChild(row);
  });

  wrap.appendChild(table);
}

function initHabitForm() {
  document.getElementById("habitForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("habitName").value.trim();
    if (!name) return;
    const freq = document.getElementById("habitFrequency").value;
    const res = await apiPost("/habits", { name, frequency: freq });
    if (res.error) { alert(res.error); return; }
    document.getElementById("habitForm").reset();
    loadHabits();
  });
}

/* ==========================================================
   FOCUS TIMER (client-side countdown, logs on completion)
   ========================================================== */
function updateFocusDisplay() {
  const m = Math.floor(state.focus.seconds / 60).toString().padStart(2, "0");
  const s = (state.focus.seconds % 60).toString().padStart(2, "0");
  document.getElementById("focusDisplay").textContent = `${m}:${s}`;
}

function initFocusTimer() {
  document.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      clearInterval(state.focus.timer);
      state.focus.running = false;
      const mins = parseInt(btn.dataset.mins);
      state.focus.seconds = mins * 60;
      state.focus.totalSeconds = mins * 60;
      updateFocusDisplay();
    });
  });

  document.getElementById("focusStart").addEventListener("click", () => {
    if (state.focus.running) return;
    state.focus.running = true;
    state.focus.timer = setInterval(async () => {
      state.focus.seconds -= 1;
      updateFocusDisplay();
      if (state.focus.seconds <= 0) {
        clearInterval(state.focus.timer);
        state.focus.running = false;
        const minutes = Math.round(state.focus.totalSeconds / 60);
        const label = document.getElementById("focusLabel").value.trim();
        await apiPost("/focus", { log_date: state.activeDate, minutes, label });
        state.focus.seconds = state.focus.totalSeconds;
        updateFocusDisplay();
        loadFocus();
        if (state.activeView === "dashboard") loadDashboard();
      }
    }, 1000);
  });

  document.getElementById("focusPause").addEventListener("click", () => {
    clearInterval(state.focus.timer);
    state.focus.running = false;
  });

  document.getElementById("focusReset").addEventListener("click", () => {
    clearInterval(state.focus.timer);
    state.focus.running = false;
    state.focus.seconds = state.focus.totalSeconds;
    updateFocusDisplay();
  });

  updateFocusDisplay();
}

async function loadFocus() {
  const data = await apiGet(`/focus?date=${state.activeDate}`);
  document.getElementById("focusTotalToday").textContent = `${data.total_minutes} min logged across ${data.sessions.length} session(s)`;
  const list = document.getElementById("focusSessionsList");
  list.innerHTML = data.sessions
    .map((s) => `<div class="focus-session-row"><span>${s.label || "Focus session"}</span><span>${s.minutes} min</span></div>`)
    .join("") || '<div style="color:#7C8896;font-size:12.5px;">No sessions logged yet today.</div>';
}

/* ==========================================================
   THEME (dark / light)
   ========================================================== */
function applyTheme(theme) {
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
    document.getElementById("themeIcon").textContent = "☀";
    document.getElementById("themeLabel").textContent = "Light";
  } else {
    document.documentElement.removeAttribute("data-theme");
    document.getElementById("themeIcon").textContent = "☾";
    document.getElementById("themeLabel").textContent = "Dark";
  }
  localStorage.setItem("serenia-theme", theme);
}

function initTheme() {
  const saved = localStorage.getItem("serenia-theme") || "dark";
  applyTheme(saved);
  document.getElementById("themeToggle").addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    applyTheme(current === "light" ? "dark" : "light");
    if (state.activeView === "dashboard") loadDashboard(); // charts need re-render with new colors
  });
}

/* ==========================================================
   MONTHLY CALENDAR
   ========================================================== */
function monthMatrix(monthDate) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = (firstOfMonth.getDay() + 6) % 7; // Monday=0
  const gridStart = new Date(year, month, 1 - startOffset);
  const days = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    days.push(d);
  }
  return days;
}

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

async function loadCalendar() {
  const monthDate = state.calendar.monthDate;
  document.getElementById("calMonthLabel").textContent = monthDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const days = monthMatrix(monthDate);
  const rangeStart = toDateStr(days[0]);
  const rangeEnd = toDateStr(days[days.length - 1]);
  const tasks = await apiGet(`/tasks?start=${rangeStart}&end=${rangeEnd}`);

  const tasksByDate = {};
  tasks.forEach((t) => {
    (tasksByDate[t.task_date] = tasksByDate[t.task_date] || []).push(t);
  });

  const todayStr = new Date().toISOString().slice(0, 10);
  const grid = document.getElementById("calGrid");
  grid.innerHTML = "";

  days.forEach((d) => {
    const dateStr = toDateStr(d);
    const inMonth = d.getMonth() === monthDate.getMonth();
    const dayTasks = tasksByDate[dateStr] || [];

    const cell = document.createElement("div");
    cell.className = "cal-day" +
      (inMonth ? "" : " other-month") +
      (dateStr === todayStr ? " is-today" : "") +
      (dateStr === state.calendar.selectedDate ? " is-selected" : "");

    const dots = dayTasks.slice(0, 6).map((t) => {
      let cls = "";
      if (t.is_important && t.is_urgent) cls = "important-urgent";
      else if (t.is_important) cls = "important";
      else if (t.is_urgent) cls = "urgent";
      return `<span class="cal-dot ${cls}"></span>`;
    }).join("");

    cell.innerHTML = `
      <div class="cal-day-num">${d.getDate()}</div>
      <div class="cal-day-dots">${dots}</div>
      ${dayTasks.length > 6 ? `<div class="cal-more">+${dayTasks.length - 6} more</div>` : ""}
    `;
    cell.addEventListener("click", () => {
      state.calendar.selectedDate = dateStr;
      loadCalendar();
    });
    grid.appendChild(cell);
  });

  renderCalDayPanel(tasksByDate[state.calendar.selectedDate] || []);
}

function renderCalDayPanel(dayTasks) {
  const sel = state.calendar.selectedDate;
  document.getElementById("calSelectedLabel").textContent = new Date(sel + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  const clip = state.calendar.clipboard;
  const pasteBtn = document.getElementById("calPasteBtn");
  const note = document.getElementById("calClipboardNote");
  if (clip && clip !== sel) {
    pasteBtn.disabled = false;
    note.textContent = `Clipboard: tasks copied from ${clip}`;
  } else {
    pasteBtn.disabled = true;
    note.textContent = clip === sel ? "Clipboard has this same day — pick a different day to paste into." : "";
  }

  const list = document.getElementById("calDayTasks");
  list.innerHTML = "";
  if (!dayTasks.length) {
    list.innerHTML = '<div style="color:#7C8896;font-size:13px;">No tasks on this day.</div>';
    return;
  }
  dayTasks.forEach((t) => {
    const el = document.createElement("div");
    el.className = "task-item" + (t.is_completed ? " completed" : "");
    el.innerHTML = `
      <input type="checkbox" ${t.is_completed ? "checked" : ""}>
      <span class="task-item-title">${escapeHtml(t.title)}</span>
      <button title="Delete">✕</button>
    `;
    el.querySelector("input").addEventListener("change", async (e) => {
      await apiPut(`/tasks/${t.id}`, { is_completed: e.target.checked });
      loadCalendar();
    });
    el.querySelector("button").addEventListener("click", async () => {
      await apiDelete(`/tasks/${t.id}`);
      loadCalendar();
    });
    list.appendChild(el);
  });
}

function initCalendar() {
  document.getElementById("calPrevMonth").addEventListener("click", () => {
    state.calendar.monthDate = new Date(state.calendar.monthDate.getFullYear(), state.calendar.monthDate.getMonth() - 1, 1);
    loadCalendar();
  });
  document.getElementById("calNextMonth").addEventListener("click", () => {
    state.calendar.monthDate = new Date(state.calendar.monthDate.getFullYear(), state.calendar.monthDate.getMonth() + 1, 1);
    loadCalendar();
  });
  document.getElementById("calGotoToday").addEventListener("click", () => {
    state.calendar.monthDate = new Date();
    state.calendar.selectedDate = new Date().toISOString().slice(0, 10);
    loadCalendar();
  });

  document.getElementById("calCopyBtn").addEventListener("click", () => {
    state.calendar.clipboard = state.calendar.selectedDate;
    loadCalendar();
  });
  document.getElementById("calPasteBtn").addEventListener("click", async () => {
    if (!state.calendar.clipboard) return;
    const res = await apiPost("/tasks/copy-day", {
      from_date: state.calendar.clipboard,
      to_date: state.calendar.selectedDate,
    });
    state.calendar.clipboard = null;
    loadCalendar();
  });

  document.getElementById("calTaskForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("calTaskTitle").value.trim();
    if (!title) return;
    await apiPost("/tasks", {
      title,
      task_date: state.calendar.selectedDate,
      is_important: document.getElementById("calTaskImportant").checked,
      is_urgent: document.getElementById("calTaskUrgent").checked,
    });
    document.getElementById("calTaskForm").reset();
    loadCalendar();
  });
}

/* ==========================================================
   TASKS + Eisenhower matrix
   ========================================================== */
async function loadTasks() {
  const tasks = await apiGet(`/tasks?date=${state.activeDate}`);
  ["both", "important", "urgent", "neither"].forEach((q) => (document.getElementById("quad-" + q).innerHTML = ""));

  tasks.forEach((t) => {
    let quad = "neither";
    if (t.is_important && t.is_urgent) quad = "both";
    else if (t.is_important) quad = "important";
    else if (t.is_urgent) quad = "urgent";

    const el = document.createElement("div");
    el.className = "task-item" + (t.is_completed ? " completed" : "");
    el.innerHTML = `
      <input type="checkbox" ${t.is_completed ? "checked" : ""}>
      <span class="task-item-title">${escapeHtml(t.title)}</span>
      <button title="Delete">✕</button>
    `;
    el.querySelector("input").addEventListener("change", async (e) => {
      await apiPut(`/tasks/${t.id}`, { is_completed: e.target.checked });
      loadTasks();
      if (state.activeView === "dashboard") loadDashboard();
    });
    el.querySelector("button").addEventListener("click", async () => {
      await apiDelete(`/tasks/${t.id}`);
      loadTasks();
    });
    document.getElementById("quad-" + quad).appendChild(el);
  });
}

function initTaskForm() {
  document.getElementById("taskForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("taskTitle").value.trim();
    if (!title) return;
    await apiPost("/tasks", {
      title,
      task_date: state.activeDate,
      is_important: document.getElementById("taskImportant").checked,
      is_urgent: document.getElementById("taskUrgent").checked,
    });
    document.getElementById("taskForm").reset();
    loadTasks();
  });
}

/* ==========================================================
   SCHEDULE (weekly grid)
   ========================================================== */
async function loadSchedule() {
  const blocks = await apiGet("/schedule");
  const grid = document.getElementById("schedGrid");
  grid.innerHTML = "";

  grid.appendChild(document.createElement("div")); // corner spacer
  DAY_NAMES.forEach((d) => {
    const label = document.createElement("div");
    label.className = "sched-daylabel";
    label.textContent = d;
    grid.appendChild(label);
  });

  const blockMap = {};
  blocks.forEach((b) => (blockMap[`${b.day_of_week}-${b.start_hour}`] = b));

  for (let h = 0; h < 24; h++) {
    const hourLabel = document.createElement("div");
    hourLabel.className = "sched-hourlabel";
    hourLabel.textContent = String(h).padStart(2, "0") + ":00";
    grid.appendChild(hourLabel);

    for (let d = 0; d < 7; d++) {
      const cell = document.createElement("div");
      cell.className = "sched-cell";
      const existing = blockMap[`${d}-${h}`];
      if (existing) {
        cell.classList.add("filled", "cat-" + existing.category);
        cell.textContent = existing.title;
        cell.dataset.blockId = existing.id;
      }
      cell.addEventListener("click", () => handleCellClick(cell, d, h, existing));
      grid.appendChild(cell);
    }
  }
}

async function handleCellClick(cell, day, hour, existing) {
  if (existing) {
    await apiDelete(`/schedule/${existing.id}`);
    loadSchedule();
    return;
  }
  const title = document.getElementById("blockTitle").value.trim();
  if (!title) {
    alert("Type a block name first, then click a cell to place it.");
    return;
  }
  const category = document.getElementById("blockCategory").value;
  await apiPost("/schedule", { day_of_week: day, start_hour: hour, end_hour: hour + 1, title, category });
  loadSchedule();
}

/* ==========================================================
   RECURRING TASKS
   ========================================================== */
async function loadRecurring() {
  const items = await apiGet("/recurring");
  const userList = document.getElementById("recUser");
  const autoList = document.getElementById("recAuto");
  userList.innerHTML = "";
  autoList.innerHTML = "";

  items.forEach((r) => {
    const el = document.createElement("div");
    el.className = "rec-item";
    el.innerHTML = `<span>${escapeHtml(r.title)}</span><span class="count">${r.occurrences}× — <button style="background:none;border:none;color:#C0603A;cursor:pointer;">remove</button></span>`;
    el.querySelector("button").addEventListener("click", async () => {
      await apiDelete(`/recurring/${r.id}`);
      loadRecurring();
    });
    (r.source === "user" ? userList : autoList).appendChild(el);
  });

  if (!items.filter((r) => r.source === "auto").length) {
    autoList.innerHTML = '<div style="color:#7C8896;font-size:12.5px;">Nothing detected yet — click "Scan past weeks".</div>';
  }
}

function initRecurringForm() {
  document.getElementById("recurringForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("recurringTitle").value.trim();
    if (!title) return;
    await apiPost("/recurring", { title });
    document.getElementById("recurringForm").reset();
    loadRecurring();
  });
  document.getElementById("detectBtn").addEventListener("click", async () => {
    await apiPost("/recurring/detect", { weeks: 4 });
    loadRecurring();
  });
}

/* ==========================================================
   DISTRACTIONS
   ========================================================== */
async function loadDistractions() {
  const items = await apiGet(`/distractions?date=${state.activeDate}`);
  const list = document.getElementById("distList");
  list.innerHTML = "";
  if (!items.length) {
    list.innerHTML = '<div style="color:#7C8896;font-size:13px;">No distractions budgeted for this day yet.</div>';
    return;
  }
  items.forEach((d) => {
    const pct = Math.min(100, Math.round((d.used_minutes / d.allotted_minutes) * 100));
    const over = d.used_minutes > d.allotted_minutes;
    const card = document.createElement("div");
    card.className = "dist-card";
    card.innerHTML = `
      <div class="dist-top">
        <span class="dist-name">${escapeHtml(d.name)}</span>
        <span class="dist-fig">${d.used_minutes} / ${d.allotted_minutes} min</span>
      </div>
      <div class="dist-bar-track"><div class="dist-bar-fill ${over ? "over" : ""}" style="width:${pct}%"></div></div>
      <div class="dist-controls">
        <button data-delta="5">+5 min used</button>
        <button data-delta="15">+15 min used</button>
        <button data-delta="reset">Reset used</button>
        <button data-delta="delete" style="border-color:#6E3B27;color:#C0603A;">Delete</button>
      </div>
    `;
    card.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const delta = btn.dataset.delta;
        if (delta === "delete") {
          await apiDelete(`/distractions/${d.id}`);
        } else if (delta === "reset") {
          await apiPut(`/distractions/${d.id}`, { used_minutes: 0 });
        } else {
          await apiPut(`/distractions/${d.id}`, { used_minutes: d.used_minutes + parseInt(delta) });
        }
        loadDistractions();
      });
    });
    list.appendChild(card);
  });
}

function initDistractionForm() {
  document.getElementById("distractionForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("distName").value.trim();
    const allotted = parseInt(document.getElementById("distAllotted").value);
    if (!name || !allotted) return;
    await apiPost("/distractions", { name, allotted_minutes: allotted, log_date: state.activeDate });
    document.getElementById("distractionForm").reset();
    document.getElementById("distAllotted").value = 30;
    loadDistractions();
  });
}

/* ==========================================================
   NOTEBOOK
   ========================================================== */
async function loadNotes() {
  const notes = await apiGet("/notes");
  const list = document.getElementById("noteList");
  list.querySelectorAll(".note-card").forEach((n) => n.remove());

  notes.forEach((n) => {
    const card = document.createElement("div");
    card.className = "note-card" + (n.id === state.activeNoteId ? " active" : "");
    card.innerHTML = `<div class="note-card-title">${escapeHtml(n.title || "Untitled")}</div><div class="note-card-tags">${escapeHtml(n.tags || "")}</div>`;
    card.addEventListener("click", () => openNote(n));
    list.appendChild(card);
  });

  if (!state.activeNoteId && notes.length) openNote(notes[0]);
  if (!notes.length) clearNoteEditor();
}

function openNote(note) {
  state.activeNoteId = note.id;
  document.getElementById("noteTitle").value = note.title;
  document.getElementById("noteTags").value = note.tags;
  document.getElementById("noteContent").value = note.content;
  document.querySelectorAll(".note-card").forEach((c) => c.classList.remove("active"));
  loadNotes();
}

function clearNoteEditor() {
  state.activeNoteId = null;
  document.getElementById("noteTitle").value = "";
  document.getElementById("noteTags").value = "";
  document.getElementById("noteContent").value = "";
}

function initNotebook() {
  document.getElementById("newNoteBtn").addEventListener("click", async () => {
    const note = await apiPost("/notes", { title: "Untitled", content: "", tags: "" });
    state.activeNoteId = note.id;
    loadNotes();
    openNote(note);
  });
  document.getElementById("saveNoteBtn").addEventListener("click", async () => {
    if (!state.activeNoteId) {
      const note = await apiPost("/notes", {
        title: document.getElementById("noteTitle").value || "Untitled",
        content: document.getElementById("noteContent").value,
        tags: document.getElementById("noteTags").value,
      });
      state.activeNoteId = note.id;
    } else {
      await apiPut(`/notes/${state.activeNoteId}`, {
        title: document.getElementById("noteTitle").value || "Untitled",
        content: document.getElementById("noteContent").value,
        tags: document.getElementById("noteTags").value,
      });
    }
    loadNotes();
  });
  document.getElementById("deleteNoteBtn").addEventListener("click", async () => {
    if (!state.activeNoteId) return;
    await apiDelete(`/notes/${state.activeNoteId}`);
    clearNoteEditor();
    loadNotes();
  });
}

/* ==========================================================
   UTIL
   ========================================================== */
function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ==========================================================
   BOOT
   ========================================================== */
document.addEventListener("DOMContentLoaded", () => {
  initNav();
  initDateNav();
  initTheme();
  initCalendar();
  initInboxForm();
  initTaskForm();
  initRecurringForm();
  initDistractionForm();
  initNotebook();
  initHabitForm();
  initFocusTimer();
  initExportButton();
  tickClock();
  setInterval(tickClock, 30000);
  loadDashboard();
});
