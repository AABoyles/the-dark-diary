# The Dark Diary

A leather-bound diary that answers back. Static site, no backend: all AI runs in your browser.

- **Engine order:** Chrome Prompt API (on-device) → transformers.js small Gemma-class model (`FALLBACK_MODEL_ID` in `js/ai.js`) → scripted lines.
- **Storage:** IndexedDB (`js/db.js`). Sessions never leave your browser.
- **Run:** `python3 -m http.server 8000` and open http://localhost:8000 (needs a secure context, i.e. localhost or https).
