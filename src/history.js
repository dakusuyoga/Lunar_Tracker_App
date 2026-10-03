/* ── History calendar ────────────────────────────────────────────────
   A month grid marking the days that have something recorded. Two
   markers, deliberately in the same visual family:

     · gold dot            a check-in that day
     · halo around the dot a ritual completed for that lunation

   The halo sits around the dot rather than beside it because the two
   aren't alternatives — a lunation day can be both. A ritual with no
   check-in shows the halo alone.

   Check-ins are keyed by local calendar day; ritual completions by the
   lunation's UTC date. Those are different things, so they're fetched
   separately and merged onto the grid rather than assumed to line up. */
import { DateTime } from "luxon";
import { supabase } from "./supabase.js";

let cursor = null;      // first day of the month on screen
let onPick = null;
let userId = null;
let tz = "UTC";

const iso = (dt) => dt.toISODate();

async function fetchMarks(firstISO, lastISO) {
  if (!supabase) return { checkIns: new Set(), rituals: new Set() };
  /* The two tables key days differently on purpose: `checkin_date` is a
     civil day in somebody's timezone, `event_date` identifies a lunation
     in UTC. About a quarter of lunations fall on a different local day
     than their UTC date, so placing a halo by `event_date` would mark a
     day the user did nothing and leave the day they did it bare.

     The grid is a view of the user's lived days, so rituals are placed by
     converting `event_utc` through the timezone frozen on the row — where
     they were when it happened, not where they are now. Widened by a day
     either side so a lunation at the edge of the month isn't missed. */
  const pad = (iso, days) =>
    DateTime.fromISO(iso).plus({ days }).toISODate();

  const [ci, rc] = await Promise.all([
    supabase.from("check_ins").select("checkin_date")
      .eq("user_id", userId).gte("checkin_date", firstISO).lte("checkin_date", lastISO),
    supabase.from("ritual_completions").select("event_utc, event_date, display_tz")
      .eq("user_id", userId)
      .gte("event_date", pad(firstISO, -1)).lte("event_date", pad(lastISO, 1)),
  ]);
  if (ci.error) console.warn("history: check-ins", ci.error);
  if (rc.error) console.warn("history: rituals", rc.error);

  const rituals = new Set();
  for (const r of rc.data || []) {
    // Rows written before display_tz existed fall back to the current
    // zone; that is the best available answer, not a correct one.
    const zone = r.display_tz || tz;
    rituals.add(DateTime.fromISO(r.event_utc).setZone(zone).toISODate());
  }

  return {
    checkIns: new Set((ci.data || []).map((r) => r.checkin_date)),
    rituals,
  };
}

function draw(marks) {
  const dialog = document.getElementById("dialog-history");
  const grid = dialog.querySelector(".calendar");
  const title = dialog.querySelector(".dialog-title");
  if (!grid) return;

  title.textContent = cursor.toFormat("LLLL yyyy");

  const today = DateTime.now().setZone(tz).startOf("day");
  const first = cursor.startOf("month");
  const days = cursor.daysInMonth;

  const out = ["S", "M", "T", "W", "T", "F", "S"]
    .map((d) => `<span class="cal-dow">${d}</span>`);

  // Luxon weekday: 1 = Monday … 7 = Sunday; the grid starts on Sunday.
  const pad = first.weekday % 7;
  for (let i = 0; i < pad; i++) out.push(`<span class="cal-pad"></span>`);

  for (let d = 1; d <= days; d++) {
    const day = first.set({ day: d });
    const key = iso(day);
    const cls = ["cal-day"];
    if (marks.checkIns.has(key)) cls.push("has-record");
    if (marks.rituals.has(key)) cls.push("has-ritual");
    if (key === iso(today)) cls.push("is-today");
    const future = day > today;
    if (future) cls.push("is-future");
    out.push(
      `<button type="button" class="${cls.join(" ")}" data-date="${key}"` +
      `${future ? " disabled" : ""}>${d}<span class="dot"></span></button>`
    );
  }
  grid.innerHTML = out.join("");

  const empty = marks.checkIns.size === 0 && marks.rituals.size === 0;
  let note = dialog.querySelector(".cal-empty");
  if (!note) {
    note = document.createElement("p");
    note.className = "cal-empty hint";
    grid.insertAdjacentElement("afterend", note);
  }
  note.textContent = "No check-ins this month.";
  note.hidden = !empty;
}

async function refresh() {
  const first = cursor.startOf("month");
  const last = cursor.endOf("month");
  draw({ checkIns: new Set(), rituals: new Set() });   // draw immediately
  const marks = await fetchMarks(iso(first), iso(last));
  draw(marks);                                          // then fill in
}

export function initHistory(ctx) {
  const dialog = document.getElementById("dialog-history");
  if (!dialog) return;
  userId = ctx.userId;
  tz = ctx.timezone;
  onPick = ctx.onPick;

  dialog.addEventListener("click", async (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "prev-month") { cursor = cursor.minus({ months: 1 }); await refresh(); return; }
    if (action === "next-month") { cursor = cursor.plus({ months: 1 }); await refresh(); return; }
    if (action === "this-month") {
      cursor = DateTime.now().setZone(tz).startOf("month"); await refresh(); return;
    }
    const day = e.target.closest(".cal-day[data-date]");
    if (day && !day.disabled) {
      dialog.close();
      onPick(day.dataset.date);
    }
  });
}

export async function openHistory(ctx) {
  userId = ctx.userId;
  tz = ctx.timezone;
  cursor = DateTime.fromISO(ctx.focusDate, { zone: tz }).startOf("month");
  await refresh();
}
