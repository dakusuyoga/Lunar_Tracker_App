/* ── Persistence ──────────────────────────────────────────────────────
   Everything lives under one localStorage key. If localStorage is
   unavailable (private mode, blocked cookies), the app keeps working
   in memory and shows a subtle notice. */

const KEY = "lunarTracker.v1";

export const DEFAULT_LOCATION = {
  displayName: "Toronto, Canada",
  latitude: 43.65,
  longitude: -79.38,
  timezone: "America/Toronto",
};

let memoryState = null;
let storageOk = true;

function defaults() {
  return {
    profiles: [],
    activeProfileId: null,
    location: { ...DEFAULT_LOCATION },
    zodiacMode: "tropical",
    showAffirmations: true,
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
