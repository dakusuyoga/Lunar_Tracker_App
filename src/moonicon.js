/* ── Moon phase icon ─────────────────────────────────────────────────
   Clean geometric SVG rendered from the phase angle (0 = new,
   180 = full). The terminator is an ellipse arc whose semi-minor axis
   follows cos(phase); waxing lights the right limb. */
const DEG = Math.PI / 180;
const norm360 = (x) => ((x % 360) + 360) % 360;

export function moonIcon(phaseAngle, size) {
  const c = size / 2;
  const r = c - size * 0.06;
  const frac = (1 - Math.cos(phaseAngle * DEG)) / 2;
  let lit = "";
  if (frac > 0.995) {
    lit = `<circle cx="${c}" cy="${c}" r="${r}" class="moon-lit"/>`;
  } else if (frac > 0.005) {
    const waxing = norm360(phaseAngle) <= 180;
    const rx = Math.abs(r * Math.cos(phaseAngle * DEG));
    const limbSweep = waxing ? 1 : 0;
    const termSweep = (frac < 0.5) === waxing ? 0 : 1;
    lit = `<path class="moon-lit" d="M ${c} ${c - r}
      A ${r} ${r} 0 0 ${limbSweep} ${c} ${c + r}
      A ${rx.toFixed(3)} ${r} 0 0 ${termSweep} ${c} ${c - r} Z"/>`;
  }
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"
    role="img" aria-label="Moon phase">
    <circle cx="${c}" cy="${c}" r="${r}" class="moon-dark"/>
    ${lit}
    <circle cx="${c}" cy="${c}" r="${r}" class="moon-edge" fill="none"/>
  </svg>`;
}
