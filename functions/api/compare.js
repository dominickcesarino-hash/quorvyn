// Who's Better: server function for Cloudflare Pages (answers POST /api/compare).
// Uses the same GEMINI_API_KEY as Quorvyn. Gemini looks the stats up on Google Search
// (grounding), then a second, separate Google-grounded pass fact-checks every number.
// Only numbers that pass the check are marked "verified" on the page.
// Optional: set COMPARE_MODEL in Cloudflare to choose a different model.

let MODEL = "gemini-2.5-flash";       // supports Google Search grounding on the free tier
const MAX_QUERY = 120;
const CACHE_SECONDS = 6 * 60 * 60;     // same matchup within 6 hours reuses the checked result

const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...extra } });

const RESEARCH = (query, today) => `Today is ${today}. A user typed: "${query}"

This is a sports "who's better" comparison. It can be ANY sport (basketball, soccer, American football, baseball, hockey, tennis, golf, F1, boxing, MMA, cricket, athletics, swimming, esports, etc.) and can compare two athletes OR two teams.

Use Google Search to look up CURRENT, up-to-date career stats for both. Prefer official and reference sources (league sites, Basketball-Reference, Pro-Football-Reference, Baseball-Reference, Hockey-Reference, ESPN, Transfermarkt, FBref, ATP/WTA, Formula1.com, BoxRec, ESPNcricinfo, Olympics.com, etc.). If a player is still active, use the latest totals including the current season.

Pick 6 to 8 stats that matter most in THAT sport and that exist for BOTH sides. Always include championships/titles and major awards (e.g. rings and MVPs for the NBA, Ballon d'Ors and league titles for soccer, Grand Slams and weeks at No. 1 for tennis, world titles and race wins for F1). State clearly whether a stat is per game, total, regular season, etc.

Reply with ONLY a JSON object in a \`\`\`json code block, exactly in this shape:
{
  "sport": "Basketball",
  "a": {"name": "Full name", "info": "Position · team(s) · years", "active": false},
  "b": {"name": "Full name", "info": "Position · team(s) · years", "active": true},
  "stats": [
    {"label": "Points per game", "note": "Career, regular season", "a": "30.1", "b": "27.0", "better": "higher"}
  ],
  "verdict": "2 to 3 sentences: who is better and why, fair to both, mentioning the deciding numbers.",
  "winner": "a"
}
Rules: values are short strings (numbers where possible, e.g. "6", "27.0", "1,124"). "better" is "higher", "lower" (e.g. ERA, goals against) or "none". "winner" is "a", "b" or "even". Never make up a number: if you can't find a stat for both, leave that stat out.
If this is not a comparison of two sports people or teams, reply with ONLY: {"error": "short friendly reason"}`;

const VERIFY = (data, today) => `Today is ${today}. You are a strict sports fact-checker. Use Google Search to independently check every number below for ${data.a.name} (side "a") and ${data.b.name} (side "b"). Check against official league or reference sites, using the latest totals for active players.

${JSON.stringify(data.stats.map((s, i) => ({ i, label: s.label, note: s.note, a: s.a, b: s.b })))}

For each stat and each side: "ok" if the number is correct (small rounding differences are fine), "fix" with the correct number if it is wrong, or "unknown" if you could not confirm it from a reliable source.
Reply with ONLY a JSON object in a \`\`\`json code block:
{"checks": [{"i": 0, "a": "ok", "a_fix": "", "b": "fix", "b_fix": "27.1", "source": "basketball-reference.com"}]}`;

// Pull the first JSON object out of a model reply
function parseJSON(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : text;
  const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(raw.slice(s, e + 1)); } catch { return null; }
}

const str = (v, n) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "").trim().slice(0, n);

// Ask Gemini with Google Search turned on. Falls back to other models if one is busy or out of quota.
async function grounded(key, prompt) {
  const models = [...new Set([MODEL, "gemini-2.5-flash-lite", "gemini-flash-latest", "gemini-2.0-flash"])];
  const payload = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 4096 }
  });
  let last = { status: 502, quota: false };
  for (const m of models) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`,
      { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: payload });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("Gemini error", m, r.status, JSON.stringify(data).slice(0, 400));
      last = { status: r.status, quota: r.status === 429 };
      continue;
    }
    const cand = (data.candidates || [])[0] || {};
    const text = ((cand.content && cand.content.parts) || []).map(p => p.text || "").join("").trim();
    const gm = cand.groundingMetadata || {};
    const sources = (gm.groundingChunks || [])
      .map(c => c.web).filter(w => w && w.uri)
      .map(w => ({ title: str(w.title, 80) || "Source", url: w.uri }));
    const searched = sources.length > 0 || (gm.webSearchQueries || []).length > 0;
    if (text) return { text, sources, searched };
  }
  throw last;
}

async function handle(req, env, ctx) {
  if (env.COMPARE_MODEL) MODEL = env.COMPARE_MODEL;
  const key = env.GEMINI_API_KEY;
  if (!key) return json(500, { error: "Who's Better isn't set up yet: the API key is missing." });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "Bad request" }); }
  const query = str(body.q, MAX_QUERY).replace(/\s+/g, " ");
  if (query.length < 3) return json(400, { error: "Type two names, like \"LeBron or Jordan?\"" });

  // Cache by the normalized question (works on custom domains; harmless elsewhere)
  const norm = query.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const cacheKey = new Request("https://whosbetter.cache/" + encodeURIComponent(norm));
  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache && body.fresh !== true) {
    const hit = await cache.match(cacheKey).catch(() => null);
    if (hit) return json(200, { ...(await hit.json()), cached: true });
  }

  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York" });

  try {
    // 1) Research with Google Search
    const r1 = await grounded(key, RESEARCH(query, today));
    const d = parseJSON(r1.text);
    if (!d) return json(502, { error: "Couldn't read the stats this time. Please try again." });
    if (d.error) return json(200, { error: str(d.error, 200) });
    if (!d.a || !d.b || !Array.isArray(d.stats) || !d.stats.length)
      return json(502, { error: "Couldn't find stats for both sides. Try full names, like \"LeBron James or Michael Jordan\"." });

    const out = {
      query,
      sport: str(d.sport, 40),
      a: { name: str(d.a.name, 60), info: str(d.a.info, 120), active: !!d.a.active },
      b: { name: str(d.b.name, 60), info: str(d.b.info, 120), active: !!d.b.active },
      stats: d.stats.slice(0, 10).map(s => ({
        label: str(s.label, 40), note: str(s.note, 60),
        a: str(s.a, 24), b: str(s.b, 24),
        better: ["higher", "lower", "none"].includes(s.better) ? s.better : "higher",
        a_ok: false, b_ok: false, fixed: false, source: ""
      })).filter(s => s.label && s.a && s.b),
      verdict: str(d.verdict, 600),
      winner: ["a", "b", "even"].includes(d.winner) ? d.winner : "even",
      asOf: today,
      searched: r1.searched,
      verified: false,
      sources: r1.sources
    };

    // 2) Independent fact-check with Google Search. A number is only marked verified
    //    if the research step actually used Google AND the fact-checker confirmed (or corrected) it.
    try {
      const r2 = await grounded(key, VERIFY(out, today));
      const v = parseJSON(r2.text);
      if (r2.searched && v && Array.isArray(v.checks)) {
        for (const c of v.checks) {
          const s = out.stats[c && c.i];
          if (!s) continue;
          for (const side of ["a", "b"]) {
            const fix = str(c[side + "_fix"], 24);
            if (c[side] === "ok") s[side + "_ok"] = true;
            else if (c[side] === "fix" && fix) { s[side] = fix; s[side + "_ok"] = true; s.fixed = true; }
          }
          s.source = str(c.source, 80);
        }
        out.verified = true;
        out.sources = dedupe([...out.sources, ...r2.sources]);
      }
    } catch (e) { console.error("verify step failed", e && e.status); }

    if (!out.searched) out.stats.forEach(s => { s.a_ok = s.b_ok = false; });
    // If a correction flipped the numbers, the verdict may be stale; flag it for the page.
    out.corrected = out.stats.some(s => s.fixed);

    const res = json(200, out, { "Cache-Control": `public, max-age=${CACHE_SECONDS}` });
    if (cache && out.verified && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, res.clone()).catch(() => {}));
    return res;
  } catch (e) {
    if (e && e.quota) return json(429, { error: "Who's Better has used up its free lookups for now. Please try again later." });
    console.error(e);
    return json(502, { error: "Couldn't reach the stats service. Please try again." });
  }
}

function dedupe(list) {
  const seen = new Set();
  return list.filter(s => { const k = s.title + "|" + s.url; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 12);
}

// Cloudflare Pages Functions: this file answers requests to /api/compare
export const onRequestPost = (context) => handle(context.request, context.env, context);
export const onRequestGet = () => json(405, { error: "Method not allowed" });
