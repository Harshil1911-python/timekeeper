/* ==========================================================
   TIMEKEEPER — frontend app logic (vanilla JS, no build step)
   ========================================================== */

const API = "/api";

const state = {
  activeDate: new Date().toISOString().slice(0, 10),
  activeView: "dashboard",
  activeNoteId: null,
  charts: {},
};

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

  const dateless = ["schedule", "recurring", "notes"];
  document.getElementById("dateNav").style.display = dateless.includes(view) ? "none" : "flex";

  loadView(view);
}

function loadView(view) {
  if (view === "dashboard") return loadDashboard();
  if (view === "log") return loadLedger();
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

  renderCategoryChart(day.category_breakdown);
  renderWeekCharts(week.daily);
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
      plugins: { legend: { position: "right", labels: { color: "#C7CDD6", font: { family: "IBM Plex Sans" } } } },
    },
  });
}

function renderWeekCharts(daily) {
  const labels = daily.map((d) => DAY_NAMES[new Date(d.date).getDay() === 0 ? 6 : new Date(d.date).getDay() - 1]);

  const effCtx = document.getElementById("weekEffChart");
  if (state.charts.eff) state.charts.eff.destroy();
  state.charts.eff = new Chart(effCtx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Effectiveness",
        data: daily.map((d) => Math.round(d.effective_ratio * 100)),
        borderColor: "#CC9E4F",
        backgroundColor: "rgba(204,158,79,0.15)",
        tension: 0.3,
        fill: true,
      }],
    },
    options: {
      scales: {
        y: { min: 0, max: 100, ticks: { color: "#7C8896" }, grid: { color: "#232E3A" } },
        x: { ticks: { color: "#7C8896" }, grid: { display: false } },
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
        { label: "Hours logged", data: daily.map((d) => d.hours_logged), backgroundColor: "#6C8EBF" },
        { label: "Tasks completed", data: daily.map((d) => d.tasks_completed), backgroundColor: "#4FA69E" },
      ],
    },
    options: {
      scales: {
        y: { ticks: { color: "#7C8896" }, grid: { color: "#232E3A" } },
        x: { ticks: { color: "#7C8896" }, grid: { display: false } },
      },
      plugins: { legend: { labels: { color: "#C7CDD6" } } },
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
  initTaskForm();
  initRecurringForm();
  initDistractionForm();
  initNotebook();
  tickClock();
  setInterval(tickClock, 30000);
  loadDashboard();
});
