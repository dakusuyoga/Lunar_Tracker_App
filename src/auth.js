/* ── Authentication ──────────────────────────────────────────────────
   Drives the login card through its states. The design's static export
   only rendered the log-in branch, so sign-up, forgot-password and the
   two "check your inbox" confirmations are built here from the same card
   and the same classes.

   States: login · signup · forgot · sent-confirm · sent-reset

   Supabase Auth does the security-sensitive work — password hashing,
   sessions, confirmation and reset emails. Nothing here handles a
   password beyond passing it straight to the client. */
import { supabase, configured } from "./supabase.js";
import { t } from "./i18n.js";

const $ = (id) => document.getElementById(id);

/* Keys, not text: this screen rewrites its own heading and button on
   every mode change, so the words have to be resolved at that moment
   rather than frozen when the module loaded. */
const COPY = {
  login:  { title: "auth.welcome", lede: "auth.lede",       submit: "auth.login" },
  signup: { title: "auth.create",  lede: "auth.lede",       submit: "auth.createBtn" },
  forgot: { title: "auth.reset",   lede: "auth.resetLede",  submit: "auth.sendReset" },
};

let mode = "login";
let card, form, title, lede, submitBtn, confirmField, forgotRow, segmented, errorEl, noticeEl;

function els() {
  card = document.querySelector("#screen-login .card-auth");
  form = card.querySelector("form.form");
  title = card.querySelector(".display-title");
  lede = card.querySelector(".lede");
  submitBtn = form.querySelector('button[type="submit"]');
  confirmField = card.querySelector("[data-signup-only]");
  forgotRow = card.querySelector(".subtle-action");
  segmented = card.querySelector(".segmented");
  errorEl = card.querySelector(".field-error");

  // One reusable message block for the two "check your inbox" states and
  // for errors that belong to the card rather than to a single field.
  noticeEl = card.querySelector(".auth-notice");
  if (!noticeEl) {
    noticeEl = document.createElement("p");
    noticeEl.className = "auth-notice lede centred";
    noticeEl.hidden = true;
    form.insertAdjacentElement("beforebegin", noticeEl);
  }
}

function setError(msg) {
  if (!errorEl) return;
  errorEl.textContent = msg || "";
  errorEl.hidden = !msg;
}

function setBusy(on, label) {
  submitBtn.disabled = on;
  submitBtn.textContent = on ? label : (COPY[mode] ? t(COPY[mode].submit) : submitBtn.textContent);
}

/* The heading, lede and submit label are written by setMode, so
   applyStrings cannot reach them — re-running the current mode is what
   re-translates this screen. Called when the language changes. */
export function refreshAuthCopy() {
  if (card) setMode(mode);
}

export function setMode(next) {
  mode = next;
  setError("");
  noticeEl.hidden = true;

  const sent = next === "sent-confirm" || next === "sent-reset";
  form.hidden = sent;
  segmented.hidden = sent || next === "forgot";
  forgotRow.hidden = next !== "login";
  if (confirmField) confirmField.hidden = next !== "signup";

  // The password field is irrelevant when all we need is an address.
  const pwField = $("login-password")?.closest(".field");
  if (pwField) pwField.hidden = next === "forgot";

  if (sent) {
    const email = $("login-email").value.trim();
    title.textContent = t("auth.checkInbox");
    noticeEl.hidden = false;
    noticeEl.innerHTML = t(next === "sent-confirm" ? "auth.sentConfirm" : "auth.sentReset",
      { email: "<strong></strong>" });
    noticeEl.querySelector("strong").textContent = email;
    lede.hidden = true;
    return;
  }

  const copy = COPY[next];
  title.textContent = t(copy.title);
  lede.textContent = t(copy.lede);
  lede.hidden = false;
  submitBtn.textContent = t(copy.submit);

  for (const seg of segmented.querySelectorAll(".seg")) {
    const on = seg.dataset.auth === next;
    seg.classList.toggle("is-active", on);
    seg.setAttribute("aria-selected", String(on));
  }
}

/* Supabase's messages are accurate but terse and occasionally alarming.
   These are the cases a friend will actually hit. */
function humanError(err) {
  const m = (err && err.message) || String(err);
  if (/invalid login credentials/i.test(m)) {
    return "That email and password don't match. Try again, or reset your password below.";
  }
  if (/email not confirmed/i.test(m)) {
    return "This account isn't confirmed yet — check your inbox for the link we sent.";
  }
  if (/user already registered/i.test(m)) {
    return "There's already an account with this email. Try logging in instead.";
  }
  if (/password/i.test(m) && /least/i.test(m)) return m;
  if (/fetch|network/i.test(m)) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  return m;
}

async function onSubmit(e) {
  e.preventDefault();
  setError("");

  const email = $("login-email").value.trim();
  const password = $("login-password").value;

  if (!email) return setError("Enter your email address.");

  try {
    if (mode === "forgot") {
      setBusy(true, "Sending…");
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname,
      });
      if (error) throw error;
      setMode("sent-reset");
      return;
    }

    if (!password) return setError("Enter your password.");

    if (mode === "signup") {
      if (password !== $("login-confirm").value) {
        return setError("Those passwords don't match.");
      }
      setBusy(true, "Creating…");
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin + window.location.pathname },
      });
      if (error) throw error;
      // With email confirmation on, there is no session yet — the user
      // has to click the link first.
      if (!data.session) setMode("sent-confirm");
      return;
    }

    setBusy(true, "Signing in…");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    // onAuthStateChange takes it from here.
  } catch (err) {
    setError(humanError(err));
  } finally {
    setBusy(false);
  }
}

export function initAuth() {
  els();

  if (!configured) {
    setMode("login");
    setError(
      "This build has no Supabase credentials. Fill in VITE_SUPABASE_URL and " +
      "VITE_SUPABASE_ANON_KEY in .env and rebuild."
    );
    form.querySelector('button[type="submit"]').disabled = true;
    return;
  }

  for (const btn of card.querySelectorAll("[data-auth]")) {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      setMode(btn.dataset.auth);
    });
  }

  /* Password and Confirm each carry their own eye, so each toggle acts on
     the input it sits beside rather than on a field named here. */
  for (const toggle of card.querySelectorAll('[data-action="toggle-password"]')) {
    const input = toggle.parentElement.querySelector("input");
    if (!input) continue;
    toggle.addEventListener("click", () => {
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      toggle.setAttribute("aria-pressed", String(!showing));
      toggle.setAttribute("aria-label", t(showing ? "auth.showPassword" : "auth.hidePassword"));
    });
  }

  form.addEventListener("submit", onSubmit);
  setMode("login");
}

export async function signOut() {
  if (supabase) await supabase.auth.signOut();
}
