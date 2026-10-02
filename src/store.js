/* ── Persistence ──────────────────────────────────────────────────────
   Everything lives under one localStorage key. If localStorage is
   unavailable (private mode, blocked cookies), the app keeps working
   in memory and shows a subtle notice. */

const KEY = "lunarTracker.v1";

/* The display location decides which local day a check-in belongs to, so
   the default must not be somebody else's city. Coordinates still need a
   place search — rise and set times can't be derived from a timezone — but
   the *day boundary* is right from the first launch, which is the part
   that silently corrupts data if it's wrong.

   A hardcoded Toronto would file a 9am check-in in Hanoi under the
   previous day, with nothing on screen to suggest anything was amiss. */
const deviceZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Toronto";
  } catch {
    return "America/Toronto";
  }
};

export const DEFAULT_LOCATION = {
  displayName: "Toronto, Canada",
  latitude: 43.65,
  longitude: -79.38,
  timezone: "America/Toronto",
};

/* Used for a brand-new account, before any location has been chosen.

   Only the zone is inferred, because only the zone can be: a timezone
   doesn't give you coordinates, and rise/set times need them. The
   coordinates stay a placeholder and the app asks for the real place after
   the chart is created — but the day boundary is already correct, so a
   check-in made before that conversation still lands on the right day. */
export function initialLocation() {
  const zone = deviceZone();
  if (zone === DEFAULT_LOCATION.timezone) return { ...DEFAULT_LOCATION };
  return {
    ...DEFAULT_LOCATION,
    displayName: "",      // blank, so nothing claims to know where they are
    timezone: zone,
  };
}

let memoryState = null;
let storageOk = true;

function defaults() {
  return {
    profiles: [],
    activeProfileId: null,
    location: initialLocation(),
    zodiacMode: "tropical",
    showAffirmations: true,
    showTransitions: true,
    showBothReadings: false,
  };
}

export function loadState() {
  let raw = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    storageOk = false;
  }
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      memoryState = { ...defaults(), ...parsed };
    } catch {
      memoryState = defaults();
    }
  } else {
    memoryState = memoryState || defaults();
  }
  return memoryState;
}

export function saveState(state) {
  memoryState = state;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    storageOk = false;
  }
}

export function storageAvailable() {
  return storageOk;
}
