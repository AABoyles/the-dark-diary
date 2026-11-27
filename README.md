# The Dark Diary

A leather-bound diary that answers back. Static site, no backend: all AI runs in your browser.

- **Engine order:** Chrome Prompt API (on-device) → transformers.js in a Web Worker → the scripted ELIZA engine. Nothing large is downloaded without asking: on first open the diary offers a choice of "mind" (`js/mind.js`): the browser's built-in model, a cultivated mind (`onnx-community/gemma-4-E2B-it-ONNX`, WebGPU only), a modest mind (`onnx-community/gemma-3-270m-it-ONNX`, runs on WASM too), or none. Download sizes are fetched from Hugging Face. With data saver on or a slow connection it stays on ELIZA without asking; a built-in model that is already present is used directly. The choice can be changed from the contents page.
- **Off the main thread:** the Gemma model (`js/workers/llm-worker.js`) and the MiniLM sentence-embedding model (`js/workers/embed-worker.js`, `Xenova/all-MiniLM-L6-v2`, 8-bit weights, ~23 MB instead of ~90 MB at fp32, falling back to fp32 if the quantized file can't load) each run in their own Web Worker, so generation never freezes the UI.
- **Fallback chat engine:** while the big model loads or if it fails, `js/eliza.js` (ELIZA-style, in the diary's voice) answers at once. compromise.js (`js/nlp.js`) improves pronoun/verb reflection and fact extraction; the embedding model maps slangy input to the nearest canonical intent (`js/intents.js`) so the rules still fire.
- **Memory across entries:** the diary extracts short facts from what you write (`js/memory.js`, IndexedDB `memories` store), recalls them by topic word or by meaning, and works them into later entries, both in the fallback engine and as a note in the LLM's prompt. Burning an entry also burns what the diary learned from it.
- **Persona touches:** the diary occasionally crosses out a cruel word and writes a gentler one (`~~devour~~ enjoy`, `js/strike.js`); sometimes writes first on a fresh page after an absence, on an anniversary, or about an unfinished thread (`js/overture.js`); notices the hour, the day and holidays (`js/timesense.js`); grows more familiar, and possessive, over many entries (`js/familiarity.js`); and revises an entry's insulting title as the conversation goes on, striking the old one out in the contents.
- **Atmosphere:** pages turn with a real leaf around the gutter (`js/pageturn.js`); the diary's script wobbles like a hand with a dipped pen, with the odd ink blot (`js/ink.js`, `css/hand.css`); a candle flickers over the desk and leans in while the diary thinks (`js/candle.js`); and opt-in, synthesized quill, paper and leather sounds can be switched on from the contents page (`js/sound.js`, no audio files). A few hidden phrases get special answers (`js/eggs.js`); try introducing yourself.
- **Accessibility:** keyboard-operable throughout (contents entries are buttons; arrow keys turn pages), focus moves sensibly after every navigation, text and controls meet WCAG AA contrast and 24px targets, replies are read once in full by screen readers (the letter-by-letter ink is decorative), reduced motion writes replies at once and stops page turns and the candle. The contents page has **Candle** (put the flicker out) and **Plain ink** (a legible serif instead of the scripts) settings. `tests/e2e/a11y.test.mjs` runs axe-core (WCAG 2.0–2.2 A/AA rules) and a keyboard-only walkthrough in CI.
- **Safety:** self-harm language is detected by phrase and, once the embedding model is loaded, by meaning (`js/crisis.js`). It is always answered with a kind, menace-free reply pointing to a living person and crisis services, and never passed to the language model.
- **The no-LLM engine** (`js/engine.js`): each reply is chosen from several sources: the ELIZA-style rules (`js/eliza.js`), a bank of ~860 in-voice lines retrieved by meaning or by topic (`js/lines.js`, `js/retrieve.js`), dialogue moves that follow up on people and events, notice dodged questions and abandoned topics (`js/dialogue.js`), and Tracery-style composed lines for the detected emotion (`js/grammar.js`). Understanding (`js/understand.js`: negation, tense, questions, names) and emotion (`js/emotion.js`, by meaning when MiniLM is loaded) steer the choice, and a small local bandit (`js/bandit.js`) gently favours the kinds of reply that keep you writing.
- **Storage:** IndexedDB (`js/db.js`). Sessions never leave your browser.
- **Self-hosted, locked dependencies:** transformers.js, the onnxruntime WASM files, compromise.js and the six web fonts are served from the site's own `vendor/` folder, never a CDN. `scripts/vendor.mjs` (run by `npm install`/`npm ci`) unpacks them from the npm packages and checks every file against the SHA-256 hashes in `vendor.lock.json`; `vendor/` is not committed. To upgrade one, change its exact version under `packages` in `vendor.lock.json` and run `npm run vendor -- --update-lock`.
- **Content Security Policy:** `index.html` allows scripts, styles, fonts and workers from the site itself only (plus `'wasm-unsafe-eval'` for onnxruntime), and network requests only to the site and Hugging Face (for model weights). No inline scripts or styles. `tests/e2e/csp.test.mjs` fails on any violation or any request to another host.
- **Loading:** only the book and its pages load at first; the reply engine, compromise.js and the embedding model are fetched when the cover is opened, the latter two in idle time.
- **Offline / installable:** `sw.js` precaches the app shell, including the vendored fonts and compromise.js, and runtime-caches the vendored transformers.js/onnxruntime files and the model weights (shared with transformers.js's own `transformers-cache`, so weights are stored once). Each deploy gets its own shell cache, so a page never mixes files from two versions. The app asks the browser for persistent storage so the weights aren't evicted.
- **Layout:** the diary opens with the inside cover on the left and the contents on the right. Each entry starts on a right-hand page and continues across spreads.

## Run locally

`npm install` (once, to fetch and verify `vendor/`), then `python3 -m http.server 8000` and open http://localhost:8000 (needs localhost or https).

## Deploy

`.github/workflows/pages.yml` publishes to GitHub Pages on every push to `main`. One-time setup: repo **Settings → Pages → Source: GitHub Actions**. All URLs are relative, so it works under `/the-dark-diary/`. The workflow runs `npm ci` (which vendors and verifies the dependencies), stages `vendor/` with the site, and stamps `sw.js`'s `VERSION` with the commit, so every deploy refreshes clients' cached shell; there is nothing to bump by hand.

## Testing

```sh
npm install          # vendors the runtime files into vendor/ (hash-checked), plus dev tools
npm test             # unit tests (node:test), ~1 s
npx playwright install chromium   # once
npm run test:e2e     # browser end-to-end tests against a local static server, ~1 min
```

Unit tests live in `tests/unit/`; end-to-end tests in `tests/e2e/` run offline (Hugging Face requests are blocked, so the app runs on its scripted engine; model streaming is tested with a stand-in client). Both run in CI on every pull request (`.github/workflows/test.yml`). The site itself has no bundler or build step beyond copying the vendored files.

## Measuring rendering performance

```sh
NODE_PATH=$(npm root -g) node scripts/measure-perf.mjs . --out perf.json
```

Measures idle repaints (the candle), DOM size of a 40-exchange entry, page-turn and typing cost at 4x CPU throttle, and reply writing. `tests/e2e/perf.test.mjs` enforces budgets in CI.

## Measuring the fallback engine

```sh
npm run eval                        # writes eval/report.md and eval/latest.json
npm run eval -- --update-baseline   # also writes eval/baseline.json (commit it)
npm run eval -- --no-nlp            # without compromise.js (regex fallbacks only)
```

Replays the 40 scripted conversations in `eval/corpus.mjs` through the no-LLM pipeline (easter eggs, crisis check, ELIZA engine) with seeded randomness, and reports the generic-fallback rate, repetition within and across sessions, distinct replies, question share and runs, reflection grammar problems, placeholders, crisis handling and false alarms. The report shows deltas against the committed baseline. `tests/unit/eval.test.mjs` enforces the hard floors in CI.

