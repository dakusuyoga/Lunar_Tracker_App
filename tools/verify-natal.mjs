// Verification script: reference chart Dec 5 1980, 17:25 CET (16:25 UTC),
// Beelitz-Heilstätten, Germany (52.267 N, 12.933 E), Placidus, tropical.
// Expected values come from the previous widget's data.js, which was
// verified against astro-seek.com to within arc-seconds.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

// Node's fetch cannot load file:// URLs; the wasm loader needs it.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const s = String(url);
  if (s.startsWith("file://") || !/^[a-z]+:/i.test(s)) {
    const p = s.startsWith("file://") ? fileURLToPath(s) : s;
    const buf = fs.readFileSync(p);
    return new Response(buf, { status: 200 });
  }
  return realFetch(url, opts);
};

const SwissEPH = createRequire(import.meta.url)("sweph-wasm");

const swe = await SwissEPH.init();
const epheDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../node_modules/sweph-wasm/dist/ephe"
);
await swe.swe_set_ephe_path(epheDir, ["sepl_18.se1", "semo_18.se1", "seas_18.se1"]);

const jd = swe.swe_julday(1980, 12, 5, 16 + 25 / 60, swe.SE_GREG_CAL);
console.log("JD (UT):", jd);

const FLAGS = swe.SEFLG_SWIEPH | swe.SEFLG_SPEED;
const bodies = {
  Sun: swe.SE_SUN, Moon: swe.SE_MOON, Mercury: swe.SE_MERCURY,
  Venus: swe.SE_VENUS, Mars: swe.SE_MARS, Jupiter: swe.SE_JUPITER,
  Saturn: swe.SE_SATURN, Uranus: swe.SE_URANUS, Neptune: swe.SE_NEPTUNE,
  Pluto: swe.SE_PLUTO, TrueNode: swe.SE_TRUE_NODE, Chiron: swe.SE_CHIRON,
};

const expected = {
  Sun: 253.7047, Moon: 232.15, Mercury: 239.7894, Venus: 224.361,
  Mars: 280.3823, Jupiter: 186.6977, Saturn: 188.0995, Uranus: 236.942,
  Neptune: 262.0631, Pluto: 203.5664,
};

for (const [name, id] of Object.entries(bodies)) {
  try {
    const r = swe.swe_calc_ut(jd, id, FLAGS);
    const lon = Array.isArray(r) ? r[0] : r.longitude ?? r[0];
    const exp = expected[name];
    const diff = exp === undefined ? "" : `  Δ=${((lon - exp) * 3600).toFixed(1)}″`;
    console.log(name.padEnd(9), lon.toFixed(4) + diff);
  } catch (e) {
    console.log(name.padEnd(9), "ERROR:", e.message);
  }
}

const houses = swe.swe_houses(jd, 52.267, 12.933, "P");
console.log("houses result:", JSON.stringify(houses).slice(0, 400));

const expectedCusps = [96.9304, 112.4826, 129.5641, 151.7963, 185.0929,
  233.4059, 276.9304, 292.4826, 309.5641, 331.7963, 5.0929, 53.4059];
const cusps = houses.cusps ?? houses[0];
for (let i = 0; i < 12; i++) {
  const c = cusps[i + 1] ?? cusps[i]; // 1-based vs 0-based
  console.log(`cusp ${i + 1}`.padEnd(9), Number(c).toFixed(4),
    ` Δ=${((c - expectedCusps[i]) * 3600).toFixed(1)}″`);
}

swe.swe_set_sid_mode(swe.SE_SIDM_LAHIRI, 0, 0);
console.log("Lahiri ayanamsa at birth:", swe.swe_get_ayanamsa_ut(jd).toFixed(4), "(old widget approx: 23.587)");

// Moon phase / illumination check
const pheno = swe.swe_pheno_ut(jd, swe.SE_MOON, swe.SEFLG_SWIEPH);
console.log("pheno (moon):", JSON.stringify(pheno).slice(0, 200));
