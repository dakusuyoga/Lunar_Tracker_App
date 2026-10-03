/* ── The saved check-in card ─────────────────────────────────────────
   Shown on the daily view only for dates that actually have a check-in.
   §7.8: no placeholder, no dashed outline, no "you missed a day" prompt —
   a day without one simply has nothing there. Entirely read-only: a
   check-in is written once and never revised.

   Labels come from the check-in screen's own markup rather than the
   `vocabulary` table. The chips are the rendering source (they must work
   offline, because a missed day can never be recovered), so reading labels
   from the same place keeps one source of truth in the frontend. */
import { DateTime } from "luxon";
import { t, fmtDate } from "./i18n.js";

/* Labels come from the string catalogue, keyed by the value the row
   stores — the same source the chips themselves render from, so there is
   still one source of truth, and it follows the language. An earlier
   version read the chips' DOM text and cached it; that cache survived a
   language switch and kept showing the old language. */
const labelFor = (value) => t(`vocab.${value}`);

export function renderRecordCard(row, dateISO, timezone) {
  const card = document.querySelector(".record-card");
  if (!card) return;

  if (!row) {
    card.hidden = true;
    return;
  }

  const date = card.querySelector(".record-date");
  if (date) {
    date.textContent = fmtDate(DateTime.fromISO(dateISO, { zone: timezone }));
  }

  const badges = card.querySelector(".badge-row");
  if (badges) {
    const picked = [...(row.emotions || []), ...(row.body || [])];
    badges.innerHTML = picked
      .map((v) => `<span class="badge">${labelFor(v)}</span>`)
      .join("");
    // Someone can save a journal-only check-in; an empty strip would read
    // as a rendering fault rather than a choice.
    badges.hidden = picked.length === 0;
  }

  /* Energy and focus are optional. A null means "didn't answer", which is
     a different thing from a low score — so the slot is omitted entirely
     rather than shown empty. */
  const meters = card.querySelector(".meter-row");
  if (meters) {
    const parts = [];
    if (row.energy) {
      parts.push(`<span class="datum"><span class="micro-label">${t("checkin.energy")}</span>` +
        `<span class="value">${labelFor(row.energy)}</span></span>`);
    }
    if (row.focus) {
      parts.push(`<span class="datum"><span class="micro-label">${t("checkin.focus")}</span>` +
        `<span class="value">${labelFor(row.focus)}</span></span>`);
    }
    meters.innerHTML = parts.join("");
    meters.hidden = parts.length === 0;
  }

  /* A few lines of the journal, clamped in CSS rather than cut here: the
     full text stays in the DOM, so the card never shows a sentence the
     check-in didn't contain, and "Open this check-in" leads to the rest. */
  const journal = card.querySelector(".record-journal");
  if (journal) {
    const text = (row.journal_text || "").trim();
    journal.querySelector(".journal-text").textContent = text;
    journal.hidden = !text;
  }

  card.hidden = false;
}
