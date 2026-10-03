/* ── Supabase client ─────────────────────────────────────────────────
   The anon key here is public by design; RLS is the guard (see the V2
   runbook). Nothing in this file may ever hold the service_role key.

   `configured` lets the app fail loudly at boot with a human explanation
   rather than throwing an opaque error on the first query — the deployed
   build getting no env vars is a real failure mode, and a silent one. */
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configured = Boolean(url && anonKey);

export const supabase = configured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,      // survive a reload
        autoRefreshToken: true,
        detectSessionInUrl: true,  // needed for the email-confirmation link
      },
    })
  : null;

export async function currentSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session || null;
}
