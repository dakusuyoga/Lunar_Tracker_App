// Rise/set + phase-search sanity check for Toronto (43.65 N, -79.38 E).
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const s = String(url);
  if (s.startsWith("file://") || !/^[a-z]+:/i.test(s)) {
    const p = s.startsWith("file://") ? fileURLToPath(s) : s;
    return new Response(fs.readFileSync(p), { status: 200 });
  }
  return realFetch(url, opts);
};

const SwissEPH = createRequire(import.meta.url)("sweph-wasm");
const swe = await SwissEPH.init();
await swe.swe_set_ephe_path(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../node_modules/sweph-wasm/dist/ephe"),
  ["sepl_18.se1", "semo_18.se1", "seas_18.se1"]
);

const GEO = [-79.38, 43.65, 0]; // lon, lat, elevation

function jdToDate(jd) {
  return new Date((jd - 2440587.5) * 86400000);
}
const fmt = (jd) =>
  jd == null ? "—" : jdToDate(jd).toLocaleString("en-US", { timeZone: "America/Toronto", hour: "numeric", minute: "2-digit", month: "short", day: "numeric" });

// Search window: local midnight Toronto (EDT = UTC-4) 2026-07-15 => 04:00 UTC
for (const day of [15, 16, 17]) {
  const jd0 = swe.swe_julday(2026, 7, day, 4.0, swe.SE_GREG_CAL);
  for (const [name, ipl] of [["Sun", swe.SE_SUN], ["Moon", swe.SE_MOON]]) {
    let rise, set;
    try { rise = swe.swe_rise_trans(jd0, ipl, null, swe.SEFLG_SWIEPH, swe.SE_CALC_RISE, GEO, 0, 0); } catch (e) { rise = "ERR " + e.message; }
    try { set = swe.swe_rise_trans(jd0, ipl, null, swe.SEFLG_SWIEPH, swe.SE_CALC_SET, GEO, 0, 0); } catch (e) { set = "ERR " + e.message; }
    console.log(`2026-07-${day} ${name}: rise ${typeof rise === "number" ? fmt(rise) : rise} | set ${typeof set === "number" ? fmt(set) : set}`);
  }
}

// Phase search via bisection on Sun→Moon elongation.
function elong(jd) {
  const m = swe.swe_calc_ut(jd, swe.SE_MOON, swe.SEFLG_SWIEPH);
  const s = swe.swe_calc_ut(jd, swe.SE_SUN, swe.SEFLG_SWIEPH);
  return (((m[0] - s[0]) % 360) + 360) % 360;
}
function searchPhase(target, jdStart, jdEnd) {
  // f = wrapped difference elong - target in (-180, 180]; find zero crossing.
  const f = (jd) => {
    let d = elong(jd) - target;
    d = ((d % 360) + 360) % 360;
    return d > 180 ? d - 360 : d;
  };
  let a = jdStart, fa = f(a);
  const stepDays = 0.5;
  for (let b = a + stepDays; b <= jdEnd + stepDays; b += stepDays) {
    const fb = f(Math.min(b, jdEnd));
    if (fa < 0 && fb >= 0) {
      let lo = a, hi = Math.min(b, jdEnd);
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (f(mid) < 0) lo = mid; else hi = mid;
      }
      return (lo + hi) / 2;
    }
    a = Math.min(b, jdEnd); fa = fb;
  }
  return null;
}

// Full moon near 2026-07-29 (expected ~2026-07-29 14:36 UTC per almanacs)
const jdA = swe.swe_julday(2026, 7, 20, 0, swe.SE_GREG_CAL);
const jdB = swe.swe_julday(2026, 8, 5, 0, swe.SE_GREG_CAL);
const fm = searchPhase(180, jdA, jdB);
console.log("Full moon instant (UTC):", jdToDate(fm).toISOString());
const nm = searchPhase(0, jdA, jdB);
console.log("New moon instant (UTC):", nm ? jdToDate(nm).toISOString() : "none in window");
