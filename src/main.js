/* ── Lunar Tracker — app bootstrap, state, rendering, forms ───────── */
import { DateTime, IANAZone } from "luxon";
import { initEphemeris, searchPhaseEvent } from "./ephemeris.js";
import {
  SIGNS, SIGN_GLYPHS, ORDINALS,
  signName, signKey, degInSign,
  natalFor, computeDay,
} from "./compute.js";
import { CONTENT } from "./content.js";
import { moonShadowPath } from "./moonicon.js";
import { loadState, saveState, storageAvailable } from "./store.js";
import { attachPlaceSearch, timezoneFor } from "./geocode.js";
import { supabase, currentSession } from "./supabase.js";
import { initAuth, signOut } from "./auth.js";
import { showScreen } from "./screens.js";
import {
  fetchProfileRow, rowToProfile, rowToLocation, saveProfileRow, saveDisplayLocation,
} from "./profile.js";
import { initCheckIn, syncTodayState } from "./checkinui.js";
import { startOutbox, pendingFor } from "./outbox.js";
import { fetchCheckIn, backfillPending } from "./checkin.js";
import { renderRecordCard } from "./recordcard.js";
import { initRecordScreen } from "./recordscreen.js";
import { toggleMarkup, fetchCompletions, setCompletion, eventDateOf } from "./rituals.js";
import { initHistory, openHistory } from "./history.js";

/* Which ceremonies are already marked for the lunation currently on
   screen. Loaded per lunation, not per day — a ritual window spans two
   calendar days, so the day is the wrong grain. */
let ritualsDone = new Set();
let ritualsLoadedFor = null;

const activeNatal = () => {
  const p = state.profiles.find((x) => x.id === state.activeProfileId);
  return p ? natalFor(p) : null;
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g,
  (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

/* ── State ──────────────────────────────────────────────────────── */

const state = loadState(); // { profiles, activeProfileId, location, zodiacMode }

// Time-travel range: today ± 2 years, computed at load time.
const todayISO = () => DateTime.now().setZone(state.location.timezone).toISODate();
const RANGE = (() => {
  const now = DateTime.now().setZone(state.location.timezone);
  return { min: now.minus({ years: 2 }).toISODate(), max: now.plus({ years: 2 }).toISODate() };
})();

let selectedDate = todayISO();

const clampDate = (iso) => (iso < RANGE.min ? RANGE.min : iso > RANGE.max ? RANGE.max : iso);

const activeProfile = () =>
  state.profiles.find((p) => p.id === state.activeProfileId) || null;

function persist() {
  saveState(state);
  $("storage-notice").hidden = storageAvailable();
}

/* ── Content rendering (verbatim text, light structure) ─────────── */

function contentOr(text) {
  if (!text || !String(text).trim()) {
    return `<p class="reading pending">— content pending —</p>`;
  }
  const lines = String(text).split("\n");
  const hasMarks = lines.some((l) => l.trim().startsWith("◗"));
  const out = [];
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    if (line.startsWith("◗")) {
      out.push(`<h4 class="reading-h"><span class="mark">◗ </span>${esc(line.slice(1).trim())}</h4>`);
    } else if (i === 0 && hasMarks) {
      out.push(`<p class="reading-title">${esc(line)}</p>`);
    } else {
      out.push(`<p class="reading">${esc(line)}</p>`);
    }
  });
  return out.join("");
}

/* Rituals: same verbatim treatment as the readings, plus numbered steps
   rendered with a hanging number and optional per-part sub-headings. */
/* `marks` maps a part heading to its ritual key, so the Full Moon panel's
   two ceremonies each get their own toggle beside their own sub-heading.
   The New Moon panel has one ceremony and takes `lead` instead. */
function ritualContent(ritual, marks = {}, lead = null, done = new Set()) {
  if (!ritual || !Array.isArray(ritual.parts)) {
    return `<p class="reading pending">— content pending —</p>`;
  }
  const out = [];
  if (lead) out.push(toggleMarkup(lead, done.has(lead)));
  for (const part of ritual.parts) {
    if (part.heading) {
      out.push(`<h4 class="ritual-h">${esc(part.heading)}</h4>`);
      const key = marks[part.heading];
      if (key) out.push(toggleMarkup(key, done.has(key)));
    }
    for (const raw of String(part.text || "").split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const step = /^(\d{1,2})\.\s+(.*)$/.exec(line);
      if (line.startsWith("◗")) {
        out.push(`<p class="ritual-do"><span class="mark">◗</span> ${esc(line.slice(1).trim())}</p>`);
      } else if (step) {
        out.push(`<p class="ritual-step"><span class="num">${esc(step[1])}.</span> <span>${esc(step[2])}</span></p>`);
      } else {
        out.push(`<p class="reading">${esc(line)}</p>`);
      }
    }
  }
  return out.join("");
}

/* `kind` is a stable identity for the panel (e.g. "sign", "house") so an
   open panel stays open across re-renders — including the minute-by-minute
   refresh on today, and the moment a reading is replaced at an ingress. */
function section(title, body, kind) {
  const k = kind ? ` data-kind="${kind}"` : "";
  return `<details class="entry"${k}><summary><h3>${title}</h3><span class="disclose" aria-hidden="true">＋</span></summary><div class="entry-body">${body}</div></details>`;
}

const fmtDay = (date) =>
  DateTime.fromJSDate(date).setZone(state.location.timezone).toFormat("LLL d");

/* The moment a phase event is exact, and — for eclipses — what it actually
   looks like from here. The catalogued eclipse type is global: telling
   someone in Toronto "Total Solar Eclipse" when the Sun is below their
   horizon is worse than telling them nothing. */
function eventExactLine(day) {
  if (day.eclipse) {
    const e = day.eclipse;
    const loc = e.local;
    const where = state.location.displayName;
    if (!loc || !loc.visible) {
      const why = loc && loc.altitude != null && loc.altitude <= 0
        ? e.kind === "solar" ? " — the Sun is below the horizon" : " — the Moon is below the horizon"
        : "";
      return `Greatest eclipse ${fmtTime(e.instant)} · not visible from ${where}${why}`;
    }
    const when = fmtTime(loc.localInstant || e.instant);
    if (e.kind === "solar") {
      const pct = Math.round(loc.obscuration * 100);
      return `Maximum ${when} · ${pct}% of the Sun covered from ${where}`;
    }
    const um = loc.umbralMag;
    const how = um >= 1 ? "the Moon fully in shadow"
      : um > 0 ? `${Math.round(um * 100)}% of the Moon in shadow`
      : "penumbral only — a faint shading";
    return `Greatest ${when} · ${how}, visible from ${where}`;
  }

  const ev =
    (day.newMoonWindow && day.newMoonWindow.onThisDay && day.newMoonWindow) ||
    (day.fullMoonWindow && day.fullMoonWindow.onThisDay && day.fullMoonWindow) ||
    day.firstQuarter || day.lastQuarter;
  return ev ? `Exact at ${fmtTime(ev.instant)}` : "";
}

/* What the phase does next. On a moon app this is the question people
   actually arrive with, and until now nothing on the page answered it. */
function nextEventsLine(day) {
  const n = day.nextEvents;
  if (!n) return "";
  const bits = [];
  if (n.newMoon) bits.push(`New Moon ${fmtDay(n.newMoon)}`);
  if (n.fullMoon) bits.push(`Full Moon ${fmtDay(n.fullMoon)}`);
  if (!bits.length) return "";
  // Soonest first — "next" should read as next.
  if (n.newMoon && n.fullMoon && n.fullMoon < n.newMoon) bits.reverse();
  return `Next · ${bits.join(" · ")}`;
}

/* The sign line, in three forms:
     today, change still ahead → "♉ Moon in Taurus · 27°10′ · tropical → Gemini from 4:12 pm"
     today, change already past → "♊ Moon in Gemini · 0°15′ · tropical · since 4:12 pm"
     past / future             → "♉ Taurus until 4:12 pm · ♊ Gemini after · tropical" */
/* Zodiac glyphs need the design's .glyph wrapper: it forces text (not
   colour-emoji) presentation and gives them the display face. Bare, they
   get picked up by the system emoji font and render as coloured tiles. */
const glyph = (i) => `<span class="glyph">${SIGN_GLYPHS[i]}</span>`;

/* The zodiac is named as a proper noun in the interface. The stored value
   stays lowercase — it's a state key and a localStorage value, and
   capitalising it would orphan every saved preference. Display only. */
const modeLabel = () => (state.zodiacMode === "sidereal" ? "Sidereal" : "Tropical");

function signLine(day) {
  const idx = day.moonSignIndex;
  const plain = `Moon in ${SIGNS[idx]} · ${degInSign(day.moonLon)} · ${modeLabel()}`;
  const segs = day.signSegments;
  if (state.showTransitions === false || !segs || segs.length < 2) {
    return `${glyph(idx)} ${esc(plain)}`;
  }

  if (!day.isToday) {
    const span = segs.map((s, i) =>
      i === segs.length - 1
        ? `${glyph(s.value)} ${esc(`${SIGNS[s.value]} after`)}`
        : `${glyph(s.value)} ${esc(`${SIGNS[s.value]} until ${fmtTime(s.to)}`)}`
    ).join(" · ");
    return `${span} · ${esc(modeLabel())}`;
  }

  const active = activeSegment(segs, day.anchor);
  const i = segs.indexOf(active);
  const next = segs[i + 1];
  const note = next
    ? `<span class="ingress">→ ${glyph(next.value)} ${esc(`${SIGNS[next.value]} from ${fmtTime(next.from)}`)}</span>`
    : `<span class="ingress">${esc(`since ${fmtTime(active.from)}`)}</span>`;
  return `${glyph(idx)} ${esc(plain)} ${note}`;
}

/* The same treatment for the natal-house line under the moon card. Built
   from the segments rather than appended to the anchor's house — on a past
   or future day the anchor sits in one segment while the line has to name
   the house the day *starts* in. */
/* In Sidereal the houses are whole sign, so a house boundary IS a sign
   boundary and both lines would quote the same clock time. The house line
   drops its times in that case — the sign line above already carries them,
   and the house number is the only thing this line adds. */
function housesFollowSigns(day) {
  const h = day.houseSegments, s = day.signSegments;
  if (!h || !s || h.length !== s.length) return false;
  return h.every((seg, i) => Math.abs(seg.from - s[i].from) < 1000);
}

function houseLine(day) {
  const segs = day.houseSegments;
  const plain = `Moon transiting the ${ORDINALS[day.house]} house`;
  if (state.showTransitions === false || !segs || segs.length < 2) return esc(plain);

  const echoes = housesFollowSigns(day);

  if (!day.isToday) {
    const span = segs.map((s, i) =>
      i === segs.length - 1
        ? `${ORDINALS[s.value]}${echoes ? "" : " after"}`
        : `${ORDINALS[s.value]}${echoes ? "" : ` until ${fmtTime(s.to)}`}`
    ).join(echoes ? ", then the " : " · ");
    return esc(`Moon transiting the ${span}`);
  }

  const active = activeSegment(segs, day.anchor);
  const next = segs[segs.indexOf(active) + 1];
  const head = esc(`Moon transiting the ${ORDINALS[active.value]} house`);
  // Nothing left to say once the time is dropped and the change has passed.
  if (echoes && !next) return head;
  const note = next
    ? `→ ${ORDINALS[next.value]}${echoes ? "" : ` from ${fmtTime(next.from)}`}`
    : `since ${fmtTime(active.from)}`;
  return `${head} <span class="ingress">${esc(note)}</span>`;
}

/* The active segment is the one containing the anchor; on past/future dates
   the anchor is noon, which is still a segment of that day. */
function activeSegment(segments, anchor) {
  const t = anchor.getTime();
  return segments.find((s) => t >= s.from.getTime() && t < s.to.getTime())
    || segments[segments.length - 1];
}

// "until 4:12 pm" / "from 4:12 pm" / "4:12 pm – 9:30 pm" — a qualifier on a
// panel title, only meaningful when a day has more than one segment.
function segmentRange(segments, i) {
  if (segments.length < 2 || state.showTransitions === false) return "";
  if (i === 0) return `until ${fmtTime(segments[0].to)}`;
  if (i === segments.length - 1) return `from ${fmtTime(segments[i].from)}`;
  return `${fmtTime(segments[i].from)} – ${fmtTime(segments[i].to)}`;
}

/* Which segments get a reading panel:
   today → the active one, plus the others only if the user asked for them;
   past/future → all of them, since there is no "now" to choose between. */
function segmentsToRender(segments, day) {
  if (!segments) return [];
  const all = segments.map((seg, i) => ({ seg, i }));
  if (!day.isToday || state.showBothReadings) {
    const active = activeSegment(segments, day.anchor);
    // Active first, the rest in time order beneath it.
    return day.isToday ? [...all].sort((a, b) =>
      (a.seg === active ? -1 : 0) - (b.seg === active ? -1 : 0)) : all;
  }
  const active = activeSegment(segments, day.anchor);
  return all.filter(({ seg }) => seg === active);
}

/* ── Rendering ──────────────────────────────────────────────────── */

let affirmationTimer = null;

function fmtTime(date) {
  if (!date) return "—";
  return DateTime.fromJSDate(date).setZone(state.location.timezone)
    .toFormat("h:mm a").toLowerCase();
}

function render() {
  const profile = activeProfile();
  const natal = profile ? natalFor(profile) : null;
  const day = computeDay(selectedDate, state.location, natal, state.zodiacMode);

  // Date head
  $("date-display").textContent = day.noonDT.toFormat("cccc, LLLL d, yyyy");
  $("date-input").value = selectedDate;

  // Astronomical card
  /* Update only the shadow's geometry. The photo and glow are siblings in
     the markup — replacing #moon-icon wholesale would re-create the <img>
     on every minute-tick and flicker. */
  const shadow = $("moon-shadow");
  const d = moonShadowPath(day.phaseAngle);
  shadow.setAttribute("d", d || "M 0 0");
  shadow.style.display = d ? "" : "none";
  let phaseLabel = esc(day.phase);
  if (day.eclipse) {
    const label = day.eclipse.kind === "solar" ? "Solar Eclipse" : "Lunar Eclipse";
    phaseLabel += ` <span class="badge">${esc(day.eclipse.type)} ${label}</span>`;
  }
  $("phase-name").innerHTML = phaseLabel;
  $("illum").textContent = `${(day.illum * 100).toFixed(0)}% illuminated`;
  const exact = eventExactLine(day);
  $("event-exact").textContent = exact;
  $("event-exact").hidden = !exact;
  $("next-events").textContent = nextEventsLine(day);
  $("moon-sign").innerHTML = signLine(day);
  $("moonrise").textContent = fmtTime(day.moonTimes.rise);
  $("moonset").textContent = fmtTime(day.moonTimes.set);
  $("sunrise").textContent = fmtTime(day.sunTimes.rise);
  $("sunset").textContent = fmtTime(day.sunTimes.set);
  $("location-label").textContent = state.location.displayName;

  // Transits: natal house + conjunctions
  let transit = "";
  if (!profile) {
    transit = `<p class="transit-note">Create a natal profile to see house placements and conjunctions.</p>
      <button class="cta" id="cta-profile" type="button">＋ Create profile</button>`;
  } else if (natal.invalid) {
    transit = `<p class="transit-note">This profile's birth data could not be interpreted (${esc(natal.reason)}). Edit the profile to fix it.</p>`;
  } else {
    if (day.house != null) {
      transit += `<p class="transit-house">${houseLine(day)}</p>`;
    }
    if (day.conjunctions.length) {
      transit += day.conjunctions.map((c) =>
        `<p class="conj">Moon <span class="glyph">☌︎</span> ${esc(c.label)} <span class="orb">(orb ${c.orb.toFixed(1)}°)</span></p>`
      ).join("");
    } else {
      transit += `<p class="conj none">No natal conjunctions today</p>`;
    }
    if (natal.timeUnknown) {
      transit += `<p class="transit-note">positions approximate (no birth time)</p>`;
      transit += `<p class="transit-note">Add a birth time to see house placements and angle conjunctions.</p>`;
    }
  }
  $("transits").innerHTML = transit;
  const cta = $("cta-profile");
  if (cta) cta.addEventListener("click", () => openProfileForm(null));

  // New Moon affirmations — free-floating cursive quotes (default on,
  // toggleable in Settings). House-keyed, so they need a birth time.
  let affHTML = "";
  if (state.showAffirmations !== false && day.affirmations) {
    const list = (CONTENT.newMoonAffirmations || {})[day.affirmations.house] || [];
    const texts = list.filter((t) => t && String(t).trim());
    affHTML = texts.map((t) => `<p class="affirmation">‘${esc(t)}’</p>`).join("");
  }
  $("affirmations").innerHTML = affHTML;

  // When viewing today, re-render at the exact instant of the next New
  // Moon so the affirmations switch over on time.
  clearTimeout(affirmationTimer);
  if (day.isToday && state.showAffirmations !== false) {
    const now = new Date();
    const next = searchPhaseEvent(0, now, new Date(now.getTime() + 32 * 86400000));
    if (next) {
      const ms = next.getTime() - Date.now();
      if (ms > 0 && ms < 36 * 3600000) {
        affirmationTimer = setTimeout(render, ms + 2000);
      }
    }
  }

  // Interpretive readings
  const withHouses = natal && !natal.invalid && natal.cusps;
  const parts = [];
  /* One reading per segment of the day. On today that is just the sign the
     Moon is in right now — the panel is replaced when it moves on. Other
     dates have no "now", so every sign the day covers is shown, each tagged
     with the stretch it applies to. */
  const qualify = (title, range) =>
    range ? `${title} <span class="seg-range">${esc(range)}</span>` : title;

  /* New/full moon text shows on the event day and, via the ±12h window, on
     one adjacent day. Without saying when the event actually was, a reader
     on the adjacent day has no way to tell why a Full Moon reading is on a
     day that isn't the full moon. */
  const eventWhen = (w) =>
    state.showTransitions === false ? ""
      : w.onThisDay ? `exact at ${fmtTime(w.instant)}`
      : `${fmtDay(w.instant)}, ${fmtTime(w.instant)}`;

  for (const { seg, i } of segmentsToRender(day.signSegments, day)) {
    parts.push(section(
      qualify(`Moon in ${SIGNS[seg.value]}`, segmentRange(day.signSegments, i)),
      contentOr(CONTENT.dailyMoonInSign[SIGNS[seg.value].toLowerCase()]),
      `sign-${i}`));
  }
  if (withHouses && day.houseSegments) {
    for (const { seg, i } of segmentsToRender(day.houseSegments, day)) {
      parts.push(section(
        qualify(`Moon in your ${ORDINALS[seg.value]} house`, segmentRange(day.houseSegments, i)),
        contentOr(CONTENT.dailyMoonInHouse[seg.value]),
        `house-${i}`));
    }
  }
  if (day.newMoonWindow) {
    const w = day.newMoonWindow;
    const label = day.eclipse && day.eclipse.kind === "solar" ? "Solar Eclipse" : "New Moon";
    const when = eventWhen(w);
    parts.push(section(qualify(`${label} in ${esc(w.sign)}`, when),
      contentOr(CONTENT.newMoonInSign[w.signKey]), "newmoon-sign"));
    if (withHouses && w.house != null) {
      parts.push(section(qualify(`${label} in your ${ORDINALS[w.house]} house`, when),
        contentOr(CONTENT.newMoonInHouse[w.house]), "newmoon-house"));
    }
  }

  /* The wishing ritual keeps its own, asymmetric window — open only from
     the exact New Moon forward — so it is rendered outside the ±12h block
     above. It is generic content: no profile or birth time needed. */
  if (day.wishingWindow) {
    const timing = `<p class="ritual-timing">New Moon exact at ${esc(fmtTime(day.wishingWindow.instant))} — wishes count from then.</p>`;
    parts.push(section(esc((CONTENT.newMoonRitual || {}).title || "New Moon Ritual"),
      timing + ritualContent(CONTENT.newMoonRitual, {}, "new_moon_wishing", ritualsDone),
      "newmoon-ritual"));
  } else if (day.wishingOpensAt) {
    // Don't let the ritual just be missing on the day of the New Moon.
    parts.push(`<p class="ritual-timing standalone">The New Moon is exact at ${esc(fmtTime(day.wishingOpensAt))} — the wishing window opens then.</p>`);
  }
  if (day.fullMoonWindow) {
    const w = day.fullMoonWindow;
    const label = day.eclipse && day.eclipse.kind === "lunar" ? "Lunar Eclipse" : "Full Moon";
    const when = eventWhen(w);
    parts.push(section(qualify(`${label} in ${esc(w.sign)}`, when),
      contentOr(CONTENT.fullMoonInSign[w.signKey]), "fullmoon-sign"));
    if (withHouses && w.house != null) {
      parts.push(section(qualify(`${label} in your ${ORDINALS[w.house]} house`, when),
        contentOr(CONTENT.fullMoonInHouse[w.house]), "fullmoon-house"));
    }
    // Today only, for the same reason as the wishing ritual: it is
    // something to do tonight, not something to read about afterwards.
    if (day.isToday) {
      const timing = `<p class="ritual-timing">Full Moon exact at ${esc(fmtTime(w.instant))}.</p>`;
      parts.push(section(esc((CONTENT.fullMoonRitual || {}).title || "Full Moon Ritual"),
        timing + ritualContent(CONTENT.fullMoonRitual, {
          "Full Moon Forgiveness Ceremony": "full_moon_forgiveness",
          "Entering a State of Gratitude": "full_moon_gratitude",
        }, null, ritualsDone),
        "fullmoon-ritual"));
    }
  }
  if (day.firstQuarter) {
    parts.push(section(`Waxing Quarter Moon in ${esc(day.firstQuarter.sign)}`,
      contentOr(CONTENT.firstQuarterInSign[day.firstQuarter.signKey])));
  }
  if (day.lastQuarter) {
    parts.push(section(`Waning Quarter Moon in ${esc(day.lastQuarter.sign)}`,
      contentOr(CONTENT.lastQuarterInSign[day.lastQuarter.signKey])));
  }
  /* Re-rendering rebuilds these panels, so carry the open ones across.
     Keying on `data-kind` rather than the title means an expanded reading
     stays expanded when an ingress replaces it with the next sign. */
  const wasOpen = new Set(
    [...$("readings").querySelectorAll("details[open]")].map((d) => d.dataset.kind)
  );
  $("readings").innerHTML = parts.join('<hr class="rule">');
  for (const d of $("readings").querySelectorAll("details")) {
    if (wasOpen.has(d.dataset.kind)) d.open = true;
  }

  /* The saved check-in for whichever date is being viewed. Fetched
     asynchronously so the daily view never waits on the network to draw;
     the card simply appears when the answer arrives. The outbox copy wins,
     because it exists before the row has reached Postgres. */
  if (account) {
    const forDate = selectedDate;
    const queued = pendingFor(forDate);
    if (queued) {
      renderRecordCard(queued.row, forDate, state.location.timezone);
    } else {
      renderRecordCard(null, forDate, state.location.timezone);
      fetchCheckIn(account.id, forDate).then((row) => {
        // Ignore a late reply for a date the user has already left.
        if (row && selectedDate === forDate) {
          renderRecordCard(row, forDate, state.location.timezone);
        }
      });
    }
  }

  /* Ritual toggles reflect the lunation on screen. Fetched once per
     lunation and re-rendered when the answer lands, so the panels draw
     immediately rather than waiting on the network. */
  const lunation = day.wishingWindow?.instant || (day.isToday && day.fullMoonWindow?.instant);
  if (account && lunation) {
    const key = eventDateOf(lunation);
    if (ritualsLoadedFor !== key) {
      ritualsLoadedFor = key;
      fetchCompletions(account.id, key).then((set) => {
        ritualsDone = set;
        if (ritualsLoadedFor === key) render();
      });
    }
  } else {
    ritualsLoadedFor = null;
    ritualsDone = new Set();
  }

  // Header state
  renderProfileSelect();
  /* `is-active` is the design's segmented-control state class — it also
     drives aria-selected, so set both rather than only the styling. */
  for (const [id, mode] of [["mode-tropical", "tropical"], ["mode-sidereal", "sidereal"]]) {
    const on = state.zodiacMode === mode;
    $(id).classList.toggle("is-active", on);
    $(id).setAttribute("aria-selected", String(on));
  }
}

/* Today's view is read at the current moment, so it goes stale on its own:
   the Moon moves ~0.55°/hour and can change sign or house mid-session.
   Re-render each minute, and again whenever the tab is brought back — a
   screen left open overnight would otherwise still be showing yesterday. */
/* The design ships a proper boot-failure state; use it rather than
   replacing the loading screen with bare paragraphs. The technical detail
   stays visible on purpose — it is what gets read out over a message when
   someone's app won't start. */
function showBootError(e) {
  const box = document.querySelector(".boot-error");
  if (!box) return;
  document.querySelector(".boot-bar")?.setAttribute("hidden", "");
  document.querySelector(".boot-title")?.setAttribute("hidden", "");
  document.querySelector(".boot-note")?.setAttribute("hidden", "");
  const trace = box.querySelector(".boot-trace");
  if (trace) {
    trace.textContent =
      `${(e && e.name) || "Error"}: ${(e && e.message) || e}\n` +
      "If reloading doesn't help: on iPhone, Lockdown Mode blocks this app — " +
      "tap “aA” in the address bar → Website Settings → allow this site.";
  }
  box.hidden = false;
  box.querySelector('[data-action="retry-boot"]')
    ?.addEventListener("click", () => window.location.reload());
}

/* Shown when we can't tell whether the account has a chart. Deliberately
   NOT the first-run screen: inviting someone to re-enter birth details
   they already have is how a chart gets silently replaced. */
function showProfileUnreachable() {
  const card = document.querySelector("#screen-first-run .card-setup");
  showScreen("screen-first-run");
  if (!card) return;
  const title = card.querySelector(".display-title");
  const lede = card.querySelector(".lede");
  const cta = card.querySelector(".cta");
  const btn = $("cta-first-run");
  if (title) title.textContent = "Couldn't load your chart.";
  if (lede) {
    lede.textContent =
      "We reached your account but not your chart, so we don't know whether " +
      "you've set one up. Nothing has been changed.";
  }
  if (cta) cta.hidden = true;
  if (btn) {
    btn.textContent = "Try again";
    btn.onclick = () => window.location.reload();
  }
}

/* The signed-in account, or null. Kept module-level because the check-in
   and ritual writes all need the user id. */
let account = null;
let profileRow = null;

/* Which screen a session implies: no session → login; session but no chart
   yet → first run; otherwise the daily view. */
async function applySession(session) {
  account = session ? session.user : null;

  if (!account) {
    profileRow = null;
    state.profiles = [];
    state.activeProfileId = null;
    showScreen("screen-login");
    return;
  }

  const mail = document.querySelector(".menu-mail");
  const name = document.querySelector(".menu-name");
  if (mail) mail.textContent = account.email || "";

  /* "No chart yet" and "couldn't find out" are different answers, and
     conflating them is dangerous: an existing user dropped into first run
     would enter their birth details again, overwriting a chart that was
     only ever unreachable. So a failed read says so and offers a retry. */
  try {
    profileRow = await fetchProfileRow(account.id);
  } catch (e) {
    console.error("profile read failed", e);
    showProfileUnreachable();
    return;
  }

  if (!profileRow) {
    state.profiles = [];
    state.activeProfileId = null;
    showScreen("screen-first-run");
    return;
  }

  // One row, mapped into the array shape the rest of the app expects.
  const profile = rowToProfile(profileRow);
  state.profiles = [profile];
  state.activeProfileId = profile.id;
  state.location = rowToLocation(profileRow);
  if (name) name.textContent = profile.name;
  document.querySelector(".menu-head").hidden = false;

  showScreen("screen-daily");
  render();

  // Anything the outbox is still holding goes now that we have a session.
  startOutbox(supabase);
  await syncTodayState();

  initHistory({
    userId: account.id,
    timezone: state.location.timezone,
    onPick: (dateISO) => setDate(dateISO),
  });

  initRecordScreen({
    userId: () => account.id,
    timezone: () => state.location.timezone,
    selectedDate: () => selectedDate,
  });

  /* Any check-in saved while the engine was cold gets its moon-context
     now. Runs once per session, in the background: it changes nothing the
     user is looking at, and a failure simply leaves the rows pending for
     next time. */
  backfillPending(account.id, activeNatal(), profileRow)
    .then(({ filled }) => { if (filled) console.info(`backfilled ${filled} check-in(s)`); })
    .catch((e) => console.warn("backfill skipped", e));
}

function startLiveClock() {
  let lastToday = todayISO();
  const tick = () => {
    const now = todayISO();
    if (now !== lastToday) {
      // Midnight passed. A screen sitting on "today" should follow the date
      // over rather than quietly become a stale yesterday.
      if (selectedDate === lastToday) selectedDate = now;
      lastToday = now;
      render();
      return;
    }
    if (selectedDate === now) render();
  };
  setInterval(tick, 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) tick();
  });
  window.addEventListener("focus", tick);
}

function renderProfileSelect() {
  /* The design's account button carries a name. Until V2 there are no
     accounts, so it shows the active chart's name — and nothing at all
     rather than a placeholder when there isn't one. The button still opens
     the menu either way; Location, Display and About don't need a profile. */
  const active = state.profiles.find((p) => p.id === state.activeProfileId);
  const label = document.querySelector(".account-name");
  if (label) label.textContent = active ? active.name : "";

  const sel = $("profile-select");
  sel.innerHTML = "";
  if (!state.profiles.length) {
    const opt = document.createElement("option");
    opt.textContent = "— no profiles —";
    opt.value = "";
    sel.appendChild(opt);
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  for (const p of state.profiles) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  }
  sel.value = state.activeProfileId || state.profiles[0].id;
}

/* ── Date navigation ────────────────────────────────────────────── */

function setDate(iso) {
  selectedDate = clampDate(iso);
  render();
}
const shiftDate = (days) =>
  setDate(DateTime.fromISO(selectedDate).plus({ days }).toISODate());

/* ── Profile form ───────────────────────────────────────────────── */

const profileDialog = $("profile-dialog");
let editingProfileId = null;   // null = creating
let pfPickedPlace = null;      // {displayName, latitude, longitude} from search
let pfTzAuto = true;

/* The chart at rest. The design shows the stored values as a read-only
   card — name, date, time, then a rule, then place with its timezone
   beneath — and keeps the form behind an Edit button. That is gentler than
   opening a form full of inputs every time someone wants to check what
   their birth time is set to. */
function renderProfileList() {
  const box = $("profile-list");
  const p = state.profiles[0];
  if (!p) { box.innerHTML = ""; return; }

  const date = DateTime.fromISO(p.birthDate).toFormat("d LLLL yyyy");
  const time = p.timeUnknown ? "Not known" : p.birthTime;

  /* "(auto)" is only truthful when the zone really is the one the
     coordinates imply — so derive it rather than assert it. */
  const auto = timezoneFor(p.place.latitude, p.place.longitude) === p.timezone;

  box.innerHTML =
    `<p class="datum"><span class="micro-label">Profile name</span>` +
      `<span class="value">${esc(p.name)}</span></p>` +
    `<div class="field-row">` +
      `<p class="datum"><span class="micro-label">Birth date</span>` +
        `<span class="value">${esc(date)}</span></p>` +
      `<p class="datum"><span class="micro-label">Birth time</span>` +
        `<span class="value">${esc(time)}</span></p>` +
    `</div>` +
    `<hr class="rule">` +
    `<p class="datum"><span class="micro-label">Birth place</span>` +
      `<span class="value">${esc(p.place.displayName)}</span>` +
      `<span class="helper">${esc(p.timezone)}${auto ? " (auto)" : ""}</span></p>`;
}

/* Two states in one dialog: the chart at rest, and the form. */
function showProfileView(formMode) {
  $("profile-list-view").hidden = formMode;
  $("profile-form").hidden = !formMode;
}

/* "Your chart" opens the card; first run and Edit open the form. */
function openChartDialog() {
  const p = state.profiles[0];
  if (!p) { openProfileForm(null); return; }
  renderProfileList();
  showProfileView(false);
  if (!profileDialog.open) profileDialog.showModal();
}

function openProfileForm(profile) {
  editingProfileId = profile ? profile.id : null;
  pfPickedPlace = profile ? { ...profile.place } : null;
  pfTzAuto = profile ? profile.timezoneAuto !== false : true;
  $("profile-form-title").textContent = profile ? "Edit profile" : "New profile";
  $("pf-name").value = profile ? profile.name : "";
  $("pf-date").value = profile ? profile.birthDate : "";
  $("pf-time").value = profile && profile.birthTime ? profile.birthTime : "";
  $("pf-time-unknown").checked = profile ? !!profile.timeUnknown : false;
  $("pf-time").disabled = $("pf-time-unknown").checked;
  $("pf-place").value = "";
  /* A chart built from hand-typed coordinates looks identical to one
     picked from the map, so say when it isn't. The tell is the label: with
     no place name to store, the form falls back to the bare lat/lon pair.
     Half a degree of longitude moves every Placidus cusp. */
  const chosen = $("pf-place-chosen");
  if (!profile) {
    chosen.textContent = "";
  } else if (/^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(profile.place.displayName.trim())) {
    chosen.innerHTML =
      `Selected: ${esc(profile.place.displayName)} ` +
      `<span class="hint">— entered as coordinates, so this location is approximate. ` +
      `Search for the place name if you can; it moves the house cusps.</span>`;
  } else {
    chosen.textContent = `Selected: ${profile.place.displayName}`;
  }
  $("pf-lat").value = profile ? profile.place.latitude : "";
  $("pf-lon").value = profile ? profile.place.longitude : "";
  $("pf-manual").open = false;
  $("pf-tz").value = profile ? profile.timezone : "";
  $("pf-tz-auto").hidden = !pfTzAuto || !$("pf-tz").value;
  $("pf-error").hidden = true;
  showProfileView(true);
  if (!profileDialog.open) profileDialog.showModal();
}

function pfSetTimezoneFromCoords() {
  if (!pfTzAuto) return;
  const lat = parseFloat($("pf-lat").value);
  const lon = parseFloat($("pf-lon").value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  const tz = timezoneFor(lat, lon);
  if (tz) {
    $("pf-tz").value = tz;
    $("pf-tz-auto").hidden = false;
  }
}

function validCoords(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

async function pfSubmit(ev) {
  ev.preventDefault();
  const errEl = $("pf-error");
  const fail = (msg) => { errEl.textContent = msg; errEl.hidden = false; };

  const name = $("pf-name").value.trim();
  if (!name) return fail("Please enter a profile name.");

  const birthDate = $("pf-date").value;
  if (!birthDate || !DateTime.fromISO(birthDate).isValid) {
    return fail("Please enter a valid birth date.");
  }
  if (birthDate < "1800-01-01" || birthDate > "2399-12-31") {
    return fail("Birth date must be between 1800 and 2399 (ephemeris range).");
  }

  const timeUnknown = $("pf-time-unknown").checked;
  const birthTime = timeUnknown ? null : $("pf-time").value;
  if (!timeUnknown && !/^\d{2}:\d{2}$/.test(birthTime || "")) {
    return fail("Please enter a birth time, or tick “Time unknown”.");
  }

  const lat = parseFloat($("pf-lat").value);
  const lon = parseFloat($("pf-lon").value);
  if (!validCoords(lat, lon)) {
    return fail("Please pick a birth place from the search results or enter coordinates manually.");
  }
  const displayName =
    (pfPickedPlace && pfPickedPlace.latitude === lat && pfPickedPlace.longitude === lon)
      ? pfPickedPlace.displayName
      : ($("pf-place").value.trim() || `${lat.toFixed(3)}, ${lon.toFixed(3)}`);

  const timezone = $("pf-tz").value.trim();
  if (!timezone || !IANAZone.isValidZone(timezone)) {
    return fail("Please choose a valid IANA timezone (e.g. Europe/Berlin).");
  }

  if (!account) return fail("You're signed out. Log in again to save your chart.");

  const profile = {
    id: account.id,          // one chart per account: the user IS the key
    name,
    birthDate,
    birthTime,
    timeUnknown,
    place: { displayName, latitude: lat, longitude: lon },
    timezone,
    timezoneAuto: pfTzAuto,
  };

  /* Compute the natal chart here and store it as degrees. The database
     keeps raw longitudes, never signs or houses — degrees convert to
     either zodiac, whereas a stored word like "scorpio" is already
     committed to one and can't be flipped. Same rule as natal_snapshot. */
  let natalData;
  try {
    const natal = natalFor(profile);
    if (natal.invalid) return fail(`That birth data couldn't be interpreted (${natal.reason}).`);
    natalData = {
      natal_utc: natal.utcISO,
      ayanamsa: natal.ayanamsa,
      time_unknown: natal.timeUnknown,
      /* Per mode, because they genuinely differ: the house system is a
         property of how a chart is read, not of the chart itself. Recorded
         so a later recompute knows which convention produced a stored
         house, and can tell rows written before this split apart from
         rows written after. */
      house_system: { tropical: "placidus", sidereal: "whole_sign" },
      algo_version: 1,
      points: natal.points,
      angles: natal.angles || null,
      cusps: natal.cusps || null,
    };
  } catch (e) {
    return fail(`Couldn't compute the chart: ${(e && e.message) || e}`);
  }

  const submit = $("profile-form").querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    profileRow = await saveProfileRow(account.id, profile, natalData, profileRow);
  } catch (e) {
    submit.disabled = false;
    return fail(`Couldn't save: ${(e && e.message) || e}`);
  }
  submit.disabled = false;

  state.profiles = [rowToProfile(profileRow)];
  state.activeProfileId = account.id;
  const nameEl = document.querySelector(".menu-name");
  if (nameEl) nameEl.textContent = profile.name;

  profileDialog.close();
  showScreen("screen-daily");
  render();

  /* A new account has a timezone (inferred from the device) but no place,
     and the place is what moonrise, moonset, sunrise and sunset are
     computed from. Ask once, right after the chart exists — rather than
     quietly showing someone in Hanoi the times for Toronto. */
  if (!profileRow.display_tz) openLocationForm();
}

/* ── Display-location form ──────────────────────────────────────── */

const settingsDialog = $("settings-dialog");
let locPickedPlace = null;
let locTzAuto = true;

function openLocationForm() {
  locPickedPlace = { ...state.location };
  locTzAuto = true;
  $("loc-place").value = "";
  $("loc-place-chosen").textContent = `Current: ${state.location.displayName}`;
  $("loc-lat").value = state.location.latitude;
  $("loc-lon").value = state.location.longitude;
  $("loc-manual").open = false;
  $("loc-tz").value = state.location.timezone;
  $("loc-tz-auto").hidden = true;
  $("loc-error").hidden = true;
  $("opt-affirmations").checked = state.showAffirmations !== false;
  $("opt-transitions").checked = state.showTransitions !== false;
  $("opt-both-readings").checked = state.showBothReadings === true;
  settingsDialog.showModal();
}

function locSetTimezoneFromCoords() {
  if (!locTzAuto) return;
  const lat = parseFloat($("loc-lat").value);
  const lon = parseFloat($("loc-lon").value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  const tz = timezoneFor(lat, lon);
  if (tz) {
    $("loc-tz").value = tz;
    $("loc-tz-auto").hidden = false;
  }
}

function locSubmit(ev) {
  ev.preventDefault();
  const errEl = $("loc-error");
  const fail = (msg) => { errEl.textContent = msg; errEl.hidden = false; };

  const lat = parseFloat($("loc-lat").value);
  const lon = parseFloat($("loc-lon").value);
  if (!validCoords(lat, lon)) {
    return fail("Please pick a city from the search results or enter coordinates manually.");
  }
  const displayName =
    (locPickedPlace && locPickedPlace.latitude === lat && locPickedPlace.longitude === lon)
      ? locPickedPlace.displayName
      : ($("loc-place").value.trim() || `${lat.toFixed(3)}, ${lon.toFixed(3)}`);

  const timezone = $("loc-tz").value.trim();
  if (!timezone || !IANAZone.isValidZone(timezone)) {
    return fail("Please choose a valid IANA timezone (e.g. America/Toronto).");
  }

  state.location = { displayName, latitude: lat, longitude: lon, timezone };

  /* Display location belongs to the account, not the device: it decides
     which local day a check-in belongs to, and that day is part of the
     row's identity. Two devices set differently would disagree about what
     "today" is. Saved locally too, so the view survives a failed write. */
  persist();
  if (account) {
    saveDisplayLocation(account.id, state.location)
      .catch((e) => console.warn("display location not saved to the account", e));
  }

  settingsDialog.close();
  selectedDate = clampDate(selectedDate);
  render();
}

/* ── Wiring ─────────────────────────────────────────────────────── */

function wire() {
  // Date navigation
  $("prev-day").addEventListener("click", () => shiftDate(-1));
  $("next-day").addEventListener("click", () => shiftDate(+1));
  $("today-btn").addEventListener("click", () => setDate(todayISO()));
  const dateInput = $("date-input");
  dateInput.min = RANGE.min;
  dateInput.max = RANGE.max;
  dateInput.addEventListener("change", () => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput.value)) setDate(dateInput.value);
  });

  // Zodiac mode (persisted)
  const setMode = (mode) => {
    state.zodiacMode = mode;
    persist();
    render();
  };
  $("mode-tropical").addEventListener("click", () => setMode("tropical"));
  $("mode-sidereal").addEventListener("click", () => setMode("sidereal"));

  // Header
  $("profile-select").addEventListener("change", (e) => {
    if (!e.target.value) return;
    state.activeProfileId = e.target.value;
    persist();
    render();
  });
  /* The design moved the occasional actions behind an account menu, and
     split the old single Settings dialog into Location / Display / About.
     `#manage-profiles` is now the account button that opens that menu. */
  const accountMenu = $("account-menu");
  const setMenu = (open) => {
    accountMenu.hidden = !open;
    $("manage-profiles").setAttribute("aria-expanded", String(open));
  };
  $("manage-profiles").addEventListener("click", (e) => {
    e.stopPropagation();
    setMenu(accountMenu.hidden);
  });
  document.addEventListener("click", (e) => {
    if (!accountMenu.hidden && !accountMenu.contains(e.target)) setMenu(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !accountMenu.hidden) setMenu(false);
  });

  /* Menu items declare their target dialog in markup, so this stays correct
     if the design moves them again. "Your chart" needs its list rebuilt
     first; the rest are static or already wired by their own handlers. */
  for (const item of document.querySelectorAll("[data-dialog]")) {
    item.addEventListener("click", () => {
      setMenu(false);
      const dlg = $(item.dataset.dialog);
      if (!dlg) return;
      // One chart per account: "Your chart" opens that chart's card.
      if (dlg.id === "profile-dialog") { openChartDialog(); return; }
      if (dlg.id === "settings-dialog") { openLocationForm(); return; }
      if (dlg.id === "dialog-history" && account) {
        openHistory({
          userId: account.id,
          timezone: state.location.timezone,
          focusDate: selectedDate,
        });
      }
      if (!dlg.open) dlg.showModal();
    });
  }
  for (const btn of document.querySelectorAll('[data-action="close-dialog"]')) {
    btn.addEventListener("click", () => btn.closest("dialog")?.close());
  }
  /* First run has no chart yet, so it reuses the chart form rather than
     duplicating one. The form knows how to save to Postgres and will send
     the user on to the daily view once it does. */
  $("cta-first-run")?.addEventListener("click", () => openProfileForm(null));

  /* Ritual toggles are injected with the readings, so the listener lives
     on the container. Optimistic: flip the button immediately, revert if
     the write fails — the alternative is a control that feels broken on a
     slow connection. */
  $("readings").addEventListener("click", async (e) => {
    const btn = e.target.closest(".ritual-toggle");
    if (!btn || !account) return;
    const ritual = btn.dataset.ritual;
    const day = computeDay(selectedDate, state.location, activeNatal(), state.zodiacMode);
    const instant = day.wishingWindow?.instant || day.fullMoonWindow?.instant;
    if (!instant) return;

    const done = btn.getAttribute("aria-pressed") !== "true";
    btn.setAttribute("aria-pressed", String(done));
    btn.classList.toggle("is-done", done);
    btn.textContent = done ? "Done ✓" : "Mark as done";
    if (done) ritualsDone.add(ritual); else ritualsDone.delete(ritual);

    try {
      await setCompletion(account.id, ritual, instant, done, state.location.timezone);
    } catch (err) {
      console.error("ritual toggle failed", err);
      btn.setAttribute("aria-pressed", String(!done));
      btn.classList.toggle("is-done", !done);
      btn.textContent = !done ? "Done ✓" : "Mark as done";
      if (done) ritualsDone.delete(ritual); else ritualsDone.add(ritual);
    }
  });

  document.querySelector('[data-action="sign-out"]')
    ?.addEventListener("click", async () => {
      setMenu(false);
      await signOut();   // onAuthStateChange returns us to the login screen
    });

  $("location-label").addEventListener("click", openLocationForm);

  // Profile dialog
  // Repurposed by the design as "Edit": there is one chart, so editing it
  // is the only thing this button can mean.
  $("new-profile").addEventListener("click", () => openProfileForm(state.profiles[0] || null));
  $("close-profiles").addEventListener("click", () => profileDialog.close());
  $("pf-cancel").addEventListener("click", () => {
    // Cancel returns to the card when there is a chart to return to.
    if (state.profiles.length) { renderProfileList(); showProfileView(false); }
    else profileDialog.close();
  });
  $("profile-form").addEventListener("submit", pfSubmit);
  $("pf-time-unknown").addEventListener("change", (e) => {
    $("pf-time").disabled = e.target.checked;
  });
  attachPlaceSearch($("pf-place"), $("pf-place-results"), (place) => {
    pfPickedPlace = place;
    $("pf-place").value = "";
    $("pf-place-chosen").textContent = `Selected: ${place.displayName}`;
    $("pf-lat").value = place.latitude;
    $("pf-lon").value = place.longitude;
    pfSetTimezoneFromCoords();
  });
  for (const id of ["pf-lat", "pf-lon"]) {
    $(id).addEventListener("change", () => {
      $("pf-place-chosen").textContent = "";
      pfSetTimezoneFromCoords();
    });
  }
  $("pf-tz").addEventListener("input", () => {
    pfTzAuto = false;
    $("pf-tz-auto").hidden = true;
  });

  // Location dialog
  $("loc-cancel").addEventListener("click", () => settingsDialog.close());
  $("location-form").addEventListener("submit", locSubmit);
  attachPlaceSearch($("loc-place"), $("loc-place-results"), (place) => {
    locPickedPlace = place;
    $("loc-place").value = "";
    $("loc-place-chosen").textContent = `Selected: ${place.displayName}`;
    $("loc-lat").value = place.latitude;
    $("loc-lon").value = place.longitude;
    locSetTimezoneFromCoords();
  });
  for (const id of ["loc-lat", "loc-lon"]) {
    $(id).addEventListener("change", () => {
      $("loc-place-chosen").textContent = "";
      locSetTimezoneFromCoords();
    });
  }
  $("loc-tz").addEventListener("input", () => {
    locTzAuto = false;
    $("loc-tz-auto").hidden = true;
  });
  // Applies immediately, independent of the Save/Cancel buttons.
  $("opt-affirmations").addEventListener("change", (e) => {
    state.showAffirmations = e.target.checked;
    persist();
    render();
  });
  $("opt-transitions").addEventListener("change", (e) => {
    state.showTransitions = e.target.checked;
    persist();
    render();
  });
  $("opt-both-readings").addEventListener("change", (e) => {
    state.showBothReadings = e.target.checked;
    persist();
    render();
  });

  // Timezone datalist (searchable dropdown of IANA names)
  const dl = $("tz-list");
  const zones = typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone") : [];
  dl.innerHTML = zones.map((z) => `<option value="${esc(z)}">`).join("");
}

/* ── Boot ───────────────────────────────────────────────────────── */

(async () => {
  $("storage-notice").hidden = storageAvailable();
  const loading = $("loading");

  // Capability check with device-specific guidance, so failures on older
  // phones or locked-down browsers don't show up as a vague network error.
  if (typeof WebAssembly === "undefined" || typeof BigInt64Array === "undefined") {
    loading.textContent =
      "This browser can't run the calculation engine (WebAssembly). " +
      "On iPhone/iPad: make sure iOS is up to date (iOS 15 or newer is needed), " +
      "and if Lockdown Mode is enabled, allow this website — tap the “aA” or " +
      "puzzle icon in the address bar → Website Settings → turn off Lockdown Mode " +
      "for this site. Then reload.";
    return;
  }

  /* The engine and the session are independent, and the engine is the slow
     one (~2.5 MB). Start it immediately and settle the session alongside,
     so a returning user isn't waiting on a sequence of two round trips. */
  const enginePromise = initEphemeris();
  const sessionPromise = currentSession();

  try {
    await enginePromise;
  } catch (e) {
    console.error(e);
    showBootError(e);
    return;
  }

  wire();
  initAuth();

  /* Accessors rather than values: the check-in screen needs whatever is
     current at the moment it saves, and main.js owns that state. */
  await initCheckIn({
    account: () => account,
    location: () => state.location,
    profileRow: () => profileRow,
    natal: () => {
      const p = state.profiles.find((x) => x.id === state.activeProfileId);
      return p ? natalFor(p) : null;
    },
    engineReady: () => true,   // we only get here after initEphemeris resolves
  });
  loading.hidden = true;
  $("app").hidden = false;

  /* Hard gate: no session, no app. The moon maths would run without an
     account, but a check-in has nowhere to go, and the design treats the
     logged-out state as the front door rather than a degraded daily view. */
  const session = await sessionPromise;
  await applySession(session);

  if (supabase) {
    supabase.auth.onAuthStateChange((_event, s) => { applySession(s); });
  }

  startLiveClock();

  // After a successful boot, cache the heavy engine assets on-device so
  // later visits don't depend on the connection (see public/sw.js).
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL || "./"}sw.js`)
      .catch(() => { /* caching is best-effort */ });
  }
})();
