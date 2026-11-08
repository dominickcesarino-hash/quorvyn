// Quorvyn natural voice (Cloudflare Pages Function): turns text into a spoken audio clip with Google's Gemini TTS.
// Uses the same GEMINI_API_KEY as the chat. Optional: set GEMINI_TTS_MODEL or GEMINI_TTS_VOICE in Cloudflare.

const MODELS = ["gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts"]; // tried in order
const MAX_CHARS = 1200;

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export async function onRequestPost({ request, env }) {
  const key = env.GEMINI_API_KEY;
  if (!key) return json(500, { error: "missing key" });
  let body;
  try { body = await request.json(); } catch { return json(400, { error: "bad request" }); }
  const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_CHARS) : "";
  if (!text) return json(400, { error: "no text" });
  const voice = env.GEMINI_TTS_VOICE || "Charon";
  const prompt = "Say this in a calm, warm, confident voice with a light British accent, like a polished personal assistant:\n\n" + text;
  const models = env.GEMINI_TTS_MODEL ? [env.GEMINI_TTS_MODEL] : MODELS;

  for (let i = 0; i < models.length; i++) {
    let r;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(models[i])}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
          }
        })
      });
    } catch { return json(502, { error: "unreachable" }); }
    // Model not available on this key: try the next one
    if ((r.status === 404 || r.status === 400) && i < models.length - 1) continue;
    if (r.status === 429) return json(429, { error: "limit" });
    if (!r.ok) return json(502, { error: "tts failed" });
    // Pass Google's answer straight through (the browser turns it into sound)
    return new Response(r.body, { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return json(502, { error: "no model" });
}

export const onRequestGet = () => json(405, { error: "Method not allowed" });
