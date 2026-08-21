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

let labels = null;

function labelFor(value) {
  if (!labels) {
    labels = new Map();
    for (const el of document.querySelectorAll("#screen-checkin [data-value][data-field]")) {
      // The ladder rungs wrap their text in a span alongside the bar.
      const text = (el.querySelector("span:last-child") || el).textContent.trim();
      labels.set(el.dataset.value, text);
    }
  }
  return labels.get(value) || value;
}

export function renderRecordCard(row, dateISO, timezone) {
  const card = document.querySelector(".record-card");
  if (!card) return;

  if (!row) {
    card.hidden = true;
    return;
  }

  const date = card.querySelector(".record-date");
  if (date) {
    date.textContent = DateTime.fromISO(dateISO, { zone: timezone })
      .toFormat("cccc, LLLL d");
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
      parts.push(`<span class="datum"><span class="micro-label">Energy</span>` +
        `<span class="value">${labelFor(row.energy)}</span></span>`);
    }
    if (row.focus) {
      parts.push(`<span class="datum"><span class="micro-label">Focus</span>` +
        `<span class="value">${labelFor(row.focus)}</span></span>`);
    }
    meters.innerHTML = parts.join("");
    meters.hidden = parts.length === 0;
  }

  card.hidden = false;
}
