/* ── Onboarding carousel ─────────────────────────────────────────────
   Five panels, shown once after sign-up and re-openable from the account
   menu ("How it works"). Visual and flow only: there is no backend here.

   Two entry points, one difference:
     first-run  Skip and the last-panel button both go to the chart form.
                Either way the carousel is marked seen and never opens on
                its own again.
     menu       Skip/Close just closes. The last-panel button opens the
                chart ("View your chart").

   WHETHER IT OPENS is decided by the caller (main.js): only for the
   session that sign-up itself produced, never for a later log-in. The
   "seen" flag below is only what stops a reload or a token refresh of
   that same sign-up session from replaying it — it lives in localStorage
   under the user's id, so it needs no migration.

   It is a <dialog> opened with showModal() so the page behind is inert
   and Escape/focus-trapping come for free. */
import { t, applyStrings } from "./i18n.js";

const STEPS = 5;
const SWIPE_PX = 48;      // distance that counts as a swipe rather than a tap
const DRAG_START_PX = 8;  // movement before a press becomes a drag

const seenKey = (userId) => `lunarTracker.onboarded.${userId}`;
/* If localStorage is blocked, remember for this page load at least, so a
   token refresh can't re-open the carousel the user just dismissed. */
const seenInMemory = new Set();

export function hasSeenOnboarding(userId) {
  if (seenInMemory.has(userId)) return true;
  try { return window.localStorage.getItem(seenKey(userId)) === "1"; }
  catch { return false; }
}

function markSeen(userId) {
  seenInMemory.add(userId);
  try { window.localStorage.setItem(seenKey(userId), "1"); } catch { /* best effort */ }
}

let dlg, viewport, track, panels, dotsEl, dots, backBtn, nextBtn, skipBtn, statusEl;
let wired = false;
let index = 0;
let dragDx = 0;
let ctx = null;           // { mode, userId, onFinish, returnFocus }

export const isOnboardingOpen = () => !!dlg && dlg.open;

function paint() {
  track.style.transform = `translate3d(calc(${-index * 100}% + ${dragDx}px), 0, 0)`;
}

/* Labels are resolved here, on every render, so a language change picks
   them up; the panel copy itself is marked with data-i18n. */
function render() {
  const last = index === STEPS - 1;
  const firstRun = ctx.mode === "first-run";

  panels.forEach((p, i) => { p.inert = i !== index; });
  dots.forEach((d, i) => {
    if (i === index) d.setAttribute("aria-current", "step");
    else d.removeAttribute("aria-current");
  });

  if (backBtn === document.activeElement && index === 0) nextBtn.focus();
  backBtn.hidden = index === 0;
  backBtn.textContent = t("onboard.back");
  nextBtn.textContent = last
    ? t(firstRun ? "onboard.ctaFirst" : "onboard.ctaMenu")
    : t("onboard.next");
  skipBtn.textContent = t(firstRun ? "onboard.skip" : "onboard.close");
  statusEl.textContent = t("onboard.step", { n: index + 1, total: STEPS });
  paint();
}

function go(i) {
  index = Math.max(0, Math.min(STEPS - 1, i));
  render();
}

/* `act` is true when the user chose the last-panel button. In first run
   every exit leads to the chart form, so Skip counts as acting too. */
function leave(act) {
  if (!ctx) return;
  const { mode, userId, onFinish, returnFocus } = ctx;
  ctx = null;
  if (mode === "first-run") markSeen(userId);
  if (dlg.open) dlg.close();
  const proceed = act || mode === "first-run";
  if (proceed) onFinish?.();
  else returnFocus?.focus?.();
}

/* Programmatic close, for sign-out: no callbacks, nothing marked seen. */
/* Back/Next/Skip and the step counter are written by render(), so
   applyStrings cannot reach them — the same gap auth.js has. Called on a
   language change; a no-op unless the carousel is actually open. */
export function refreshOnboardingCopy() {
  if (!dlg || !dlg.open) return;
  applyStrings(dlg);
  render();
}

export function closeOnboarding() {
  ctx = null;
  if (dlg?.open) dlg.close();
}

function wire() {
  dlg = document.getElementById("onboarding");
  viewport = dlg.querySelector(".onboard-viewport");
  track = dlg.querySelector(".onboard-track");
  panels = [...dlg.querySelectorAll(".onboard-panel")];
  dotsEl = dlg.querySelector(".onboard-dots");
  backBtn = dlg.querySelector('[data-action="onboard-back"]');
  nextBtn = dlg.querySelector('[data-action="onboard-next"]');
  skipBtn = dlg.querySelector('[data-action="onboard-skip"]');
  statusEl = dlg.querySelector(".onboard-status");

  dotsEl.replaceChildren(...panels.map((_, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "onboard-dot";
    b.addEventListener("click", () => go(i));
    return b;
  }));
  dots = [...dotsEl.children];
  dots.forEach((d, i) =>
    d.setAttribute("aria-label", t("onboard.dot", { n: i + 1, total: STEPS })));

  backBtn.addEventListener("click", () => go(index - 1));
  nextBtn.addEventListener("click", () => {
    if (index === STEPS - 1) leave(true);
    else go(index + 1);
  });
  skipBtn.addEventListener("click", () => leave(false));

  /* Escape is a skip, not an accident: it must run the same exit path so
     first run still lands on the chart form. */
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); leave(false); });

  dlg.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); go(index + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); go(index - 1); }
  });

  /* Swipe. A press only becomes a drag after DRAG_START_PX of sideways
     travel, so taps on the controls are never swallowed by capture. */
  let startX = null, pid = null, dragging = false;
  viewport.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    startX = e.clientX; pid = e.pointerId; dragging = false; dragDx = 0;
  });
  viewport.addEventListener("pointermove", (e) => {
    if (startX === null || e.pointerId !== pid) return;
    const d = e.clientX - startX;
    if (!dragging) {
      if (Math.abs(d) < DRAG_START_PX) return;
      dragging = true;
      viewport.setPointerCapture(pid);
      track.classList.add("is-dragging");
    }
    const atEdge = (index === 0 && d > 0) || (index === STEPS - 1 && d < 0);
    dragDx = atEdge ? d * 0.25 : d;
    paint();
  });
  const endDrag = () => {
    if (startX === null) return;
    const moved = dragDx, was = dragging;
    startX = null; dragging = false; dragDx = 0;
    track.classList.remove("is-dragging");
    if (!was) return;
    if (moved <= -SWIPE_PX) go(index + 1);
    else if (moved >= SWIPE_PX) go(index - 1);
    else paint();
  };
  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);

  wired = true;
}

export function openOnboarding({ mode, userId, onFinish }) {
  if (!wired) wire();
  if (dlg.open) return;
  ctx = {
    mode, userId, onFinish,
    returnFocus: mode === "menu" ? document.getElementById("manage-profiles") : null,
  };
  applyStrings(dlg);
  dots.forEach((d, i) =>
    d.setAttribute("aria-label", t("onboard.dot", { n: i + 1, total: STEPS })));
  dlg.showModal();
  go(0);
  nextBtn.focus();
}
