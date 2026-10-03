/* ── delete-account ──────────────────────────────────────────────────
   V2-D. Deletes the CALLING user's auth account. The `on delete cascade`
   on profiles, check_ins and ritual_completions takes their data with it.

   This is the one place the service_role key legitimately lives. That key
   bypasses RLS entirely, so the whole safety of this function rests on a
   single rule:

       THE USER ID COMES FROM THE VERIFIED TOKEN, NEVER FROM THE REQUEST.

   Nothing in the body is read. There is no `user_id` parameter to pass,
   spoof, or get wrong — if there were, anyone with the public anon key
   could delete anyone's account. The caller proves who they are with
   their own JWT, and the only account this can possibly delete is the
   one that token belongs to.

   Deploy:
     supabase functions deploy delete-account

   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the platform;
   do not add them as secrets and never copy the service key anywhere else. */
import { createClient } from "jsr:@supabase/supabase-js@2";

/* Which origins may call this. A comma-separated list, because the app
   has to work from the dev server and from production without one of
   them being left permissive:

     supabase secrets set ALLOWED_ORIGIN=https://lunar.daxyogatherapy.com,http://localhost:5173

   CORS is not the security boundary here — the JWT check is — but a
   narrow origin keeps a stray page on another site from quietly firing
   this at a logged-in browser. Unset means "*", which is why it should
   be set before launch.

   The header must echo ONE origin, not the list, so the request's own
   Origin is matched against the list and returned when it's on it. */
const ALLOWED = (Deno.env.get("ALLOWED_ORIGIN") ?? "*")
  .split(",").map((s) => s.trim()).filter(Boolean);

function corsFor(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  const allow = ALLOWED.includes("*")
    ? (origin || "*")
    : (ALLOWED.includes(origin) ? origin : "");
  const h: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (allow) h["Access-Control-Allow-Origin"] = allow;
  return h;
}

Deno.serve(async (req) => {
  const cors = corsFor(req);

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return json({ error: "missing_token" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!url || !serviceKey) return json({ error: "not_configured" }, 500);

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  /* Verify the token against the auth server rather than decoding it here.
     A JWT is readable by anyone; only the server can say whether it is
     genuine, unexpired, and still belongs to a live user. */
  const { data: claim, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !claim?.user) return json({ error: "invalid_token" }, 401);

  const userId = claim.user.id;   // the only id this function will ever act on

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.error("delete-account failed", userId, error.message);
    return json({ error: "delete_failed" }, 500);
  }

  console.info("account deleted", userId);
  return json({ deleted: true });
});
