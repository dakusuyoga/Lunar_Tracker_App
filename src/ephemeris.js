/* ── Swiss Ephemeris (WASM) wrapper ───────────────────────────────────
   All astronomical/astrological numbers in the app come from here.
   Ephemeris files are self-hosted in public/ephe (no CDN at runtime). */
import SwissEPH from "sweph-wasm";

let swe = null;

/* Slow or lossy connections (mobile data, congested international links)
   can drop the multi-MB engine download mid-flight — retry each step a few
   times with backoff before giving up. */
async function withRetry(fn, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

export async function initEphemeris() {
  const base = import.meta.env.BASE_URL || "./";
  swe = await withRetry(() => SwissEPH.init(base + "swisseph.wasm"));
  await withRetry(() => swe.swe_set_ephe_path(base + "ephe", [
    "sepl_18.se1", // planets, 1800–2399 AD
    "semo_18.se1", // Moon, 1800–2399 AD
    "seas_18.se1", // asteroids incl. Chiron, 1800–2399 AD
  ]));
  swe.swe_set_sid_mode(swe.SE_SIDM_LAHIRI, 0, 0);
}

export const norm360 = (x) => ((x % 360) + 360) % 360;
export const wrap180 = (x) => {
  const n = norm360(x);
  return n > 180 ? n - 360 : n;
};

export const jdFromDate = (date) => date.getTime() / 86400000 + 2440587.5;
export const jdToDate = (jd) => new Date(Math.round((jd - 2440587.5) * 86400000));

const bodyIds = () => ({
  Sun: swe.SE_SUN, Moon: swe.SE_MOON, Mercury: swe.SE_MERCURY,
  Venus: swe.SE_VENUS, Mars: swe.SE_MARS, Jupiter: swe.SE_JUPITER,
  Saturn: swe.SE_SATURN, Uranus: swe.SE_URANUS, Neptune: swe.SE_NEPTUNE,
  Pluto: swe.SE_PLUTO, TrueNode: swe.SE_TRUE_NODE, Chiron: swe.SE_CHIRON,
});

// Tropical geocentric ecliptic longitude of a body, in degrees.
export function calcLon(jd, body) {
  const r = swe.swe_calc_ut(jd, bodyIds()[body], swe.SEFLG_SWIEPH | swe.SEFLG_SPEED);
  return { lon: norm360(r[0]), speed: r[3] };
}

// Placidus cusps (tropical) + angles for a birth chart.
export function calcHouses(jd, latitude, longitude) {
  const h = swe.swe_houses(jd, latitude, longitude, "P");
  return {
    cusps: h.cusps.slice(1, 13), // 12 cusps, cusp 1 first
    asc: norm360(h.ascmc[0]),
    mc: norm360(h.ascmc[1]),
  };
}

// Lahiri ayanāṁśa at a UT instant (sid mode set once in initEphemeris).
export function lahiriAyanamsa(jd) {
  return swe.swe_get_ayanamsa_ut(jd);
}

// Illuminated fraction of the Moon's disc, 0–1.
export function moonIllumination(jd) {
  return swe.swe_pheno_ut(jd, swe.SE_MOON, swe.SEFLG_SWIEPH)[1];
}

// Sun→Moon elongation in ecliptic longitude: 0 = new, 180 = full.
export function moonSunElongation(jd) {
  const m = swe.swe_calc_ut(jd, swe.SE_MOON, swe.SEFLG_SWIEPH);
  const s = swe.swe_calc_ut(jd, swe.SE_SUN, swe.SEFLG_SWIEPH);
  return norm360(m[0] - s[0]);
}

/* Rise/set of Sun or Moon between two UTC instants at a location.
   swe_rise_trans finds the next event after the start instant; events
   landing on a later local day are reported as null ("—"). Circumpolar
   days (no rise or set) throw flag −2 and also render as null. */
export function riseSetTimes(body, fromDate, toDate, latitude, longitude) {
  const geo = [longitude, latitude, 0];
  const ipl = body === "Sun" ? swe.SE_SUN : swe.SE_MOON;
  const jd0 = jdFromDate(fromDate);
  const find = (rsmi) => {
    try {
      const jd = swe.swe_rise_trans(jd0, ipl, null, swe.SEFLG_SWIEPH, rsmi, geo, 0, 0);
      const d = jdToDate(jd);
      return d < toDate ? d : null;
    } catch {
      return null;
    }
  };
  return { rise: find(swe.SE_CALC_RISE), set: find(swe.SE_CALC_SET) };
}

/* Instant when the Sun→Moon elongation reaches targetAngle (0, 90, 180,
   270) inside [fromDate, toDate), or null. Windows in this app are ≤ 2
   days, so at most one event can occur (synodic month ≈ 29.5 d). */
export function searchPhaseEvent(targetAngle, fromDate, toDate) {
  const f = (jd) => {
    let d = moonSunElongation(jd) - targetAngle;
    d = norm360(d);
    return d > 180 ? d - 360 : d;
  };
  const jdFrom = jdFromDate(fromDate);
  const jdTo = jdFromDate(toDate);
  const STEP = 0.25;
  let a = jdFrom;
  let fa = f(a);
  while (a < jdTo) {
    const b = Math.min(a + STEP, jdTo);
    const fb = f(b);
    if (fa < 0 && fb >= 0) {
      let lo = a, hi = b;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (f(mid) < 0) lo = mid; else hi = mid;
      }
      return jdToDate((lo + hi) / 2);
    }
    a = b;
    fa = fb;
  }
  return null;
}
