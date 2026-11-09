# Quorvyn

A free personal AI assistant website, powered by Google's free Gemini API.

- `index.html` is the chat page.
- `netlify/functions/chat.mjs` is the small server piece that keeps your API key secret.

## Setup ($0, no credit card)

1. Get a free Gemini API key at aistudio.google.com (don't add billing).
2. Upload this folder to a GitHub repository.
3. In Netlify, choose "Import an existing project", pick the repository, and deploy.
4. In Netlify, go to Site configuration > Environment variables and add `GEMINI_API_KEY`.
5. Redeploy. Rename the site to `quorvyn` to get quorvyn.netlify.app.

Settings such as the model and the reply length are at the top of `chat.mjs`.
To use a different model, add a `GEMINI_MODEL` environment variable in Netlify.
Updated

## Who's Better? (`/whosbetter`)

Type something like "LeBron or Jordan?" and get a side-by-side stats card with a short verdict. Works for any sport, for athletes or teams.

- `whosbetter.html` is the page (served at `/whosbetter` on Cloudflare Pages).
- `functions/api/compare.js` is the server piece. It uses the same `GEMINI_API_KEY`.
- Gemini looks the stats up with Google Search, then a second, separate Google search fact-checks every number. Confirmed numbers get a ✓, corrected numbers are swapped in, and anything that couldn't be confirmed gets a ?. Sources are listed under each card.
- Each comparison uses 2 Google-grounded Gemini requests (free tier has a daily limit). Results are cached for 6 hours on a custom domain.
- Optional: set `COMPARE_MODEL` in Cloudflare to choose a different model (default `gemini-2.5-flash`).
