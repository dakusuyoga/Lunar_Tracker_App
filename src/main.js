/* ── Lunar Tracker — app bootstrap, state, rendering, forms ───────── */
import { DateTime, IANAZone } from "luxon";
import { initEphemeris, searchPhaseEvent } from "./ephemeris.js";
import {
  SIGNS, SIGN_GLYPHS, ORDINALS,
  signName, signKey, degInSign,
  natalFor, computeDay,
} from "./compute.js";
import { CONTENT } from "./content.js";
import { moonIcon } from "./moonicon.js";
import { loadState, saveState, storageAvailable } from "./store.js";
import { attachPlaceSearch, timezoneFor } from "./geocode.js";

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
function ritualContent(ritual) {
  if (!ritual || !Array.isArray(ritual.parts)) {
    return `<p class="reading pending">— content pending —</p>`;
  }
  const out = [];
  for (const part of ritual.parts) {
    if (part.heading) {
      out.push(`<h4 class="ritual-h">${esc(part.heading)}</h4>`);
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
function signLine(day) {
  const idx = day.moonSignIndex;
  const plain = `${SIGN_GLYPHS[idx]} Moon in ${SIGNS[idx]} · ${degInSign(day.moonLon)} · ${state.zodiacMode}`;
  const segs = day.signSegments;
  if (state.showTransitions === false || !segs || segs.length < 2) return esc(plain);

  if (!day.isToday) {
    const span = segs.map((s, i) =>
      i === segs.length - 1
        ? `${SIGN_GLYPHS[s.value]} ${SIGNS[s.value]} after`
        : `${SIGN_GLYPHS[s.value]} ${SIGNS[s.value]} until ${fmtTime(s.to)}`
    ).join(" · ");
    return `${esc(span)} · ${esc(state.zodiacMode)}`;
  }

  const active = activeSegment(segs, day.anchor);
  const i = segs.indexOf(active);
  const next = segs[i + 1];
  const note = next
    ? `→ ${SIGN_GLYPHS[next.value]} ${SIGNS[next.value]} from ${fmtTime(next.from)}`
    : `since ${fmtTime(active.from)}`;
  return `${esc(plain)} <span class="ingress">${esc(note)}</span>`;
}

/* The same treatment for the natal-house line under the moon card. Built
   from the segments rather than appended to the anchor's house — on a past
   or future day the anchor sits in one segment while the line has to name
   the house the day *starts* in. */
function houseLine(day) {
  const segs = day.houseSegments;
  const plain = `Moon transiting the ${ORDINALS[day.house]} house`;
  if (state.showTransitions === false || !segs || segs.length < 2) return esc(plain);

  if (!day.isToday) {
    const span = segs.map((s, i) =>
      i === segs.length - 1
        ? `${ORDINALS[s.value]} after`
        : `${ORDINALS[s.value]} until ${fmtTime(s.to)}`
    ).join(" · ");
    return esc(`Moon transiting the ${span}`);
  }

  const active = activeSegment(segs, day.anchor);
  const next = segs[segs.indexOf(active) + 1];
  const note = next
    ? `→ ${ORDINALS[next.value]} from ${fmtTime(next.from)}`
    : `since ${fmtTime(active.from)}`;
  return `${esc(`Moon transiting the ${ORDINALS[active.value]} house`)} <span class="ingress">${esc(note)}</span>`;
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
  $("moon-icon").innerHTML = moonIcon(day.phaseAngle, 96);
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
        `<p class="conj">Moon ☌ ${esc(c.label)} <span class="orb">(orb ${c.orb.toFixed(1)}°)</span></p>`
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
      timing + ritualContent(CONTENT.newMoonRitual), "newmoon-ritual"));
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
        timing + ritualContent(CONTENT.fullMoonRitual), "fullmoon-ritual"));
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

  // Header state
  renderProfileSelect();
  $("mode-tropical").classList.toggle("active", state.zodiacMode === "tropical");
  $("mode-sidereal").classList.toggle("active", state.zodiacMode === "sidereal");
}

/* Today's view is read at the current moment, so it goes stale on its own:
   the Moon moves ~0.55°/hour and can change sign or house mid-session.
   Re-render each minute, and again whenever the tab is brought back — a
   screen left open overnight would otherwise still be showing yesterday. */
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

function renderProfileList() {
  const ul = $("profile-list");
  ul.innerHTML = "";
  if (!state.profiles.length) {
    ul.innerHTML = `<li class="empty">No profiles yet — create one below.</li>`;
    return;
  }
  for (const p of state.profiles) {
    const li = document.createElement("li");
    const info = document.createElement("div");
    const name = document.createElement("span");
    name.className = "p-name" + (p.id === state.activeProfileId ? " active" : "");
    name.textContent = p.name;
    const meta = document.createElement("div");
    meta.className = "p-meta";
    meta.textContent = `${p.birthDate}${p.timeUnknown ? " · time unknown" : ` · ${p.birthTime}`} · ${p.place.displayName.split(",")[0]}`;
    info.append(name, meta);
    const actions = document.createElement("div");
    actions.className = "p-actions";
    const use = document.createElement("button");
    use.type = "button"; use.textContent = "Use";
    use.addEventListener("click", () => {
      state.activeProfileId = p.id;
      persist(); renderProfileList(); render();
    });
    const edit = document.createElement("button");
    edit.type = "button"; edit.textContent = "Edit";
    edit.addEventListener("click", () => openProfileForm(p));
    const del = document.createElement("button");
    del.type = "button"; del.textContent = "Delete";
    del.addEventListener("click", () => {
      if (!window.confirm(`Delete profile “${p.name}”? This cannot be undone.`)) return;
      state.profiles = state.profiles.filter((x) => x.id !== p.id);
      if (state.activeProfileId === p.id) {
        state.activeProfileId = state.profiles.length ? state.profiles[0].id : null;
      }
      persist(); renderProfileList(); render();
    });
    actions.append(use, edit, del);
    li.append(info, actions);
    ul.appendChild(li);
  }
}

function showProfileView(formMode) {
  $("profile-list-view").hidden = formMode;
  $("profile-form").hidden = !formMode;
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
  $("pf-place-chosen").textContent = profile ? `Selected: ${profile.place.displayName}` : "";
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

function pfSubmit(ev) {
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

  const profile = {
    id: editingProfileId || crypto.randomUUID(),
    name,
    birthDate,
    birthTime,
    timeUnknown,
    place: { displayName, latitude: lat, longitude: lon },
    timezone,
    timezoneAuto: pfTzAuto,
  };
  if (editingProfileId) {
    state.profiles = state.profiles.map((p) => (p.id === editingProfileId ? profile : p));
  } else {
    state.profiles.push(profile);
  }
  state.activeProfileId = profile.id;
  persist();
  renderProfileList();
  showProfileView(false);
  render();
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
  persist();
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
  $("manage-profiles").addEventListener("click", () => {
    renderProfileList();
    showProfileView(false);
    profileDialog.showModal();
  });
  $("open-settings").addEventListener("click", openLocationForm);
  $("location-label").addEventListener("click", openLocationForm);

  // Profile dialog
  $("new-profile").addEventListener("click", () => openProfileForm(null));
  $("close-profiles").addEventListener("click", () => profileDialog.close());
  $("pf-cancel").addEventListener("click", () => {
    if (state.profiles.length) showProfileView(false);
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

  try {
    await initEphemeris();
  } catch (e) {
    console.error(e);
    const p1 = document.createElement("p");
    p1.textContent = "Could not load the ephemeris. Check your connection and reload.";
    const p2 = document.createElement("p");
    p2.className = "loading-detail";
    p2.textContent = `Technical detail: ${(e && e.message) || e}`;
    const p3 = document.createElement("p");
    p3.className = "loading-detail";
    p3.textContent =
      "If reloading doesn't help: on iPhone, Lockdown Mode blocks this app — " +
      "tap “aA” in the address bar → Website Settings → allow this site. " +
      "Otherwise, send the technical detail above to the site owner.";
    loading.replaceChildren(p1, p2, p3);
    return;
  }
  wire();
  loading.hidden = true;
  $("app").hidden = false;
  render();
  startLiveClock();

  // After a successful boot, cache the heavy engine assets on-device so
  // later visits don't depend on the connection (see public/sw.js).
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL || "./"}sw.js`)
      .catch(() => { /* caching is best-effort */ });
  }
})();
