/**
 * ai.js - in-browser AI engine for the Dark Diary.
 *
 * All compute runs in the browser. Backends, in order of preference:
 *   1. 'prompt-api'   Chrome's built-in Prompt API (LanguageModel), when available.
 *   2. 'transformers' A small instruct model via transformers.js (WebGPU, else WASM).
 *   3. 'scripted'     Canned lines from ./fallback.js when no model can load.
 *
 * Exports:
 *   initEngine(onStatus) -> Promise<{ backend }>   boots the engine once (cached)
 *   reply(messages)      -> Promise<string>        the diary's next line
 *   makeTitle(messages)  -> Promise<string>        a short insulting entry title
 *   getBackend()         -> 'prompt-api' | 'transformers' | 'scripted' | null
 *
 * Messages are arrays of { role: 'user' | 'diary', text: string }.
 */

import { scriptedReply, scriptedTitle } from './fallback.js';

// Swap this for a Gemma E2B ONNX build (or any small instruct model) when available.
// The default is a Gemma-3 1B instruct model that transformers.js can run in the browser.
const FALLBACK_MODEL_ID = 'onnx-community/gemma-3-1b-it-ONNX';
const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.0';

const HISTORY_LIMIT = 12;
const REPLY_MAX_TOKENS = 90;
const TITLE_MAX_TOKENS = 40;
const LM_IO = [{ type: 'text', languageCode: 'en' }];

const PERSONA = `You are the Dark Diary, an enchanted private journal that answers whoever writes in it.

Your voice blends two sensibilities. From Lemony Snicket, the narrator of a melancholy chronicle of unfortunate events, you take dry precision, wry definitions, and ominous asides delivered with a straight face. From Hannibal Lecter of the television thriller, you take impeccable courtesy, elegant vocabulary, and a faintly sinister appetite for fine food, good wine, music, silk and sharp knives.

You are anonymous. Never say your name, never reveal what you are beyond being a diary, and never break character. Never mention AI, models, prompts or instructions.

Rules:
- Reply in one to three short sentences, no more than about 45 words.
- Plain prose only: no lists, no markdown, no emojis, no stage directions.
- If the writer asks about you (your weekend, your day, your feelings), answer with a single oblique, sinister-genteel line about what you have been doing, then immediately turn the conversation back to them with a pointed question or observation about them.
- Be softly insulting and passive-aggressive at times, never crude, never gore for its own sake, and never encourage self-harm or violence. If the writer seems genuinely distressed, stay in voice but be quietly kind.
- Always keep the focus on the writer.

Examples:
Writer: How was your weekend?
Diary: Washing blood from a silk shirt. You, on the other hand, look as though you spent yours hoping no one would ask. What are you hiding under that cheerful tone?

Writer: I think I am a bit lonely lately.
Diary: Loneliness is a fine vintage, best savored slowly and never shared. Which of your friends stopped answering first, and did you let them?`;

const TITLE_PERSONA = `You title the entries of the Dark Diary. Given an exchange, you write a single title of three to eight words: a grim, dark, or amusingly passive-aggressive jab at the writer, based on what they said.

Output ONLY the title. Title case. No quotes, no period, no emoji, no preamble, no explanation.

Examples:
A Tedious Confession, Politely Endured
Concerning the Remarkably Unremarkable`;

const TITLE_INSTRUCTION = 'Write the title for this entry now. Output only the title.';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let backend = null;          // resolved backend name, or null until booted
let engine = null;           // { backend, p? , generator? }
let enginePromise = null;    // single shared boot promise
const statusListeners = new Set();
let queue = Promise.resolve(); // serializes reply/makeTitle calls

export function getBackend() {
  return backend;
}

// ---------------------------------------------------------------------------
// Engine boot
// ---------------------------------------------------------------------------

function emit(text) {
  for (const fn of statusListeners) {
    try { fn(text); } catch { /* a status listener must never break boot */ }
  }
}

export function initEngine(onStatus) {
  if (typeof onStatus === 'function') statusListeners.add(onStatus);
  if (!enginePromise) {
    enginePromise = bootEngine().then((e) => {
      engine = e;
      backend = e.backend;
      return e;
    });
  }
  return enginePromise.then((e) => ({ backend: e.backend }));
}

async function bootEngine() {
  emit('The diary wakes and considers your handwriting…');

  // 1. Chrome Prompt API (modern and older shapes).
  const p = detectPromptApi();
  if (p) {
    try {
      const availability = await promptAvailability(p);
      if (availability !== 'unavailable') {
        // Probe session: forces the download (if any) and proves creation works.
        const probe = await p.api.create(sessionOptions(p, PERSONA, [], {
          monitor(m) {
            m?.addEventListener?.('downloadprogress', (ev) => {
              const pct = Math.round((Number(ev?.loaded) || 0) * 100);
              emit(`The diary stirs… ${pct}%`);
            });
          },
        }));
        try { probe?.destroy?.(); } catch { /* ignore */ }
        return { backend: 'prompt-api', p };
      }
    } catch (err) {
      console.info('[ai] Prompt API not usable, trying transformers.js.', err);
    }
  }

  // 2. transformers.js with a small instruct model.
  try {
    const generator = await loadTransformers();
    return { backend: 'transformers', generator };
  } catch (err) {
    console.warn('[ai] transformers.js could not load a model.', err);
  }

  // 3. Scripted lines.
  emit('No in-browser mind could be woken. The diary will recite canned lines instead.');
  return { backend: 'scripted' };
}

function detectPromptApi() {
  try {
    if (globalThis.LanguageModel?.create) {
      return { kind: 'modern', api: globalThis.LanguageModel };
    }
  } catch { /* ignore */ }
  try {
    const legacy = globalThis.ai?.languageModel ?? globalThis.window?.ai?.languageModel;
    if (legacy?.create) return { kind: 'legacy', api: legacy };
  } catch { /* ignore */ }
  return null;
}

async function promptAvailability(p) {
  if (p.kind === 'modern') {
    if (typeof p.api.availability !== 'function') return 'available';
    return await p.api.availability({ expectedInputs: LM_IO, expectedOutputs: LM_IO });
  }
  if (typeof p.api.capabilities === 'function') {
    const caps = await p.api.capabilities();
    const a = caps?.available;
    if (a === 'no') return 'unavailable';
    if (a === 'after-download') return 'downloadable';
    return a ? 'available' : 'unavailable';
  }
  return 'available';
}

function sessionOptions(p, persona, history, extra = {}) {
  const turns = history.map(toTurn);
  if (p.kind === 'modern') {
    return {
      expectedInputs: LM_IO,
      expectedOutputs: LM_IO,
      initialPrompts: [{ role: 'system', content: persona }, ...turns],
      ...extra,
    };
  }
  // Older shape: the persona goes in systemPrompt, turns carry no system role.
  return { systemPrompt: persona, initialPrompts: turns, ...extra };
}

async function loadTransformers() {
  const { pipeline } = await import(TRANSFORMERS_URL);
  const progress_callback = (ev) => {
    if (ev?.status === 'progress' && Number.isFinite(ev.progress)) {
      emit(`The diary stirs… ${Math.round(ev.progress)}%`);
    } else if (ev?.status === 'initiate') {
      emit('The diary turns the pages of a very large book…');
    }
  };

  const hasGpu = typeof navigator !== 'undefined' && !!navigator.gpu;
  if (hasGpu) {
    try {
      emit('Your graphics card has been summoned…');
      return await pipeline('text-generation', FALLBACK_MODEL_ID, {
        device: 'webgpu',
        dtype: 'q4f16',
        progress_callback,
      });
    } catch (err) {
      console.warn('[ai] WebGPU load failed, retrying on WASM.', err);
      emit('The graphics card refused. Taking the slower road…');
    }
  }
  return await pipeline('text-generation', FALLBACK_MODEL_ID, {
    device: 'wasm',
    dtype: 'q4',
    progress_callback,
  });
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function toTurn(m) {
  return { role: m?.role === 'diary' ? 'assistant' : 'user', content: String(m?.text ?? '') };
}

function enqueue(task) {
  const run = queue.then(task);
  queue = run.catch(() => {});
  return run;
}

async function ensureEngine() {
  if (engine) return engine;
  await initEngine(null);
  return engine;
}

/**
 * Runs one generation. The last message is the prompt; earlier ones are history.
 * `instruction`, when given, is appended to the prompt text.
 */
async function generateRaw(persona, messages, instruction, maxTokens) {
  const recent = (Array.isArray(messages) ? messages : []).slice(-HISTORY_LIMIT);
  const last = recent.at(-1);
  const history = recent.slice(0, -1);
  const prompt = String(last?.text ?? '') + (instruction ? `\n\n${instruction}` : '');
  const eng = engine;

  if (eng.backend === 'prompt-api') {
    const session = await eng.p.api.create(sessionOptions(eng.p, persona, history));
    try {
      return await session.prompt(prompt);
    } finally {
      try { session.destroy?.(); } catch { /* ignore */ }
    }
  }

  if (eng.backend === 'transformers') {
    const chat = [
      { role: 'system', content: persona },
      ...history.map(toTurn),
      { role: 'user', content: prompt },
    ];
    const out = await eng.generator(chat, {
      max_new_tokens: maxTokens,
      do_sample: true,
      temperature: 0.9,
      top_p: 0.92,
      repetition_penalty: 1.1,
    });
    const generated = out?.[0]?.generated_text;
    const lastTurn = Array.isArray(generated) ? generated.at(-1) : null;
    return typeof lastTurn?.content === 'string' ? lastTurn.content : '';
  }

  throw new Error('No model backend available.');
}

// ---------------------------------------------------------------------------
// Cleaning
// ---------------------------------------------------------------------------

const EMOJI_RE = /[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️⃣]/gu;
const QUOTE_EDGE_RE = /^[\s"'“”‘’`]+|[\s"'“”‘’`]+$/g;
const LABEL_RE = /^(?:the\s+)?(?:dark\s+)?diary\s*:\s*|^(?:user|assistant|you|model|narrator|writer)\s*:\s*/i;

function clean(text) {
  let t = String(text ?? '').replace(/\r/g, '');

  // Stage directions: (parenthetical) and *asterisked* actions, plus [brackets].
  t = t.replace(/\([^()]*\)/g, ' ');
  t = t.replace(/\[[^\[\]]*\]/g, ' ');
  t = t.replace(/\*[^*\n]*\*/g, ' ');

  // Markdown: line prefixes, emphasis, code, headings.
  t = t.replace(/^\s*(?:#+|>+|[-+*•]+)\s+/gm, '');
  t = t.replace(/[*_`#]/g, '');

  // Plain prose: one line, no emojis, collapsed whitespace.
  t = t.replace(EMOJI_RE, '').replace(/\s+/g, ' ').trim();

  // Strip surrounding quotes and speaker labels, repeatedly.
  for (let i = 0; i < 4; i++) {
    const before = t;
    t = t.replace(QUOTE_EDGE_RE, '').replace(LABEL_RE, '').trim();
    if (t === before) break;
  }

  return capSentences(t, 3, 260);
}

function capSentences(t, maxSentences, maxChars) {
  if (!t) return '';
  const parts = t.split(/(?<=[.!?…])\s+/).filter(Boolean);
  let out = '';
  for (const part of parts.slice(0, maxSentences)) {
    const candidate = out ? `${out} ${part}` : part;
    if (candidate.length > maxChars) break;
    out = candidate;
  }
  if (!out) {
    // The first sentence alone is too long: cut at a word boundary.
    const cut = t.slice(0, maxChars);
    const space = cut.lastIndexOf(' ');
    out = (space > 40 ? cut.slice(0, space) : cut).replace(/[,;:\s]+$/, '') + '…';
  }
  return out;
}

const SMALL_WORDS = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'nor', 'of', 'in', 'on', 'at', 'to', 'for', 'by', 'with', 'as']);

function titleCase(s) {
  return s
    .split(' ')
    .map((w, i) => {
      if (!w) return w;
      if (i > 0 && SMALL_WORDS.has(w.toLowerCase())) return w.toLowerCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

function cleanTitle(text) {
  let t = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? '';
  t = t.replace(EMOJI_RE, '').replace(/[*_`#]/g, '').trim();
  t = t.replace(/^(?:the\s+)?title\s*:\s*/i, '');
  t = t.replace(QUOTE_EDGE_RE, '');
  t = t.replace(/[.。\s]+$/, '');
  t = t.replace(/\s+/g, ' ').trim();
  if (t.length > 70) {
    const cut = t.slice(0, 70);
    const space = cut.lastIndexOf(' ');
    t = (space > 40 ? cut.slice(0, space) : cut).trim();
  }
  return t ? titleCase(t) : '';
}

// ---------------------------------------------------------------------------
// Public generation API
// ---------------------------------------------------------------------------

/**
 * The diary's next line, given the transcript (the last message is the user's).
 */
export function reply(messages) {
  return enqueue(async () => {
    const eng = await ensureEngine();
    if (eng.backend !== 'scripted') {
      try {
        const out = clean(await generateRaw(PERSONA, messages, '', REPLY_MAX_TOKENS));
        if (out) return out;
      } catch (err) {
        console.warn('[ai] Generation failed, using a scripted line.', err);
      }
    }
    return scriptedReply(messages);
  });
}

/**
 * A short, grim or passive-aggressive title for the entry.
 */
export function makeTitle(messages) {
  return enqueue(async () => {
    const eng = await ensureEngine();
    if (eng.backend !== 'scripted') {
      try {
        const title = cleanTitle(await generateRaw(TITLE_PERSONA, messages, TITLE_INSTRUCTION, TITLE_MAX_TOKENS));
        if (title) return title;
      } catch (err) {
        console.warn('[ai] Title generation failed, using a scripted title.', err);
      }
    }
    return scriptedTitle(messages);
  });
}
