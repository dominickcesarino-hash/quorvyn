// Sends a phone notification (via ntfy.sh) when a brand-new Quorvyn account is made.
// Only works for real accounts created in the last 15 minutes, once per account,
// so nobody can use it to spam you.
const FIREBASE_WEB_KEY = "AIzaSyAYbOHkDHruMjlQEbOizq_8_Ylihfj09C0"; // public web config key

export async function onRequestPost({ request, env }) {
  const topic = env.NTFY_TOPIC;
  if (!topic) return json({ ok: false, error: "NTFY_TOPIC not set" }, 200);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false }, 400); }
  const idToken = body && body.idToken;
  if (!idToken || typeof idToken !== "string") return json({ ok: false }, 400);

  // Ask Firebase who this really is
  const key = env.FIREBASE_API_KEY || FIREBASE_WEB_KEY;
  const r = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + key, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken })
  });
  if (!r.ok) return json({ ok: false }, 401);
  const u = ((await r.json()).users || [])[0];
  if (!u) return json({ ok: false }, 401);
  const created = Number(u.createdAt || 0);
  if (!created || Date.now() - created > 15 * 60 * 1000) return json({ ok: false, reason: "not new" });

  // Once per account (best effort)
  const cache = caches.default;
  const marker = new Request("https://quorvyn-notify.internal/" + u.localId);
  if (await cache.match(marker)) return json({ ok: true, dup: true });
  await cache.put(marker, new Response("1", { headers: { "cache-control": "max-age=86400" } }));

  const name = String(u.displayName || body.name || "Someone").replace(/[\r\n]/g, " ").slice(0, 40);
  const how = (u.providerUserInfo || []).some(p => p.providerId === "google.com") ? "Google" : "email";
  await fetch("https://ntfy.sh/" + encodeURIComponent(topic), {
    method: "POST",
    headers: { "Title": "New Quorvyn account", "Tags": "tada", "Click": "https://quorvyn.pages.dev" },
    body: `${name} just made an account (signed up with ${how}).`
  });
  return json({ ok: true });
}

function json(o, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
}
