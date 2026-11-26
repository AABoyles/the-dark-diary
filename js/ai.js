/**
 * ai.js - in-browser AI engine for the Dark Diary.
 *
 * All compute runs in the browser. Backends, in order of preference:
 *   1. 'prompt-api'   Chrome's built-in Prompt API (LanguageModel), when available.
 *   2. 'transformers' A small instruct model via transformers.js (WebGPU, else WASM).
 *   3. 'scripted'     Canned lines from ./fallback.js when no model can load.
 *
 * Exports:
 *   initEngine(onStatus, mind) -> Promise<{ backend }>  boots the chosen mind once (cached)
 *   resetEngine()        -> drop the engine so another mind can be booted
 *   builtinStatus()      -> Prompt API state, without downloading
 *   reply(messages, ctx, { onText }) -> Promise<string>  the diary's next line (ctx.recollections: memories from earlier sessions;
 *                        onText: streamed, cleaned pieces as they arrive)
 *   makeTitle(messages)  -> Promise<string>        a short insulting entry title
 *   getBackend()         -> 'prompt-api' | 'transformers' | 'scripted' | null
 *
 * Messages are arrays of { role: 'user' | 'diary', text: string }.
 */

import { scriptedReply, scriptedTitle } from './fallback.js';
import { createLlm } from './llm-client.js';
import { matchIntent } from './embed.js';
import { memoryNote } from './memory.js';
import { clean, cleanTitle, streamPrefix } from './clean.js';
import { isCrisis, crisisReply } from './crisis.js';
import { maybeStrike, stripStrikes, hasStrike } from './strike.js';
import { timeNote } from './timesense.js';
import { familiarityNote } from './familiarity.js';

// Which model to load (and whether to load one at all) is decided by the app
// with js/mind.js and passed to initEngine(); see GitHub issues #6 and #25.
// The model runs in a Web Worker (js/workers/llm-worker.js) so generation never blocks the UI.

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

// Tiny models wander with long prompts: a shorter, stricter persona for them.
const PERSONA_SHORT = `You are a sinister, elegant, anonymous diary that answers the person writing in it.
Speak like a courteous, cultivated gentleman with a dark wit and a taste for fine food, wine and knives.
Reply in one or two short sentences. Plain prose. No lists, no emojis, no stage directions, never mention AI.
If asked about yourself, give one dark, elegant line about what you have been doing, then turn the focus back to the writer.
Example: Writer: How was your weekend? Diary: Washing blood from a silk shirt. And yours, I suspect, was far less productive.`;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let backend = null;          // resolved backend name, or null until booted
let engine = null;           // { backend, p? , llm? }
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

/**
 * Boot the engine once with the chosen "mind":
 *   { builtin: true }                    Chrome's Prompt API model
 *   { plans: [{modelId, device, dtype}, ...], short?: boolean }
 *                                        transformers.js plans, tried in order
 *   null                                 no model: the scripted ELIZA engine
 * While a model loads, reply() answers with the scripted engine at once.
 */
export function initEngine(onStatus, mind = null) {
  if (typeof onStatus === 'function') statusListeners.add(onStatus);
  if (!enginePromise) {
    enginePromise = bootEngine(mind).then((e) => {
      engine = e;
      backend = e.backend;
      return e;
    });
  }
  return enginePromise.then((e) => ({ backend: e.backend }));
}

/** Drop the current engine (e.g. the user picked a different mind). */
export async function resetEngine() {
  const old = enginePromise;
  engine = null;
  backend = null;
  enginePromise = null;
  try { (await old)?.llm?.dispose?.(); } catch { /* ignore */ }
}

/** The Prompt API's state, without downloading anything. */
export async function builtinStatus() {
  const p = detectPromptApi();
  if (!p) return 'none';
  try { return await promptAvailability(p); } catch { return 'unavailable'; }
}

async function bootEngine(mind) {
  if (!mind) return { backend: 'scripted' };
  emit('The diary wakes and considers your handwriting…');

  // 1. Chrome Prompt API (modern and older shapes).
  const p = mind.builtin ? detectPromptApi() : null;
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
      console.info('[ai] Prompt API not usable.', err);
    }
  }

  // 2. transformers.js, in a worker, trying each plan in order.
  for (const plan of mind.plans || []) {
    try {
      const llm = await loadTransformers(plan);
      return { backend: 'transformers', llm, short: !!mind.short };
    } catch (err) {
      console.warn('[ai] transformers.js could not load', plan, err);
    }
  }

  // 3. Scripted lines.
  emit('No in-browser mind could be woken. The diary will make do with old habits.');
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

async function loadTransformers(plan) {
  const onProgress = (ev) => {
    if (ev?.status === 'progress' && Number.isFinite(ev.progress)) {
      emit(`The diary stirs… ${Math.round(ev.progress)}%`);
    } else if (ev?.status === 'initiate') {
      emit('The diary turns the pages of a very large book…');
    }
  };
  if (plan.device === 'webgpu') emit('Your graphics card has been summoned…');
  else emit('The diary sharpens a modest pencil…');
  return await createLlm({ ...plan, onProgress });
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function toTurn(m) {
  // strike markup is display-only; the model sees the gentle text (and isn't encouraged to overuse it)
  return { role: m?.role === 'diary' ? 'assistant' : 'user', content: stripStrikes(String(m?.text ?? '')) };
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
 * `onRaw`, when given, receives the raw text so far as it streams in (issue #7).
 */
async function generateRaw(persona, messages, instruction, maxTokens, onRaw = null) {
  const recent = (Array.isArray(messages) ? messages : []).slice(-HISTORY_LIMIT);
  const last = recent.at(-1);
  const history = recent.slice(0, -1);
  const prompt = String(last?.text ?? '') + (instruction ? `\n\n${instruction}` : '');
  const eng = engine;

  if (eng.backend === 'prompt-api') {
    const session = await eng.p.api.create(sessionOptions(eng.p, persona, history));
    try {
      if (!onRaw || typeof session.promptStreaming !== 'function') return await session.prompt(prompt);
      let raw = '';
      for await (const chunk of session.promptStreaming(prompt)) {
        const c = String(chunk ?? '');
        // Older Chrome builds sent the whole text so far; newer ones send deltas.
        raw = raw && c.startsWith(raw) ? c : raw + c;
        onRaw(raw);
      }
      return raw;
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
    let raw = '';
    const text = await eng.llm.generate(chat, {
      max_new_tokens: maxTokens,
      do_sample: true,
      temperature: 0.9,
      top_p: 0.92,
      repetition_penalty: 1.1,
    }, onRaw ? { onToken: (piece) => { raw += piece; onRaw(raw); } } : {});
    return typeof text === 'string' ? text : '';
  }

  throw new Error('No model backend available.');
}

// ---------------------------------------------------------------------------
// Public generation API
// ---------------------------------------------------------------------------

// Issue #13: occasionally the diary crosses a word out. Rare by design.
const STRIKE_CHANCE = 0.25;   // chance a reply is *allowed* one (the model may still not use it)
const STRIKE_NOTE = `

In this reply only, you may (but need not) cross out ONE cruel word and replace it with a gentler one, written exactly like this: ~~devour~~ enjoy. Use it only if it lands naturally.`;

const recentDiaryTexts = (messages) => messages.filter((m) => m.role === 'diary').slice(-4).map((m) => m.text);

/**
 * The diary's next line, given the transcript (the last message is the user's).
 * ctx: { recollections, time, familiarity } (see js/memory.js, js/timesense.js, js/familiarity.js).
 * Resolves with the final, cleaned text. When `onText` is given, cleaned text is
 * also delivered as it streams in, as appended pieces (issue #7); the caller
 * should reconcile with the resolved text, which may differ in rare cases
 * (e.g. generation failed mid-way and a scripted line was used instead).
 *
 * Self-harm language (issue #10) is checked first, by phrase and, when the
 * embedding model is ready, by meaning; it is answered directly with a kind,
 * menace-free reply and no model is involved.
 */
export async function reply(messages, ctx = {}, { onText } = {}) {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.text || '';
  try {
    const c = await isCrisis(lastUser);
    if (c.crisis) return crisisReply(recentDiaryTexts(messages));
  } catch { /* never let the check itself break a reply; eliza.js has its own phrase check */ }

  // While the model is still loading (weights downloading, warming up) answer
  // at once with the scripted ELIZA-style engine instead of making the user wait.
  if (!engine) return scripted(messages, ctx);
  return enqueue(async () => {
    const eng = await ensureEngine();
    if (eng.backend !== 'scripted') {
      try {
        const allowStrike = !recentDiaryTexts(messages).some(hasStrike) && Math.random() < STRIKE_CHANCE;
        const persona = (eng.short ? PERSONA_SHORT : PERSONA)
          + memoryNote(ctx.recollections)
          + (ctx.time ? prefixed(timeNote(ctx.time)) : '')
          + (ctx.familiarity ? prefixed(familiarityNote(ctx.familiarity)) : '')
          + (allowStrike && !eng.short ? STRIKE_NOTE : '');
        let shown = '';
        const onRaw = onText ? (raw) => {
          const p = streamPrefix(raw, { allowStrike });
          if (p.length > shown.length && p.startsWith(shown)) {
            const piece = p.slice(shown.length);
            shown = p;
            try { onText(piece); } catch { /* a display hiccup must not stop generation */ }
          }
        } : null;
        const out = clean(await generateRaw(persona, messages, '', REPLY_MAX_TOKENS, onRaw), { allowStrike });
        if (out) return out;
      } catch (err) {
        console.warn('[ai] Generation failed, using a scripted line.', err);
      }
    }
    return scripted(messages, ctx);
  });
}

const prefixed = (note) => (note ? `\n\n${note}` : '');

/**
 * The ELIZA-style engine, helped by the small embedding model: if the user's
 * words are slangy or unusual, map them to the nearest canonical intent first.
 * matchIntent resolves to null at once when the embedder isn't ready.
 */
async function scripted(messages, ctx) {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  let rewrite = null;
  try { rewrite = (await matchIntent(last?.text || ''))?.canonical || null; } catch { /* ignore */ }
  const line = scriptedReply(messages, { ...ctx, rewrite });
  return maybeStrike(line, { recentDiary: recentDiaryTexts(messages) });
}

/**
 * A short, grim or passive-aggressive title for the entry.
 * With { previous }, a revised, sharper title that differs from it (issue #17).
 */
export function makeTitle(messages, { previous = null } = {}) {
  const scriptedNew = () => {
    for (let i = 0; i < 6; i++) {
      const t = scriptedTitle(messages);
      if (t !== previous) return t;
    }
    return scriptedTitle(messages);
  };
  if (!engine) return Promise.resolve(scriptedNew());
  return enqueue(async () => {
    const eng = await ensureEngine();
    if (eng.backend !== 'scripted') {
      try {
        const instruction = previous
          ? `The entry is currently titled "${previous}". The conversation has moved on: write a NEW, sharper title for it. Do not reuse the old one. Output only the title.`
          : TITLE_INSTRUCTION;
        const title = cleanTitle(await generateRaw(TITLE_PERSONA, messages, instruction, TITLE_MAX_TOKENS));
        if (title && title !== previous) return title;
      } catch (err) {
        console.warn('[ai] Title generation failed, using a scripted title.', err);
      }
    }
    return scriptedNew();
  });
}
