/* ── V2-D: export and delete ─────────────────────────────────────────
   Two halves of the same promise: the data is yours, so you can take it
   with you and you can destroy it.

   They need very different privileges, and it is worth being explicit
   about why only one of them is a server function:

   EXPORT runs entirely in the browser on the ordinary anon key. RLS
   already restricts every table to `auth.uid() = user_id`, so "select
   everything" returns exactly this user's rows and nothing else. Routing
   it through a privileged function would mean re-implementing, in code,
   the restriction the database already enforces — more to get wrong, for
   nothing gained.

   DELETE cannot work that way. Removing an auth user requires the
   service_role key, which bypasses RLS and therefore must never reach a
   browser. So deletion is the one operation that goes to an Edge
   Function, which holds that key server-side and deletes only the user
   its verified token identifies. */
import { supabase } from "./supabase.js";

/* ── Export ───────────────────────────────────────────────────────── */

/* Everything the account owns. The check-in rows are taken whole —
   including the moon context and the natal snapshot — because the export
   should stand on its own years later, without needing this app, this
   ephemeris, or an internet connection to be meaningful. */
export async function collectMyData(userId) {
  if (!supabase) throw new Error("not_configured");

  const [profiles, checkIns, rituals] = await Promise.all([
    supabase.from("profiles").select("*").eq("user_id", userId),
    supabase.from("check_ins").select("*").eq("user_id", userId)
      .order("checkin_date", { ascending: true }),
    supabase.from("ritual_completions").select("*").eq("user_id", userId)
      .order("event_date", { ascending: true }),
  ]);

  for (const r of [profiles, checkIns, rituals]) {
    if (r.error) throw r.error;
  }

  const { data: userRes } = await supabase.auth.getUser();

  return {
    exported_at: new Date().toISOString(),
    format_version: 1,
    account: {
      id: userId,
      email: userRes?.user?.email || null,
      created_at: userRes?.user?.created_at || null,
    },
    profile: profiles.data?.[0] || null,
    check_ins: checkIns.data || [],
    ritual_completions: rituals.data || [],
  };
}

/* A download, not a new tab: the file is the point, and some of this is
   personal enough that it should not sit in browser history as a URL.
   The object URL is revoked on the next frame — revoking it synchronously
   can cancel the download in some browsers. */
export function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function exportMyData(userId) {
  const data = await collectMyData(userId);
  const stamp = new Date().toISOString().slice(0, 10);
  downloadJSON(data, `lunar-tracker-${stamp}.json`);
  return {
    checkIns: data.check_ins.length,
    rituals: data.ritual_completions.length,
  };
}

/* ── Delete ───────────────────────────────────────────────────────── */

/* Calls the Edge Function with the session's own access token. Note what
   is NOT sent: there is no user id in this request. The function reads
   the id from the verified token, so this call cannot be pointed at
   another account even by a modified client. */
export async function deleteAccount() {
  if (!supabase) throw new Error("not_configured");

  const { data: sessionRes } = await supabase.auth.getSession();
  const token = sessionRes?.session?.access_token;
  if (!token) throw new Error("not_signed_in");

  const { data, error } = await supabase.functions.invoke("delete-account", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (error) throw error;
  if (!data?.deleted) throw new Error(data?.error || "delete_failed");

  /* The server rows are gone; these are the local remnants. The outbox
     matters most — leaving a queued check-in behind would have it flush
     into the *next* account signed in on this device. */
  for (const key of ["lunarTracker.v1", "lunarTracker.outbox.v1"]) {
    try { window.localStorage.removeItem(key); } catch { /* ignore */ }
  }
  try { await supabase.auth.signOut(); } catch { /* already invalid */ }

  return true;
}
