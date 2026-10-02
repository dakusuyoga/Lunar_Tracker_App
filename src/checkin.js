/* ── The check-in save ───────────────────────────────────────────────
   Implements the V2-C save-path contract from the Supabase runbook.

   The governing rule: every save computes BOTH zodiac modes and writes all
   six mode-columns, whichever the toggle happens to be showing. A row
   holding only the active mode is broken for V3 and — because a populated
   tropical trio looks complete — undetectable by reading the row.

   The anchor is `created_at`, the exact save instant. That is correct only
   because the daily view is live: it reads the sky at the current moment,
   so this is what the user was actually looking at. If the display anchor
   ever changes, this must change with it. */
import { DateTime } from "luxon";
import { moonContextAt } from "./compute.js";
import { moonSunElongation, jdFromDate } from "./ephemeris.js";
import { supabase } from "./supabase.js";
import { queue, flush } from "./outbox.js";

const PHASE_NAMES = ["new", "waxing_crescent", "first_quarter", "waxing_gibbous",
  "full", "waning_gibbous", "last_quarter", "waning_crescent"];

function phaseKey(angle) {
  const a = ((angle % 360) + 360) % 360;
  const i = Math.floor(((a + 22.5) % 360) / 45);
  return PHASE_NAMES[i];
}

/* natal_data is already stored as degrees; the snapshot is that data plus
   the metadata a later recompute needs. Degrees are the only mode-agnostic
   representation — a stored word like "scorpio" is already committed to
   one zodiac and cannot be flipped. */
function snapshotOf(profileRow) {
  const n = profileRow?.natal_data || {};
  return {
    natal_utc: n.natal_utc,
    ayanamsa: n.ayanamsa,
    time_unknown: n.time_unknown,
    house_system: n.house_system || { tropical: "placidus", sidereal: "whole_sign" },
    algo_version: n.algo_version || 1,
    natal_version: profileRow?.natal_version || 1,
    points: n.points,
    angles: n.angles || null,
    cusps: n.cusps || null,
  };
}

/* `answers` is the human check-in; everything else is derived here so a
   caller can never accidentally save one mode, or the wrong instant. */
export function buildCheckIn({ userId, answers, location, natal, profileRow, engineReady }) {
  const now = new Date();
  const checkinDate = DateTime.fromJSDate(now).setZone(location.timezone).toISODate();

  const row = {
    user_id: userId,
    created_at: now.toISOString(),
    checkin_date: checkinDate,
    display_tz: location.timezone,

    emotions: answers.emotions || [],
    body: answers.body || [],
    energy: answers.energy || null,
    focus: answers.focus || null,
    journal_text: answers.journal || null,

    moon_context_pending: false,
  };

  /* The human answers are irreplaceable; the moon-context is always
     recomputable. So a cold engine never blocks the save — the row goes in
     with the context null and `pending` set, and the backfill fills it on
     the next app-open. This matters precisely because there is no second
     chance at today. */
  if (!engineReady || !natal) {
    row.moon_context_pending = true;
    return row;
  }

  const jd = jdFromDate(now);
  const angle = moonSunElongation(jd);
  const trop = moonContextAt(now, natal, "tropical");
  const sid = moonContextAt(now, natal, "sidereal");

  row.moon_phase = phaseKey(angle);
  row.phase_angle = Number(angle.toFixed(4));
  row.moon_longitude = Number(trop.moonLonTropical.toFixed(6));

  row.moon_natal_sign_tropical = trop.sign;
  row.moon_natal_sign_sidereal = sid.sign;
  row.moon_natal_house_tropical = trop.house;
  row.moon_natal_house_sidereal = sid.house;
  row.conjunctions_tropical = trop.conjunctions;
  row.conjunctions_sidereal = sid.conjunctions;
  row.natal_snapshot = snapshotOf(profileRow);

  return row;
}

/* Save through the outbox: local first, network second. Returns the row so
   the UI can show the saved state immediately either way. */
export async function saveCheckIn(row) {
  queue({ table: "check_ins", row, onConflict: "user_id,checkin_date" });
  const result = await flush(supabase);
  return { row, synced: result.kept === 0 };
}

export async function fetchCheckIn(userId, dateISO) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("check_ins").select("*")
    .eq("user_id", userId).eq("checkin_date", dateISO).maybeSingle();
  if (error) { console.warn("check-in fetch failed", error); return null; }
  return data || null;
}

export async function fetchMonth(userId, firstISO, lastISO) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("check_ins").select("checkin_date")
    .eq("user_id", userId).gte("checkin_date", firstISO).lte("checkin_date", lastISO);
  if (error) { console.warn("month fetch failed", error); return []; }
  return data || [];
}
