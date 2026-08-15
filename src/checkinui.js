/* ── The check-in screen ─────────────────────────────────────────────
   Reads the 45 chips into an answer set and saves it.

   Two rules from the brief shape everything here:

   1. A check-in is always about TODAY and can never be backfilled, so the
      header button ignores whichever date the daily view is showing.
   2. Saving is final. There is no edit path, so the save is the one moment
      that matters — which is why it goes through the outbox rather than
      depending on the network being up. */
import { DateTime } from "luxon";
import { buildCheckIn, saveCheckIn, fetchCheckIn } from "./checkin.js";
import { pendingFor } from "./outbox.js";
import { showScreen } from "./screens.js";

const $ = (id) => document.getElementById(id);
const MULTI = new Set(["emotion", "body"]);

let screen, form, savedRow;
let ctx = null;          // supplied by main.js: account, location, natal, profileRow
let todaysCheckIn = null;

const todayISO = () =>
  DateTime.now().setZone(ctx.location().timezone).toISODate();

/* ── chips ─────────────────────────────────────────────────────────── */

/* Not every option is a `.chip`. Energy is an ordinal ladder of `.rung`
   buttons with `fluctuating` set apart as an off-scale chip, so selecting
   on the data attributes is what actually covers all 45 options — keying
   on `.chip` silently loses five of the six energy values. */
function chipsFor(field) {
  return [...screen.querySelectorAll(`[data-value][data-field="${field}"]`)];
}

function selected(field) {
  return chipsFor(field)
    .filter((c) => c.getAttribute("aria-pressed") === "true")
    .map((c) => c.dataset.value);
}

function wireChips() {
  for (const chip of screen.querySelectorAll("[data-value][data-field]")) {
    chip.addEventListener("click", () => {
      const field = chip.dataset.field;
      const on = chip.getAttribute("aria-pressed") === "true";
      if (!MULTI.has(field)) {
        // Single-select: energy and focus are scalars in the schema, and
        // the column type is what enforces that. Clear the rest.
        for (const other of chipsFor(field)) {
          other.setAttribute("aria-pressed", "false");
          other.classList.remove("is-active");
        }
      }
      chip.setAttribute("aria-pressed", String(!on));
      chip.classList.toggle("is-active", !on);
    });
  }
}

function readAnswers() {
  return {
    emotions: selected("emotion"),
    body: selected("body"),
    // Scalars: the schema stores one value or null, never an array.
    energy: selected("energy")[0] || null,
    focus: selected("focus")[0] || null,
    journal: $("journal").value.trim() || null,
  };
}

function paint(row) {
  for (const chip of screen.querySelectorAll("[data-value][data-field]")) {
    const field = chip.dataset.field;
    const v = chip.dataset.value;
    const on = field === "emotion" ? (row.emotions || []).includes(v)
      : field === "body" ? (row.body || []).includes(v)
      : field === "energy" ? row.energy === v
      : row.focus === v;
    chip.setAttribute("aria-pressed", String(on));
    chip.classList.toggle("is-active", on);
  }
  $("journal").value = row.journal_text || "";
}

/* Read-only once saved: a check-in is written once and never revised, so
   the controls stop being controls rather than merely looking inert. */
function lock(row) {
  todaysCheckIn = row;
  paint(row);
  for (const el of screen.querySelectorAll("[data-value][data-field], #journal")) {
    el.disabled = true;
  }
  form.querySelector('button[type="submit"]').hidden = true;
  if (savedRow) savedRow.hidden = false;
}

function unlock() {
  todaysCheckIn = null;
  for (const el of screen.querySelectorAll("[data-value][data-field], #journal")) {
    el.disabled = false;
  }
  form.querySelector('button[type="submit"]').hidden = false;
  if (savedRow) savedRow.hidden = true;
}

/* ── header button ─────────────────────────────────────────────────── */

export function refreshHeaderButton() {
  const btn = document.querySelector('[data-action="open-checkin"]');
  if (!btn) return;
  const done = Boolean(todaysCheckIn);
  btn.textContent = done ? "Checked in ✓" : "Check-in";
  btn.classList.toggle("btn-primary", !done);
  btn.classList.toggle("btn-ghost", done);
}

/* ── screen ────────────────────────────────────────────────────────── */

export async function openCheckIn() {
  const date = todayISO();
  const title = screen.querySelector(".display-title");
  if (title) {
    title.textContent = "Daily check-in — " +
      DateTime.fromISO(date).toFormat("cccc, LLLL d");
  }

  // The outbox copy is authoritative for "already done today": it exists
  // even when the row hasn't reached Postgres yet.
  const queued = pendingFor(date);
  const row = queued ? queued.row : await fetchCheckIn(ctx.account().id, date);
  if (row) lock(row); else unlock();

  showScreen("screen-checkin");
}

async function onSubmit(e) {
  e.preventDefault();
  if (todaysCheckIn) return;                 // already saved; nothing to do

  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = "Saving…";

  try {
    const row = buildCheckIn({
      userId: ctx.account().id,
      answers: readAnswers(),
      location: ctx.location(),
      natal: ctx.natal(),
      profileRow: ctx.profileRow(),
      engineReady: ctx.engineReady(),
    });
    const { synced } = await saveCheckIn(row);
    lock(row);
    refreshHeaderButton();

    /* The check-in is safe either way — it's in the outbox. Say so plainly
       when it hasn't reached the server yet, rather than implying failure. */
    const note = screen.querySelector(".saved-title");
    if (note) {
      note.textContent = synced
        ? "Saved"
        : "Saved on this device — it will sync when you're back online";
    }
  } catch (err) {
    console.error(err);
    submit.disabled = false;
    submit.textContent = "Save check-in";
    return;
  }
  submit.disabled = false;
  submit.textContent = "Save check-in";
}

/* `context` gives this module live access to state owned by main.js
   without importing it and creating a cycle. */
export async function initCheckIn(context) {
  ctx = context;
  screen = $("screen-checkin");
  if (!screen) return;
  form = screen.querySelector("form.checkin-form");
  savedRow = screen.querySelector(".saved-row");
  if (savedRow) savedRow.hidden = true;

  wireChips();
  form.addEventListener("submit", onSubmit);

  for (const btn of document.querySelectorAll('[data-action="open-checkin"]')) {
    btn.addEventListener("click", () => openCheckIn());
  }
  for (const btn of document.querySelectorAll('[data-action="open-daily"]')) {
    btn.addEventListener("click", () => showScreen("screen-daily"));
  }

  await syncTodayState();
}

/* Whether today is already done — drives the header button on load. */
export async function syncTodayState() {
  if (!ctx || !ctx.account()) return;
  const date = todayISO();
  const queued = pendingFor(date);
  todaysCheckIn = queued ? queued.row : await fetchCheckIn(ctx.account().id, date);
  refreshHeaderButton();
  return todaysCheckIn;
}
