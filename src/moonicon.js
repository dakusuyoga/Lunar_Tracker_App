/* ── Moon phase shadow ───────────────────────────────────────────────
   The moon is drawn as a photograph with a shadow laid over it: the photo
   is the lit surface, and this path is the part the Sun isn't reaching.
   That is the only way a photographic moon can show a phase — the image
   can't change shape, so the shadow does the work.

   Geometry (design's coordinate system, viewBox -70 -70 140 140):
     R    = 60      the moon's radius
     OUT  = R * 1.2 the outer arc, deliberately oversized: the shadow is
                    gaussian-blurred, and a soft edge sitting exactly on
                    the limb would leave a lit rind around the dark side.
                    The whole path is clipped back to r=59.4 by the SVG.

   The terminator is an ellipse arc whose semi-minor axis follows
   cos(phase); waxing lights the right limb. This is the same construction
   the previous lit-crescent icon used, with the limb arc taken along the
   *dark* side instead — same terminator, opposite half. */
const DEG = Math.PI / 180;
const norm360 = (x) => ((x % 360) + 360) % 360;

const R = 60;
const OUT = R * 1.2;

/* Returns the `d` for the shadow, or "" at full moon when there is none.
   phaseAngle: 0 = new, 180 = full. */
export function moonShadowPath(phaseAngle) {
  const frac = (1 - Math.cos(phaseAngle * DEG)) / 2;

  if (frac > 0.995) return "";                       // full: nothing in shadow
  if (frac < 0.005) {                                // new: entirely in shadow
    return `M 0 ${-OUT} A ${OUT} ${OUT} 0 1 1 0 ${OUT} A ${OUT} ${OUT} 0 1 1 0 ${-OUT} Z`;
  }

  const waxing = norm360(phaseAngle) <= 180;
  const rx = Math.abs(R * Math.cos(phaseAngle * DEG));
  // Waxing lights the right limb, so the shadow takes the left one.
  const limbSweep = waxing ? 0 : 1;
  const termSweep = (frac < 0.5) === waxing ? 0 : 1;

  return `M 0 ${-OUT} A ${OUT} ${OUT} 0 0 ${limbSweep} 0 ${OUT}`
    + ` L 0 ${R} A ${rx.toFixed(2)} ${R} 0 0 ${termSweep} 0 ${-R} Z`;
}
