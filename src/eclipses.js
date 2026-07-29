/* ── ECLIPSES 2024–2028 ───────────────────────────────────────────────
   Source: NASA eclipse catalog (eclipse.gsfc.nasa.gov). Instants of
   greatest eclipse in UTC, cross-checked with Swiss Ephemeris
   (tools/gen-eclipses.mjs regenerates the instants; agreement < 1 min).
   Covers the app's "today ± 2 years" range with margin.
   ⚠ UPDATE THIS TABLE ANNUALLY — append the next year's eclipses and
   drop years that have fallen out of range. */
export const ECLIPSES = [
  { utc: "2024-03-25T07:12:00Z", kind: "lunar", type: "penumbral" },
  { utc: "2024-04-08T18:17:00Z", kind: "solar", type: "total" },
  { utc: "2024-09-18T02:44:00Z", kind: "lunar", type: "partial" },
  { utc: "2024-10-02T18:45:00Z", kind: "solar", type: "annular" },
  { utc: "2025-03-14T06:58:00Z", kind: "lunar", type: "total" },
  { utc: "2025-03-29T10:47:00Z", kind: "solar", type: "partial" },
  { utc: "2025-09-07T18:11:00Z", kind: "lunar", type: "total" },
  { utc: "2025-09-21T19:41:00Z", kind: "solar", type: "partial" },
  { utc: "2026-02-17T12:11:00Z", kind: "solar", type: "annular" },
  { utc: "2026-03-03T11:33:00Z", kind: "lunar", type: "total" },
  { utc: "2026-08-12T17:45:00Z", kind: "solar", type: "total" },
  { utc: "2026-08-28T04:12:00Z", kind: "lunar", type: "partial" },
  { utc: "2027-02-06T15:59:00Z", kind: "solar", type: "annular" },
  { utc: "2027-02-20T23:12:00Z", kind: "lunar", type: "penumbral" },
  { utc: "2027-07-18T16:03:00Z", kind: "lunar", type: "penumbral" },
  { utc: "2027-08-02T10:06:00Z", kind: "solar", type: "total" },
  { utc: "2027-08-17T07:13:00Z", kind: "lunar", type: "penumbral" },
  { utc: "2028-01-12T04:13:00Z", kind: "lunar", type: "partial" },
  { utc: "2028-01-26T15:07:00Z", kind: "solar", type: "annular" },
  { utc: "2028-07-06T18:19:00Z", kind: "lunar", type: "partial" },
  { utc: "2028-07-22T02:55:00Z", kind: "solar", type: "total" },
  { utc: "2028-12-31T16:52:00Z", kind: "lunar", type: "total" },
];
