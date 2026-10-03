/* ── The saved check-in, in full ─────────────────────────────────────
   Shows one check-in: the human answers, and the sky as it was at the
   moment it was saved.

   The moon context is READ from the row, never recomputed. That is the
   point of storing both zodiacs at save time — flipping this screen's
   Tropical/Sidereal toggle is a lookup, so it shows exactly what was true
   at that instant in either system, and it keeps working years later even
   if the ephemeris or the house conventions change.

   Note this screen and the daily view answer different questions. This is
   the sky at the *instant* of the check-in; the daily view for a past date
   reads at local noon, because a past day has no "now". On a day when the
   Moon changed sign in the afternoon the two legitimately differ, which is
   why the heading says when this was. */
import { DateTime } from "luxon";
import { SIGNS, SIGN_GLYPHS, POINT_LABELS } from "./compute.js";
import { moonShadowPath } from "./moonicon.js";
import { showScreen } from "./screens.js";
import { fetchCheckIn } from "./checkin.js";
import { fetchCompletions, RITUALS } from "./rituals.js";
import { t, fmtDate, fmtTime, ordinal } from "./i18n.js";

/* The stored value is the key, so a check-in saved in one language reads
   correctly in the other. */
const phaseLabel = (key) => (key ? t(`phase.${key}`) : "—");

let screen, ctx;
let mode = "sidereal";   // this screen's own toggle, independent of the daily view
let current = null;      // the row on display

const q = (sel) => screen.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* From the catalogue, not the chips' DOM text: this follows the language
   and does not go stale when it changes. */
const labelOf = (value) => t(`vocab.${value}`);

function renderMoon(row) {
  const tz = row.display_tz || ctx.timezone();
  const at = DateTime.fromISO(row.created_at).setZone(tz);

  q(".phase-name").textContent = phaseLabel(row.moon_phase);
  q(".illum").textContent = row.phase_angle == null ? ""
    : `${Math.round((1 - Math.cos(row.phase_angle * Math.PI / 180)) / 2 * 100)}% illuminated`;

  // The small moon shows that day's shape, drawn from the stored angle.
  const shadow = q(".moon-shadow");
  if (shadow && row.phase_angle != null) {
    const d = moonShadowPath(row.phase_angle);
    shadow.setAttribute("d", d || "M 0 0");
    shadow.style.display = d ? "" : "none";
  }

  // "That day's moon" is too vague once you know the two screens differ.
  const caption = q(".moon-titles .micro-label");
  if (caption) caption.textContent = t("record.skyAt", { time: fmtTime(at) });

  const sign = mode === "sidereal" ? row.moon_natal_sign_sidereal : row.moon_natal_sign_tropical;
  const house = mode === "sidereal" ? row.moon_natal_house_sidereal : row.moon_natal_house_tropical;
  const conj = (mode === "sidereal" ? row.conjunctions_sidereal : row.conjunctions_tropical) || [];
  const modeName = t(mode === "sidereal" ? "zodiac.sidereal" : "zodiac.tropical");

  const parts = [];
  if (sign) {
    const i = SIGNS.findIndex((s) => s.toLowerCase() === sign);
    parts.push(`<p class="datum"><span class="micro-label">${t("record.sign")}</span><span class="value">` +
      `<span class="glyph">${SIGN_GLYPHS[i]}</span> ${esc(t(`sign.${sign}`))} · ${modeName}</span></p>`);
  }
  // Null house is a real state — no birth time — not a gap to paper over.
  if (house != null) {
    parts.push(`<p class="datum"><span class="micro-label">${t("record.house")}</span>` +
      `<span class="value">${t("reading.house", { house: ordinal(house) })}</span></p>`);
  }
  parts.push(`<p class="datum datum-wide"><span class="micro-label">${t("record.transit")}</span>` +
    `<span class="value conj">${conj.length
      ? conj.map((c) => `Moon <span class="glyph">☌︎</span> ${esc(POINT_LABELS[c.point] || c.point)} ` +
          `<span class="orb">(orb ${Number(c.orb).toFixed(1)}°)</span>`).join("<br>")
      : t("record.noConjunctions")}</span></p>`);

  q(".data-grid").innerHTML = parts.join("");

  if (row.moon_context_pending) {
    q(".data-grid").insertAdjacentHTML("beforeend",
      `<p class="datum datum-wide hint">${esc(t("record.pending"))}</p>`);
  }
}

function renderAnswers(row, rituals) {
  const tz = row.display_tz || ctx.timezone();
  const date = DateTime.fromISO(row.checkin_date, { zone: tz });
  q(".display-title").textContent = t("record.title", { date: fmtDate(date) });
  const head = q(".record-date");
  if (head) head.textContent = fmtDate(date);

  const picked = [...(row.emotions || []), ...(row.body || [])];
  const badges = q(".badge-row");
  badges.innerHTML = picked.map((v) => `<span class="badge">${esc(labelOf(v))}</span>`).join("");
  badges.hidden = picked.length === 0;

  const meters = [];
  if (row.energy) meters.push(["Energy", labelOf(row.energy)]);
  if (row.focus) meters.push(["Focus", labelOf(row.focus)]);
  const meterRow = q(".meter-row");
  meterRow.innerHTML = meters.map(([k, v]) =>
    `<span class="datum"><span class="micro-label">${k}</span><span class="value">${esc(v)}</span></span>`).join("");
  meterRow.hidden = meters.length === 0;

  const journal = q(".journal-text");
  journal.textContent = row.journal_text || "";
  journal.previousElementSibling.hidden = !row.journal_text;   // its micro-label
  journal.hidden = !row.journal_text;

  /* The ritual panel is about the lunation, not the day, so it only
     belongs here when one was marked. */
  const panel = [...screen.querySelectorAll(".panel")].at(-1);
  const marks = [...rituals];
  if (!marks.length) { panel.hidden = true; return; }
  panel.hidden = false;
  panel.querySelector(".micro-label").textContent = t("record.rituals");
  for (const el of panel.querySelectorAll(".ritual-h")) el.remove();
  const anchor = panel.querySelector(".link-btn");
  for (const key of marks) {
    anchor.insertAdjacentHTML("beforebegin",
      `<p class="ritual-h">${esc(RITUALS[key] || key)} <span class="mark is-done">${t("record.done")}</span></p>`);
  }
}

export async function openRecord(dateISO) {
  const row = await fetchCheckIn(ctx.userId(), dateISO);
  if (!row) return;                       // no check-in that day: nothing to show
  current = row;

  let rituals = new Set();
  if (row.created_at) {
    // Rituals are keyed by lunation; show any marked around this check-in.
    rituals = await fetchCompletions(ctx.userId(), row.created_at.slice(0, 10));
  }

  renderAnswers(row, rituals);
  renderMoon(row);
  showScreen("screen-record");
}

export function initRecordScreen(context) {
  ctx = context;
  screen = document.getElementById("screen-record");
  if (!screen) return;

  const segs = [...screen.querySelectorAll(".segmented .seg")];
  segs.forEach((btn) => {
    btn.addEventListener("click", () => {
      mode = /sidereal/i.test(btn.textContent) ? "sidereal" : "tropical";
      segs.forEach((b) => {
        const on = b === btn;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-pressed", String(on));
      });
      if (current) renderMoon(current);     // a lookup, not a recomputation
    });
  });

  for (const btn of document.querySelectorAll('[data-action="open-record"]')) {
    btn.addEventListener("click", () => openRecord(ctx.selectedDate()));
  }
}
