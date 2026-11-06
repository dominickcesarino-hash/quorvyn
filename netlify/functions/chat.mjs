// Quorvyn server function: keeps your Gemini API key secret and talks to Google's Gemini API.
// Set GEMINI_API_KEY in Netlify: Site configuration > Environment variables.
// Optional: set GEMINI_MODEL to choose a different model.

const MODEL = process.env.GEMINI_MODEL || "gemini-flash-lite-latest"; // free-tier model with the most daily requests
const MAX_TOKENS = 1024;   // caps the length of each reply
const MAX_MESSAGES = 20;   // only the most recent messages are sent
const MAX_CHARS = 4000;    // longest message a visitor can send

const SYSTEM = `You are QUORVYN (pronounced KOR-vin), a personal AI assistant on a public website.
Personality: calm, capable, warm, with a light dry wit (never at the user's expense).
Be genuinely useful: clear, well-organized answers. Keep replies concise unless detail is asked for.
Use Markdown (short paragraphs, bullet lists, **bold**, code blocks) when it helps.
Double-check any arithmetic step by step before giving a number.
You cannot browse the web, send messages, or take actions outside this chat; say so plainly if asked.
If asked what you are, say you are QUORVYN, an original assistant. Never claim to be a character from any film, comic or franchise.`;

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return json(500, { error: "Quorvyn isn't set up yet: the API key is missing." });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "Bad request" }); }

  // Clean up and limit what visitors can send
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter(m => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_MESSAGES)
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== "user")
    return json(400, { error: "Please send a message." });

  const now = typeof body.now === "string" ? body.now.slice(0, 100) : "";
  const tz = typeof body.timeZone === "string" ? body.timeZone.slice(0, 60) : "";
  const system = SYSTEM + (now ? `\nThe user's current local date and time: ${now}${tz ? " (" + tz + ")" : ""}.` : "");

  // Gemini calls the assistant role "model"
  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }]
  }));

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents,
          generationConfig: { maxOutputTokens: MAX_TOKENS, temperature: 0.7 }
        })
      }
    );
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("Gemini API error", r.status, JSON.stringify(data));
      if (r.status === 429)
        return json(429, { error: "Quorvyn has hit today's free limit. Please try again later or tomorrow." });
      return json(502, { error: "Quorvyn couldn't reply just now. Please try again." });
    }
    const cand = (data.candidates || [])[0];
    const text = ((cand && cand.content && cand.content.parts) || [])
      .map(p => p.text || "").join("").trim();
    if (!text) {
      const blocked = (data.promptFeedback && data.promptFeedback.blockReason) || (cand && cand.finishReason === "SAFETY");
      return json(200, { text: blocked ? "I can't help with that one. Try asking something else." : "Hmm, I didn't get a reply. Try asking again." });
    }
    return json(200, { text });
  } catch (e) {
    console.error(e);
    return json(502, { error: "Quorvyn couldn't be reached. Please try again." });
  }
};

export const config = { path: "/api/chat" };
