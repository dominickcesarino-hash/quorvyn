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
