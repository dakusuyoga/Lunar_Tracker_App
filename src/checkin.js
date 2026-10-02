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
/* Two kinds of fact, and they come from different places.

   Properties of the CHART are read from the stored natal data: the birth
   instant, the birth-epoch ayanāṁśa, whether a time was known, and the
   raw longitudes.

   Properties of the READING — which house systems were used, and which
   version of the code produced the numbers — must describe the code that
   just ran, not whatever was recorded when the chart was first saved.
   Inheriting them stamped `house_system: "placidus"` onto rows whose
   sidereal house had actually been computed as whole sign, which is
   precisely the mislabelling that makes old rows uncomparable. */
const HOUSE_SYSTEMS = { tropical: "placidus", sidereal: "whole_sign" };
const ALGO_VERSION = 2;   // 1 = sidereal houses as shifted Placidus

function snapshotOf(profileRow) {
  const n = profileRow?.natal_data || {};
  return {
    natal_utc: n.natal_utc,
    ayanamsa: n.ayanamsa,
    time_unknown: n.time_unknown,
    natal_version: profileRow?.natal_version || 1,
    points: n.points,
    angles: n.angles || null,
    cusps: n.cusps || null,

    house_system: HOUSE_SYSTEMS,
    algo_version: ALGO_VERSION,
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

/* ── Reconcile ───────────────────────────────────────────────────────
   Fills in the moon-context of rows that were saved without it.

   The human answers are irreplaceable and the astronomy is always
   recomputable, so a cold engine never blocks a save — it writes the row
   with `moon_context_pending` and this picks it up afterwards. The anchor
   is the row's own `created_at`, so the result is identical to what a warm
   save would have produced at that instant.

   Two boundaries matter. It writes ONLY moon-context columns and the flag,
   never the human answers — the database enforces that too, via the
   immutability trigger. And it keys on `pending = true`, which is also
   what the RLS update policy requires, so a settled row cannot be touched
   by this path at all. */
export async function backfillPending(userId, natal, profileRow) {
  if (!supabase || !natal || natal.invalid) return { filled: 0 };

  const { data, error } = await supabase
    .from("check_ins").select("checkin_date, created_at")
    .eq("user_id", userId).eq("moon_context_pending", true);
  if (error) { console.warn("backfill query failed", error); return { filled: 0 }; }
  if (!data || !data.length) return { filled: 0 };

  let filled = 0;
  for (const row of data) {
    const instant = new Date(row.created_at);
    const jd = jdFromDate(instant);
    const angle = moonSunElongation(jd);
    const trop = moonContextAt(instant, natal, "tropical");
    const sid = moonContextAt(instant, natal, "sidereal");

    /* The snapshot is written now rather than then, because a pending row
       never had one. If the chart was edited in between, this records the
       chart that actually produced these numbers — which is what the
       snapshot is for. */
    const patch = {
      moon_phase: phaseKey(angle),
      phase_angle: Number(angle.toFixed(4)),
      moon_longitude: Number(trop.moonLonTropical.toFixed(6)),
      moon_natal_sign_tropical: trop.sign,
      moon_natal_sign_sidereal: sid.sign,
      moon_natal_house_tropical: trop.house,
      moon_natal_house_sidereal: sid.house,
      conjunctions_tropical: trop.conjunctions,
      conjunctions_sidereal: sid.conjunctions,
      natal_snapshot: snapshotOf(profileRow),
      moon_context_pending: false,
    };

    const res = await supabase.from("check_ins").update(patch)
      .eq("user_id", userId).eq("checkin_date", row.checkin_date);
    if (res.error) console.warn("backfill update failed", row.checkin_date, res.error);
    else filled++;
  }
  return { filled };
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
