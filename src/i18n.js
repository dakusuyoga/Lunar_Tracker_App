/* ── Language ────────────────────────────────────────────────────────
   V3. Two languages, switched with a toggle, both available at once.

   Three decisions worth stating, because each has a wrong-looking
   alternative that seems simpler:

   1. THE LANGUAGE IS A DISPLAY PREFERENCE, STORED LOCALLY — the same
      shelf as `zodiacMode` and the Display switches, not a column on
      `profiles`. Nothing in the database is language-dependent: check-ins
      store codes (`joyful`, `scorpio`), never labels. So a language
      column would add a migration and a round-trip to decide something
      the browser already knows at boot, before any session exists.
      (If per-account sync is wanted later, it's one more field in the
      profiles row — the rest of this file doesn't change.)

   2. CONTENT IS LOADED, NOT BUNDLED. The readings are ~134 KB per
      language. Importing both statically would ship every byte of
      Russian prose to a reader who only ever sees English, and vice
      versa. `loadContent` dynamic-imports one locale, so Vite emits one
      chunk per language and the browser fetches the one in use.

   3. THE FALLBACK IS ENGLISH, PER KEY, NOT PER FILE. A half-translated
      Russian file should show Russian where it exists and English where
      it doesn't — never an empty panel, and never "— content pending —"
      for text that does exist in the other language. */
import { loadState, saveState } from "./store.js";
import { STRINGS } from "./strings.js";

export const LANGUAGES = {
  en: { label: "English", luxon: "en" },
  ru: { label: "Русский", luxon: "ru" },
};

export const DEFAULT_LANG = "en";

/* A first-time visitor whose browser is set to Russian should get
   Russian. Only the primary subtag matters: ru-RU, ru-BY and ru all mean
   the same thing here. */
function detectLang() {
  try {
    for (const tag of navigator.languages || [navigator.language]) {
      const base = String(tag).toLowerCase().split("-")[0];
      if (base in LANGUAGES) return base;
    }
  } catch { /* no navigator.languages */ }
  return DEFAULT_LANG;
}

export function currentLang() {
  const saved = loadState().lang;
  return saved && saved in LANGUAGES ? saved : detectLang();
}

export function setLang(lang) {
  if (!(lang in LANGUAGES)) return currentLang();
  const state = loadState();
  state.lang = lang;
  saveState(state);
  document.documentElement.lang = lang;
  return lang;
}

/* ── Content ─────────────────────────────────────────────────────── */

const loaders = {
  en: () => import("./content.js"),
  ru: () => import("./content.ru.js"),
};

const cache = new Map();

async function rawContent(lang) {
  if (cache.has(lang)) return cache.get(lang);
  const mod = await (loaders[lang] || loaders[DEFAULT_LANG])();
  cache.set(lang, mod.CONTENT || {});
  return cache.get(lang);
}

/* Merge one level deeper than Object.assign would: CONTENT is a map of
   maps (`dailyMoonInSign.taurus`), so a shallow merge would replace the
   whole English sign table with a partly-filled Russian one and lose
   every untranslated sign. Empty strings count as missing — that is what
   an untranslated entry in the template looks like. */
function mergeOver(base, over) {
  const out = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(over)])) {
    const b = base[key];
    const o = over[key];
    if (b && o && typeof b === "object" && typeof o === "object"
        && !Array.isArray(b) && !Array.isArray(o)) {
      out[key] = mergeOver(b, o);
    } else if (Array.isArray(o)) {
      /* An untranslated list in the template is `["", "", ""]` — the
         right length, no text. Checking only `length === 0` let that win
         and rendered three empty affirmations, which read on screen as
         the panel having vanished. Drop the blanks; if nothing is left,
         the list isn't translated at all, so fall back whole. */
      const filled = o.filter((x) => String(x || "").trim());
      out[key] = filled.length ? filled : b;
    } else if (o === undefined || o === null || String(o).trim() === "") {
      out[key] = b;
    } else {
      out[key] = o;
    }
  }
  return out;
}

export async function loadContent(lang = currentLang()) {
  const base = await rawContent(DEFAULT_LANG);
  if (lang === DEFAULT_LANG) return base;
  const over = await rawContent(lang);
  return mergeOver(base, over);
}

/* ── Interface strings ───────────────────────────────────────────────
   Bundled, not loaded: the catalogue is a few KB, it is needed before
   anything can render, and a flash of untranslated chrome while a chunk
   downloads would be worse than the bytes. The readings are the opposite
   case on both counts, which is why they load. */

export function t(key, vars) {
  const lang = currentLang();
  const s = (STRINGS[lang] && STRINGS[lang][key]) ??
            (STRINGS[DEFAULT_LANG] && STRINGS[DEFAULT_LANG][key]);
  if (s === undefined) {
    /* A key with no English is a typo, not a translation gap. Say so
       loudly in development rather than printing the key on screen. */
    console.warn(`i18n: no string for "${key}"`);
    return "";
  }
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, name) =>
    (name in vars ? String(vars[name]) : m));
}

/* Marks in the markup, so the HTML stays the source of truth for what is
   on each screen and this never has to duplicate the page structure:

     data-i18n="key"        → textContent
     data-i18n-ph="key"     → placeholder
     data-i18n-aria="key"   → aria-label
     data-i18n-title="key"  → title

   Called at boot and again on every language change. */
export function applyStrings(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const [attr, prop] of [["i18nPh", "placeholder"], ["i18nAria", "aria-label"], ["i18nTitle", "title"]]) {
    const sel = `[data-${prop === "placeholder" ? "i18n-ph" : prop === "title" ? "i18n-title" : "i18n-aria"}]`;
    for (const el of root.querySelectorAll(sel)) {
      el.setAttribute(prop, t(el.dataset[attr]));
    }
  }
  document.documentElement.lang = currentLang();
}

/* ── Counting ────────────────────────────────────────────────────── */

/* Russian has three plural forms, not two, so `n === 1 ? "" : "s"` is
   wrong the moment there are two of something. Intl.PluralRules knows
   the rule for each language; the caller supplies the words.

   plural(2, {one: "чек-ин", few: "чек-ина", many: "чек-инов"})  → "чек-ина"
   plural(2, {one: "check-in", other: "check-ins"})              → "check-ins" */
export function plural(n, forms, lang = currentLang()) {
  let key = "other";
  try {
    key = new Intl.PluralRules(lang).select(n);
  } catch { /* fall through to other */ }
  return forms[key] || forms.other || forms.many || forms.one || "";
}
