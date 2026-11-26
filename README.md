# The Dark Diary

A leather-bound diary that answers back. Static site, no backend: all AI runs in your browser.

- **Engine order:** Chrome Prompt API (on-device) → transformers.js with `onnx-community/gemma-4-E2B-it-ONNX` (`FALLBACK_MODEL_ID` in `js/ai.js`; needs transformers.js v4) → scripted lines.
- **Storage:** IndexedDB (`js/db.js`). Sessions never leave your browser.
- **Offline / installable:** `sw.js` precaches the app shell and runtime-caches the transformers.js library, fonts and the model weights (shared with transformers.js's own `transformers-cache`, so weights are stored once). The app asks the browser for persistent storage so the weights aren't evicted.
- **Layout:** the diary opens with the inside cover on the left and the contents on the right. Each entry starts on a right-hand page and continues across spreads.

## Run locally

`python3 -m http.server 8000`, then open http://localhost:8000 (needs localhost or https).

## Deploy

`.github/workflows/pages.yml` publishes to GitHub Pages on every push to `main`. One-time setup: repo **Settings → Pages → Source: GitHub Actions**. All URLs are relative, so it works under `/the-dark-diary/`. Bump `VERSION` in `sw.js` when shipping changed files, so clients refresh their cached shell.
