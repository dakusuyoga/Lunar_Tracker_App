/* ── Geocoding (Nominatim) + timezone lookup ─────────────────────────
   Nominatim usage policy (friends-scale hobby app):
   - requests are debounced to ≥ 1 second of typing silence,
   - at most one in-flight request (previous ones aborted),
   - the browser sends this site's Referer automatically,
   - no bulk queries. https://operations.osmfoundation.org/policies/nominatim/ */
import tzlookup from "tz-lookup";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
export const DEBOUNCE_MS = 1100;

export async function searchPlaces(query, signal) {
  const url = `${NOMINATIM}?format=jsonv2&limit=5&accept-language=en&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const rows = await res.json();
  return rows.map((r) => ({
    displayName: r.display_name,
    latitude: parseFloat(r.lat),
    longitude: parseFloat(r.lon),
  }));
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
          resultsEl.innerHTML = `<li class="hint">No results — try the manual coordinates below</li>`;
          return;
        }
        for (const p of places) {
          const li = document.createElement("li");
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = p.displayName;
          btn.addEventListener("click", () => {
            clear();
            onPick(p);
          });
          li.appendChild(btn);
          resultsEl.appendChild(li);
        }
      } catch (e) {
        if (e.name === "AbortError") return;
        resultsEl.innerHTML = `<li class="hint">Search failed — check your connection or use manual coordinates</li>`;
      }
    }, DEBOUNCE_MS);
  });

  // Hide results when focus leaves the widget.
  inputEl.addEventListener("blur", () => setTimeout(clear, 250));
  return { clear };
}
