# Lunar Tracker

A client-side web app that tracks the Moon through its phases and overlays
personalized natal-chart information — transiting-Moon conjunctions to natal
points, the Moon's natal house, and interpretive readings — for any
user-entered birth data. Multi-profile, for a small trial group of friends.

Everything is computed in the browser with
[Swiss Ephemeris](https://www.astro.com/swisseph/) compiled to WebAssembly
([sweph-wasm](https://www.npmjs.com/package/sweph-wasm)): planet positions,
Placidus house cusps, Lahiri ayanāṁśa, rise/set times, and lunation instants.
[Luxon](https://moment.github.io/luxon/) handles all timezone-aware datetime
work, including historical timezone rules for birth times.
[tz-lookup](https://www.npmjs.com/package/tz-lookup) maps coordinates to IANA
timezone names offline. The only runtime network call is
[Nominatim](https://nominatim.org/) geocoding while you type in a place field.

## Running locally

```sh
npm install
npm run dev        # dev server
npm run build      # static output in dist/
npm run preview    # serve the built dist/
```

## Deploying to GitHub Pages

The app is static files only — no backend. `vite.config.js` uses a relative
`base`, so the build works from any Pages sub-path.

1. `npm run build`
2. Publish `dist/` with your preferred method, e.g.:
   - **gh-pages branch:** `npx gh-pages -d dist`
   - **Actions:** a standard "upload-pages-artifact from `dist/`" workflow
     (build with Node 20+, `npm ci && npm run build`)
3. In the repo settings, point GitHub Pages at the branch/workflow you chose.

The ephemeris data files (`public/ephe/*.se1`, ≈ 2 MB, covering 1800–2399 AD)
and `public/swisseph.wasm` ship with the site, so the deployed app makes no
CDN or API calls for its calculations.

## How profiles and settings are stored

Everything lives in your browser's `localStorage` under the key
`lunarTracker.v1` — natal profiles, the active profile, the display location,
and the tropical/sidereal choice. Nothing is uploaded anywhere; there is no
cloud, no account, no database. Each friend saves their own profiles on their
own device (and per browser). Clearing site data deletes them, so note down
birth data somewhere safe. If `localStorage` is unavailable (e.g. some
private-browsing modes), the app keeps working for the visit and shows a
small notice.

## Pasting interpretive content

All interpretive text lives in [`src/content.js`](src/content.js) in the
`CONTENT` object — eight categories, 96 entries (12 signs / 12 houses each):

- `dailyMoonInSign`, `dailyMoonInHouse`
- `newMoonInSign`, `newMoonInHouse` (also used for **solar** eclipses)
- `fullMoonInSign`, `fullMoonInHouse` (also used for **lunar** eclipses)
- `firstQuarterInSign`, `lastQuarterInSign`

Two ritual entries — `newMoonRitual` and `fullMoonRitual` — appear on New
Moon and Full Moon days alongside the sign and house readings. Unlike the
sign/house entries they are generic (the same text for everyone), so they
also show for profiles with no birth time, and even with no profile at all.
Each has a `title` and a list of `parts`; give a part a `heading` to render a
sub-heading above it. Inside a part's text, lines starting `1.` … `12.`
render as numbered steps and lines starting `◗` as marked points — the words
themselves are shown verbatim, exactly like the other entries.

There is also `newMoonAffirmations` — per natal house, a list of short
affirmations shown as cursive quotes from the exact New Moon instant until 28
days later (they need a profile with a birth time, since they follow the New
Moon's natal house). They are on by default and can be switched off under
Settings → Display options.

Each entry sits between a pair of backticks. Paste your text exactly as you
have it, line breaks and all — it is rendered verbatim. Lines starting with
`◗` become styled sub-headings and the first line becomes the entry's title
line. Inside an entry only two characters need care: a backtick must be typed
as `` \` `` and `${` as `\${`. An empty entry renders as
"— content pending —", never a broken layout.

## Updating the eclipse table

[`src/eclipses.js`](src/eclipses.js) holds a static table of solar and lunar
eclipses (instants of greatest eclipse, UTC), sourced from the
[NASA eclipse catalog](https://eclipse.gsfc.nasa.gov/). It currently covers
2024–2028. **Update it annually**: append the coming year's eclipses and
optionally drop years that have fallen out of the app's ±2-year range.
`node tools/gen-eclipses.mjs` regenerates the instants with Swiss Ephemeris
(they agree with NASA to within a minute) — you only add the type labels.

## Nominatim usage policy

Place search calls the public OpenStreetMap Nominatim service. Per their
[usage policy](https://operations.osmfoundation.org/policies/nominatim/), the
app debounces requests to at least one second of typing silence, keeps at
most one request in flight, and sends the site's Referer. This is fine for
friends-scale hobby use; if the app ever grows beyond that, switch to a
commercial geocoder or self-hosted Nominatim. Results are used once at
profile/location creation — nothing is queried in bulk.

## Day-to-day workflow

Edit source, then commit and push `main` (GitHub Desktop). The
`.github/workflows/deploy.yml` workflow builds the app and publishes it to
GitHub Pages automatically — you never run a build by hand, and `dist/` stays
gitignored, so it is impossible to ship a stale build.

```
edit source → commit & push main → CI builds → GitHub Pages
```

The app's footer links to this repository as its AGPL source offer, so the
repository must stay public and the link must stay reachable. If the repo is
ever renamed or moved, update that link in `index.html`.

## Custom domain

The site is served at **https://lunar.daxyogatherapy.com**. Two things make
that work, and both must stay in place:

1. **`public/CNAME`** — contains the bare hostname. Vite copies `public/`
   verbatim into `dist/`, so every build republishes it. A `CNAME` at the repo
   root would *not* work: only what lands in `dist/` is served.
2. **Repo → Settings → Pages → Custom domain** — the durable setting, which is
   what survives Actions-based deploys. Keep "Enforce HTTPS" enabled.

DNS lives in Cloudflare: `lunar` **CNAME → dakusuyoga.github.io**, **DNS only
(grey cloud)**. Grey is deliberate — GitHub Pages has no origin IP to hide, and
proxying can interfere with GitHub provisioning its TLS certificate. Only
consider the orange cloud after the certificate is confirmed working.

`base: "./"` in `vite.config.js` is what lets the same build work both at a
domain root and under the `/Lunar_Tracker_App/` GitHub Pages sub-path. **Don't
change it to `/`** unless the sub-path URL is being abandoned.

Note that setting a custom domain makes the old
`dakusuyoga.github.io/Lunar_Tracker_App/` URL **redirect** to it. Since
`localStorage` is per-origin, profiles saved under the old address do not carry
over — everyone re-enters their birth details once. (Accounts, when they land,
end that problem for good.)

## Licensing (Swiss Ephemeris — AGPL)

This project uses the Swiss Ephemeris via the `sweph-wasm` package. Swiss
Ephemeris is licensed under the **AGPL** (or a paid professional license from
Astrodienst). The app ships the Swiss Ephemeris WebAssembly binary to every
visitor's browser, so the AGPL's source-availability requirement applies to
the live site — which is met by this repository being public and linked from
the app footer. The project as a whole is licensed **AGPL-3.0-or-later**.

Note that content exposure is inherent to a client-side app: every visitor's
browser downloads the whole app, including all interpretive content, so that
text is readable via browser dev tools regardless of licence. Making content
unreadable would require a backend that serves only the current day's text —
see the future phase below.

If you ever want to go closed-source or commercial, obtain a Swiss Ephemeris
professional license from Astrodienst instead.

## Accuracy notes

- Natal positions (Sun–Pluto, True Node, Chiron), ASC/MC and all twelve
  Placidus cusps for the reference chart (Dec 5 1980, 17:25, Beelitz-
  Heilstätten) match astro-seek.com within ~13 arc-seconds.
- Birth times convert through historical timezone rules (the 1980 Germany
  birth above converts as CET, 16:25 UTC).
- Rise/set times match timeanddate.com within a minute.
- The North Node is the **True Node** (matching astro-seek's default).
- With "time unknown", planets are computed at local noon of the birth date;
  houses, angles, and the natal Moon are omitted (the Moon moves ~12°/day).

## Planned future phase (not implemented)

A later phase may add self-hosted login with a PostgreSQL database so
profiles sync across devices. Nothing of that exists in this codebase — by
design there is no server code, no accounts, and no scaffolding for them;
the profile data model is just kept clean and serializable so a future
migration is straightforward.
