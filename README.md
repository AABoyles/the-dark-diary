# The Dark Diary

A leather-bound diary that answers back. Static site, no backend: all AI runs in your browser.

- **Engine order:** Chrome Prompt API (on-device) → transformers.js in a Web Worker → the scripted ELIZA engine. Nothing large is downloaded without asking: on first open the diary offers a choice of "mind" (`js/mind.js`): the browser's built-in model, a cultivated mind (`onnx-community/gemma-4-E2B-it-ONNX`, WebGPU only), a modest mind (`onnx-community/gemma-3-270m-it-ONNX`, runs on WASM too), or none. Download sizes are fetched from Hugging Face. With data saver on or a slow connection it stays on ELIZA without asking; a built-in model that is already present is used directly. The choice can be changed from the contents page.
- **Off the main thread:** the Gemma model (`js/workers/llm-worker.js`) and the MiniLM sentence-embedding model (`js/workers/embed-worker.js`, `Xenova/all-MiniLM-L6-v2`, ~23 MB) each run in their own Web Worker, so generation never freezes the UI.
- **Fallback chat engine:** while the big model loads or if it fails, `js/eliza.js` (ELIZA-style, in the diary's voice) answers at once. compromise.js (`js/nlp.js`) improves pronoun/verb reflection and fact extraction; the embedding model maps slangy input to the nearest canonical intent (`js/intents.js`) so the rules still fire.
- **Memory across entries:** the diary extracts short facts from what you write (`js/memory.js`, IndexedDB `memories` store), recalls them by topic word or by meaning, and works them into later entries, both in the fallback engine and as a note in the LLM's prompt. Burning an entry also burns what the diary learned from it.
- **Storage:** IndexedDB (`js/db.js`). Sessions never leave your browser.
- **Offline / installable:** `sw.js` precaches the app shell and runtime-caches the transformers.js library, fonts and the model weights (shared with transformers.js's own `transformers-cache`, so weights are stored once). The app asks the browser for persistent storage so the weights aren't evicted.
- **Layout:** the diary opens with the inside cover on the left and the contents on the right. Each entry starts on a right-hand page and continues across spreads.

## Run locally

`python3 -m http.server 8000`, then open http://localhost:8000 (needs localhost or https).

## Deploy

`.github/workflows/pages.yml` publishes to GitHub Pages on every push to `main`. One-time setup: repo **Settings → Pages → Source: GitHub Actions**. All URLs are relative, so it works under `/the-dark-diary/`. Bump `VERSION` in `sw.js` when shipping changed files, so clients refresh their cached shell.
