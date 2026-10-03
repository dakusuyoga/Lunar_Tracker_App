/* ── Geocoding (Nominatim) + timezone lookup ─────────────────────────
   Nominatim usage policy (friends-scale hobby app):
   - requests are debounced to ≥ 1 second of typing silence,
   - at most one in-flight request (previous ones aborted),
   - the browser sends this site's Referer automatically,
   - no bulk queries. https://operations.osmfoundation.org/policies/nominatim/ */
import tzlookup from "tz-lookup";
import { t } from "./i18n.js";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
export const DEBOUNCE_MS = 1100;

export async function searchPlaces(query, signal) {
  const url = `${NOMINATIM}?format=jsonv2&limit=5&addressdetails=1&accept-language=en`
    + `&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) {
    // Carry the status so the UI can tell "the service refused us" apart
    // from "this place doesn't exist" — they need different advice.
    const err = new Error(`Nominatim ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const rows = await res.json();
  return rows.map((r) => ({
    displayName: shortLabel(r),   // what we store and show
    fullName: r.display_name,     // what the results list shows, for picking
    latitude: parseFloat(r.lat),
    longitude: parseFloat(r.lon),
  }));
}

/* Nominatim's display_name is the entire administrative hierarchy, which
   drags in levels nobody recognises as part of an address — Toronto comes
   back as "Toronto, Golden Horseshoe, Ontario, Canada", the Golden
   Horseshoe being a regional-planning area, not somewhere you were born.
   The structured fields give a label a person would actually write.

   The full string still appears in the results list, where the extra
   hierarchy is genuinely useful for telling two identically-named places
   apart. It just doesn't belong in the stored label. */
function shortLabel(r) {
  const a = r.address || {};

  /* The result's OWN name, not a parent. Taking address.city instead turns
     "Beelitz-Heilstätten" into "Beelitz" — the municipality it sits in —
     silently relabelling the place someone actually searched for. */
  const place = (r.name && r.name.trim())
    || String(r.display_name || "").split(",")[0].trim();
  if (!place) return r.display_name;

  /* Keep one region level. Without it "Springfield, United States" is
     three different cities, which is fine for a display location and not
     fine for a birthplace. What's dropped is the noise between: county,
     postcode, and planning regions like "Golden Horseshoe". */
  const region = a.state || a.province || a.region || a.county || null;

  return [place, region, a.country].filter(Boolean).join(", ");
}

// Coordinates → IANA timezone name (offline), or null if lookup fails.
export function timezoneFor(latitude, longitude) {
  try {
    return tzlookup(latitude, longitude);
  } catch {
    return null;
  }
}

/* Wire a text input + result list up as a debounced place autocomplete.
   onPick receives {displayName, latitude, longitude}. */
export function attachPlaceSearch(inputEl, resultsEl, onPick) {
  let timer = null;
  let controller = null;

  const clear = () => {
    resultsEl.innerHTML = "";
    resultsEl.hidden = true;
  };

  inputEl.addEventListener("input", () => {
    clearTimeout(timer);
    if (controller) controller.abort();
    const q = inputEl.value.trim();
    if (q.length < 3) { clear(); return; }
    timer = setTimeout(async () => {
      controller = new AbortController();
      resultsEl.innerHTML = `<li class="hint">Searching…</li>`;
      resultsEl.hidden = false;
      try {
        const places = await searchPlaces(q, controller.signal);
        resultsEl.innerHTML = "";
        if (!places.length) {
          resultsEl.innerHTML = `<li class="hint">${t("geo.noResults")}</li>`;
          return;
        }
        for (const p of places) {
          const li = document.createElement("li");
          const btn = document.createElement("button");
          btn.type = "button";
          // The full hierarchy here: it's what distinguishes one Springfield
          // from another. Only the stored label is shortened.
          btn.textContent = p.fullName || p.displayName;
          btn.addEventListener("click", () => {
            clear();
            onPick(p);
          });
          li.appendChild(btn);
          resultsEl.appendChild(li);
        }
      } catch (e) {
        if (e.name === "AbortError") return;
        /* A reachability failure must never read like "no such place".
           Someone told their birthplace doesn't exist types coordinates
           instead and silently ends up with an approximate chart — which
           is exactly how a real birthplace ended up stored as a bare
           lat/lon pair during testing. */
        const msg = e.status === 429
          ? t("geo.busy")
          : e.status
            ? t("geo.unavailable", { status: e.status })
            : t("geo.unreachable");
        resultsEl.innerHTML =
          `<li class="hint">${msg}<br>${t("geo.preferRetry")}</li>`;
      }
    }, DEBOUNCE_MS);
  });

  // Hide results when focus leaves the widget.
  inputEl.addEventListener("blur", () => setTimeout(clear, 250));
  return { clear };
}
