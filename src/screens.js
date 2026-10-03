/* ── Screen switching ────────────────────────────────────────────────
   The app is one page with several top-level <section class="screen">
   blocks and no router; exactly one is visible at a time. */
const SCREENS = [
  "screen-login",
  "screen-first-run",
  "screen-daily",
  "screen-checkin",
  "screen-record",
];

export function showScreen(id) {
  for (const s of SCREENS) {
    const el = document.getElementById(s);
    if (el) el.hidden = s !== id;
  }
  // A screen change is a navigation; start the new one from the top.
  window.scrollTo(0, 0);
}

export const currentScreen = () =>
  SCREENS.find((s) => {
    const el = document.getElementById(s);
    return el && !el.hidden;
  }) || null;
