/* ── Ritual completions ──────────────────────────────────────────────
   A toggle per ceremony, recorded per lunation rather than per day.

   The grain matters: the New Moon wishing window opens at the exact
   instant and runs 24 hours, so it routinely spans two calendar days.
   Someone doing the ritual at 10am on the 13th did the *August 12
   lunation's* ritual. The row is keyed by the lunation's UTC date, which
   the database derives from `event_utc` — the client never computes the
   key it writes.

   Both directions are idempotent: upsert on, delete off. A stale screen
   therefore cannot produce a wrong outcome, which matters because the same
   account is used from more than one device. */
import { supabase } from "./supabase.js";

export const RITUALS = {
  new_moon_wishing: "New Moon wishing ritual",
  full_moon_forgiveness: "Full Moon Forgiveness Ceremony",
  full_moon_gratitude: "Entering a State of Gratitude",
};

/* The lunation's UTC date. Deriving a *date* client-side is safe under
   millisecond jitter between devices; deriving a timestamp would not be. */
export const eventDateOf = (instant) => instant.toISOString().slice(0, 10);

export async function fetchCompletions(userId, eventDate) {
  if (!supabase) return new Set();
  const { data, error } = await supabase
    .from("ritual_completions").select("ritual")
    .eq("user_id", userId).eq("event_date", eventDate);

  if (error) { console.warn("ritual fetch failed", error); return new Set(); }
  return new Set((data || []).map((r) => r.ritual));
}

export async function setCompletion(userId, ritual, instant, done, displayTz) {
  if (!supabase) return;
  const event_date = eventDateOf(instant);
  if (done) {
    // Upsert, not insert: marking something already marked is a no-op, not
    // a failure. A lost response on a bad connection would otherwise
    // surface an error for a write that actually succeeded.
    //
    // `display_tz` freezes where this was lived, exactly as check_ins does.
    // Without it, any later conversion to a civil day would borrow the
    // user's CURRENT location — so a ritual done in Vancouver would drift
    // onto a different day once they moved to Toronto.
    const { error } = await supabase.from("ritual_completions").upsert(
      { user_id: userId, ritual, event_utc: instant.toISOString(), display_tz: displayTz },
      { onConflict: "user_id,ritual,event_date", ignoreDuplicates: true }
    );
    if (error && error.code !== "23505") throw error;
  } else {
    const { error } = await supabase.from("ritual_completions")
      .delete().eq("user_id", userId).eq("ritual", ritual).eq("event_date", event_date);
    if (error) throw error;
  }
}

/* The markup for a toggle, placed with the heading of the thing it marks
   (§6.3b) rather than at the foot of the panel — heading-adjacent is
   unambiguous about which ceremony it belongs to, and it's where someone
   returning to mark a ritual they did offline will look first. */
export function toggleMarkup(ritual, done) {
  return `<button type="button" class="ritual-toggle${done ? " is-done" : ""}"` +
    ` data-ritual="${ritual}" aria-pressed="${done}">` +
    `${done ? "Done ✓" : "Mark as done"}</button>`;
}
