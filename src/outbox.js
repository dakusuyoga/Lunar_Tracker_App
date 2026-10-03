/* ── Outbox ──────────────────────────────────────────────────────────
   A check-in can only be made today and can never be backfilled. So a
   failed request doesn't cost the user a retry — it costs them the day,
   permanently. The write goes to localStorage first and to Postgres
   second; if the network is down, the row waits here and is flushed on the
   next load or the next time the browser reports it is online.

   This doesn't weaken the immutability rule. The row is still written
   once, still never edited. All it removes is the connection's power to
   decide whether the day counted. */
const KEY = "lunarTracker.outbox.v1";

function read() {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

function write(items) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* Private mode or a full quota. Nothing more we can do here — the
       caller still attempts the network write, so the check-in is only
       lost if BOTH fail. */
  }
}

export function queue(entry) {
  const items = read();
  // Keyed the same way the database is: one per table, per local day.
  const i = items.findIndex(
    (e) => e.table === entry.table && e.row.checkin_date === entry.row.checkin_date
  );
  if (i >= 0) items[i] = entry; else items.push(entry);
  write(items);
}

export const pending = () => read();

export const pendingFor = (dateISO) =>
  read().find((e) => e.table === "check_ins" && e.row.checkin_date === dateISO) || null;

/* Try to send everything waiting. Anything that fails stays queued; a
   duplicate-key rejection counts as success, because it means the row is
   already there — the response to the original request was simply lost. */
export async function flush(supabase) {
  if (!supabase) return { sent: 0, kept: read().length };
  const items = read();
  if (!items.length) return { sent: 0, kept: 0 };

  const kept = [];
  let sent = 0;
  for (const entry of items) {
    try {
      const { error } = await supabase
        .from(entry.table)
        .upsert(entry.row, { onConflict: entry.onConflict, ignoreDuplicates: true });
      if (error && error.code !== "23505") throw error;
      sent++;
    } catch (e) {
      console.warn("outbox: still queued", e);
      kept.push(entry);
    }
  }
  write(kept);
  return { sent, kept: kept.length };
}

export function startOutbox(supabase) {
  const go = () => flush(supabase).catch(() => {});
  go();
  window.addEventListener("online", go);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) go(); });
}
