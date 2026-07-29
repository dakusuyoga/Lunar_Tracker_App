/* ── Chart & daily computations ──────────────────────────────────── */
import { DateTime } from "luxon";
import {
  norm360, wrap180, jdFromDate,
  calcLon, calcHouses, lahiriAyanamsa, moonIllumination,
  moonSunElongation, riseSetTimes, searchPhaseEvent,
} from "./ephemeris.js";
import { ECLIPSES } from "./eclipses.js";

export const SIGNS = [
  "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
  "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces",
];
// U+FE0E forces text (non-emoji) presentation of the sign glyphs.
export const SIGN_GLYPHS = ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓"]
  .map((g) => g + "︎");
export const ORDINALS = [
  "", "1st", "2nd", "3rd", "4th", "5th", "6th",
  "7th", "8th", "9th", "10th", "11th", "12th",
];

export const CONJUNCTION_ORB = 5; // degrees

export const signIndex = (lon) => Math.floor(norm360(lon) / 30);
export const signName = (lon) => SIGNS[signIndex(lon)];
export const signKey = (lon) => SIGNS[signIndex(lon)].toLowerCase();

export function degInSign(lon) {
  const within = norm360(lon) % 30;
  const d = Math.floor(within);
  const m = Math.round((within - d) * 60);
  return m === 60 ? `${d + 1}°00′` : `${d}°${String(m).padStart(2, "0")}′`;
}

// Tropical longitude → longitude in the active zodiac mode.
export const modal = (lonTropical, ayanamsa, mode) =>
  mode === "sidereal" ? norm360(lonTropical - ayanamsa) : norm360(lonTropical);

export function houseOf(lon, cusps) {
  for (let h = 0; h < 12; h++) {
    const a = cusps[h], b = cusps[(h + 1) % 12];
    if (norm360(lon - a) < norm360(b - a)) return h + 1;
  }
  return 12;
}

/* ── Natal chart ─────────────────────────────────────────────────── */

const NATAL_PLANETS = ["Sun", "Moon", "Mercury", "Venus", "Mars",
  "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];

// Order in which conjunctions are checked and displayed.
export const CONJUNCTION_POINTS = [
  ...NATAL_PLANETS, "NorthNode", "SouthNode", "Chiron",
  "Ascendant", "Descendant", "Midheaven", "ImumCoeli",
];

export const POINT_LABELS = {
  Sun: "Natal Sun", Moon: "Natal Moon", Mercury: "Natal Mercury",
  Venus: "Natal Venus", Mars: "Natal Mars", Jupiter: "Natal Jupiter",
  Saturn: "Natal Saturn", Uranus: "Natal Uranus", Neptune: "Natal Neptune",
  Pluto: "Natal Pluto", NorthNode: "North Node", SouthNode: "South Node",
  Chiron: "Natal Chiron", Ascendant: "Ascendant", Descendant: "Descendant",
  Midheaven: "Midheaven", ImumCoeli: "Imum Coeli",
};

const natalCache = new Map();

export function natalFor(profile) {
  if (!profile) return null;
  const sig = [
    profile.birthDate, profile.birthTime, profile.timeUnknown,
    profile.place && profile.place.latitude, profile.place && profile.place.longitude,
    profile.timezone,
  ].join("|");
  const hit = natalCache.get(profile.id);
  if (hit && hit.sig === sig) return hit.natal;
  const natal = computeNatal(profile);
  natalCache.set(profile.id, { sig, natal });
  return natal;
}

function computeNatal(profile) {
  const zone = profile.timezone;
  // Unknown birth time → local noon of the birth date (slow movers only).
  const dt = profile.timeUnknown
    ? DateTime.fromISO(profile.birthDate, { zone }).set({ hour: 12, minute: 0, second: 0, millisecond: 0 })
    : DateTime.fromISO(`${profile.birthDate}T${profile.birthTime}`, { zone });
  if (!dt.isValid) return { invalid: true, reason: dt.invalidReason };

  const jd = jdFromDate(dt.toJSDate());
  const points = {};
  for (const p of NATAL_PLANETS) {
    // Natal Moon moves ~12°/day — meaningless without a birth time.
    if (profile.timeUnknown && p === "Moon") continue;
    try { points[p] = calcLon(jd, p).lon; } catch { /* omit on failure */ }
  }
  try {
    points.NorthNode = calcLon(jd, "TrueNode").lon;
    points.SouthNode = norm360(points.NorthNode + 180);
  } catch { /* omit */ }
  try { points.Chiron = calcLon(jd, "Chiron").lon; } catch { /* omit */ }

  let cusps = null;
  let angles = null;
  if (!profile.timeUnknown) {
    const h = calcHouses(jd, profile.place.latitude, profile.place.longitude);
    cusps = h.cusps;
    angles = {
      Ascendant: h.asc,
      Descendant: norm360(h.asc + 180),
      Midheaven: h.mc,
      ImumCoeli: norm360(h.mc + 180),
    };
  }

  return {
    jd,
    utcISO: dt.toUTC().toISO(),
    points,
    cusps,
    angles,
    ayanamsa: lahiriAyanamsa(jd), // natal-epoch Lahiri, for sidereal mode
    timeUnknown: !!profile.timeUnknown,
  };
}

// Natal cusps in the active zodiac mode (sidereal uses the natal ayanāṁśa).
export function modalCusps(natal, mode) {
  if (!natal || !natal.cusps) return null;
  if (mode === "sidereal") return natal.cusps.map((c) => norm360(c - natal.ayanamsa));
  return natal.cusps.slice();
}

/* ── Daily view ──────────────────────────────────────────────────── */

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
export const AFFIRMATION_DAYS = 28;

function phaseName(angle) {
  if (angle < 90) return "Waxing Crescent";
  if (angle < 180) return "Waxing Gibbous";
  if (angle < 270) return "Waning Gibbous";
  return "Waning Crescent";
}

/* Everything the daily view needs for one local calendar date.
   dateISO is a calendar date in the display location's timezone.
   natal may be null (no profile). All sign/house lookups follow `mode`. */
export function computeDay(dateISO, location, natal, mode) {
  const zone = location.timezone;
  const dayStartDT = DateTime.fromISO(dateISO, { zone }).startOf("day");
  const dayEndDT = dayStartDT.plus({ days: 1 });
  const noonDT = dayStartDT.set({ hour: 12 });
  const dayStart = dayStartDT.toJSDate();
  const dayEnd = dayEndDT.toJSDate();
  const noon = noonDT.toJSDate();

  const jdNoon = jdFromDate(noon);
  const ayNoon = lahiriAyanamsa(jdNoon);

  const moonTrop = calcLon(jdNoon, "Moon").lon;
  const phaseAngle = moonSunElongation(jdNoon);
  const illum = moonIllumination(jdNoon);
  const moonLon = modal(moonTrop, ayNoon, mode);

  const moonTimes = riseSetTimes("Moon", dayStart, dayEnd, location.latitude, location.longitude);
  const sunTimes = riseSetTimes("Sun", dayStart, dayEnd, location.latitude, location.longitude);

  const cusps = natal && !natal.invalid ? modalCusps(natal, mode) : null;
  const house = cusps ? houseOf(moonLon, cusps) : null;

  /* New/full moon ±12h window: show the event's text when this local day
     overlaps [exact instant − 12h, exact instant + 12h]. The window is
     48 h wide in day-overlap terms, so the text appears on the event day
     and at most one adjacent day. */
  const windowEvent = (targetAngle) => {
    const from = new Date(dayStart.getTime() - 12 * HOUR_MS);
    const to = new Date(dayEnd.getTime() + 12 * HOUR_MS);
    const instant = searchPhaseEvent(targetAngle, from, to);
    if (!instant) return null;
    const jdE = jdFromDate(instant);
    const lon = modal(calcLon(jdE, "Moon").lon, lahiriAyanamsa(jdE), mode);
    return {
      instant,
      lon,
      sign: signName(lon),
      signKey: signKey(lon),
      house: cusps ? houseOf(lon, cusps) : null,
      onThisDay: instant >= dayStart && instant < dayEnd,
    };
  };
  const newMoonWindow = windowEvent(0);
  const fullMoonWindow = windowEvent(180);

  // Quarter texts use the exact local calendar day (no ±12h window).
  const quarterEvent = (targetAngle) => {
    const instant = searchPhaseEvent(targetAngle, dayStart, dayEnd);
    if (!instant) return null;
    const jdE = jdFromDate(instant);
    const lon = modal(calcLon(jdE, "Moon").lon, lahiriAyanamsa(jdE), mode);
    return { instant, lon, sign: signName(lon), signKey: signKey(lon) };
  };
  const firstQuarter = quarterEvent(90);
  const lastQuarter = quarterEvent(270);

  let phase = phaseName(phaseAngle);
  if (newMoonWindow && newMoonWindow.onThisDay) phase = "New Moon";
  else if (firstQuarter) phase = "Waxing Quarter Moon";
  else if (fullMoonWindow && fullMoonWindow.onThisDay) phase = "Full Moon";
  else if (lastQuarter) phase = "Waning Quarter Moon";

  /* New Moon affirmations: active from the exact New Moon instant until 28
     days later, keyed by the natal house of that New Moon. When viewing
     today the actual clock time decides (the quotes switch over at the
     exact instant); for other dates, local noon. House-keyed, so they need
     a birth time (cusps). */
  const isToday = dateISO === DateTime.now().setZone(zone).toISODate();
  let affirmations = null;
  if (cusps) {
    const ref = isToday ? new Date() : noon;
    // Most recent New Moon at or before ref: a 31-day window holds one or
    // two of them (synodic month ≈ 29.53 d) — keep the later one.
    let nm = searchPhaseEvent(0, new Date(ref.getTime() - 31 * DAY_MS), ref);
    if (nm) {
      const later = searchPhaseEvent(0, new Date(nm.getTime() + HOUR_MS), ref);
      if (later) nm = later;
    }
    if (nm && ref.getTime() - nm.getTime() <= AFFIRMATION_DAYS * DAY_MS) {
      const jdE = jdFromDate(nm);
      const lon = modal(calcLon(jdE, "Moon").lon, lahiriAyanamsa(jdE), mode);
      affirmations = { instant: nm, house: houseOf(lon, cusps) };
    }
  }

  // Eclipse whose instant falls on this local calendar date.
  const eclipse = ECLIPSES.find(
    (e) => DateTime.fromISO(e.utc, { zone }).toISODate() === dateISO
  ) || null;

  // Transiting Moon → natal conjunctions (conjunctions only, 5° orb, noon).
  let conjunctions = null;
  if (natal && !natal.invalid) {
    conjunctions = [];
    for (const key of CONJUNCTION_POINTS) {
      const src = key in (natal.angles || {}) ? natal.angles : natal.points;
      const lonTrop = src ? src[key] : undefined;
      if (lonTrop === undefined) continue;
      const natLon = modal(lonTrop, natal.ayanamsa, mode);
      const orb = Math.abs(wrap180(moonLon - natLon));
      if (orb <= CONJUNCTION_ORB) {
        conjunctions.push({ key, label: POINT_LABELS[key], orb });
      }
    }
    conjunctions.sort((a, b) => a.orb - b.orb);
  }

  return {
    dateISO, noonDT,
    phaseAngle, illum, phase,
    moonLon, moonSignIndex: signIndex(moonLon),
    moonTimes, sunTimes,
    house,
    newMoonWindow, fullMoonWindow, firstQuarter, lastQuarter,
    eclipse,
    conjunctions,
    affirmations, isToday,
  };
}
