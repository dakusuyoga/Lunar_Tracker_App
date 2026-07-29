// Generates the static eclipse table for src/eclipses.js.
// Times are instants of greatest eclipse computed with Swiss Ephemeris,
// which agree with the NASA eclipse catalog (eclipse.gsfc.nasa.gov) to
// within a minute. Run `node tools/gen-eclipses.mjs` and paste the output.
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

const jdToDate = (jd) => new Date(Math.round((jd - 2440587.5) * 86400000));

function solarType(flag) {
  if (flag & swe.SE_ECL_TOTAL) return "total";
  if (flag & swe.SE_ECL_ANNULAR_TOTAL) return "hybrid";
  if (flag & swe.SE_ECL_ANNULAR) return "annular";
  if (flag & swe.SE_ECL_PARTIAL) return "partial";
  return "unknown";
}
function lunarType(flag) {
  if (flag & swe.SE_ECL_TOTAL) return "total";
  if (flag & swe.SE_ECL_PARTIAL) return "partial";
  if (flag & swe.SE_ECL_PENUMBRAL) return "penumbral";
  return "unknown";
}

// Range: Jan 2024 through Dec 2028 (covers "today ± 2 years" with margin).
const START = swe.swe_julday(2024, 1, 1, 0, swe.SE_GREG_CAL);
const END = swe.swe_julday(2029, 1, 1, 0, swe.SE_GREG_CAL);

const rows = [];
for (const kind of ["solar", "lunar"]) {
  let jd = START;
  for (let i = 0; i < 40; i++) {
    let res;
    try {
      res = kind === "solar"
        ? swe.swe_sol_eclipse_when_glob(jd, swe.SEFLG_SWIEPH, 0, false)
        : swe.swe_lun_eclipse_when(jd, swe.SEFLG_SWIEPH, 0, false);
    } catch (e) {
      console.error(kind, "search failed:", e.message);
      break;
    }
    const flag = res.rflag ?? res.retflag ?? res.flag;
    const tret = res.tret ?? res;
    // tret[0] = time of maximum eclipse (UT)
    const jdMax = Array.isArray(tret) ? tret[0] : tret;
    if (jdMax > END) break;
    const type = kind === "solar" ? solarType(flag) : lunarType(flag);
    rows.push({ jd: jdMax, kind, type, utc: jdToDate(jdMax).toISOString().replace(".000Z", "Z").slice(0, 17) + "00Z" });
    jd = jdMax + 5;
  }
}
rows.sort((a, b) => a.jd - b.jd);
for (const r of rows) {
  console.log(`  { utc: "${r.utc}", kind: "${r.kind}", type: "${r.type.padEnd(9)}".trim() },`.replace('".trim() ', '"       '.slice(0, 9 - r.type.length + 2) + ''));
}
// simpler print
console.log("----");
for (const r of rows) {
  console.log(`  { utc: "${r.utc}", kind: "${r.kind}",  type: "${r.type}" },`);
}
