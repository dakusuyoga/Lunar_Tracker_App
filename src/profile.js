/* ── The account's chart, and where they're viewing from ─────────────
   V2 keeps one chart per account in Postgres. The rest of the app was
   written against a local array of profiles, so rather than rewrite every
   caller this maps the single database row into that same shape — one
   entry, always active.

   Display location lives here too, not in localStorage, because it decides
   `checkin_date`: two devices set to different places would disagree about
   which local day a check-in belongs to, and that day is part of the row's
   identity. Cosmetic preferences stay per-device; anything that changes
   what gets stored belongs to the account. */
import { supabase } from "./supabase.js";
import { DEFAULT_LOCATION } from "./store.js";

/* Database row → the shape compute.js and the forms already expect. */
export function rowToProfile(row) {
  return {
    id: row.user_id,
    name: row.name || "My chart",
    birthDate: row.birth_date,
    birthTime: row.birth_time ? String(row.birth_time).slice(0, 5) : "",
    timeUnknown: !row.birth_time,
    place: {
      displayName: row.birth_place,
      latitude: row.birth_lat,
      longitude: row.birth_lon,
    },
    timezone: row.birth_tz,
    natalVersion: row.natal_version || 1,
  };
}

export function rowToLocation(row) {
  if (!row || !row.display_tz) return { ...DEFAULT_LOCATION };
  return {
    displayName: row.display_place,
    latitude: row.display_lat,
    longitude: row.display_lon,
    timezone: row.display_tz,
  };
}

/* Returns the row, or null when the account has no chart yet — which is
   the first-run state, not an error. */
export async function fetchProfileRow(userId) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.warn("profile fetch failed", error);
    throw error;
  }
  return data || null;
}

/* Insert or update the single chart. `natal_version` increments whenever
   the birth data changes, so a stored check-in can later tell whether the
   snapshot it was computed against is still the current chart (see the
   recompute-authority rule in the V2 runbook). */
export async function saveProfileRow(userId, profile, natalData, previous) {
  const birthChanged = !previous
    || previous.birth_date !== profile.birthDate
    || (previous.birth_time || "") !== (profile.timeUnknown ? "" : profile.birthTime)
    || previous.birth_lat !== profile.place.latitude
    || previous.birth_lon !== profile.place.longitude
    || previous.birth_tz !== profile.timezone;

  const row = {
    user_id: userId,
    name: profile.name,
    birth_date: profile.birthDate,
    birth_time: profile.timeUnknown ? null : profile.birthTime,
    birth_place: profile.place.displayName,
    birth_lat: profile.place.latitude,
    birth_lon: profile.place.longitude,
    birth_tz: profile.timezone,
    natal_data: natalData,
    natal_version: birthChanged ? ((previous?.natal_version || 0) + 1) : (previous?.natal_version || 1),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("profiles").upsert(row).select().single();
  if (error) throw error;
  return data;
}

export async function saveDisplayLocation(userId, location) {
  const { error } = await supabase.from("profiles").update({
    display_place: location.displayName,
    display_lat: location.latitude,
    display_lon: location.longitude,
    display_tz: location.timezone,
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId);
  if (error) throw error;
}
