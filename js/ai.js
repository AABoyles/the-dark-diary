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

import { createLlm } from './llm-client.js';
import { matchIntent } from './embed.js';
import { clean, cleanTitle, streamPrefix } from './clean.js';
import { isCrisis, crisisReply } from './crisis.js';
import { maybeStrike, hasStrike } from './strike.js';
import {
  PERSONA, TITLE_PERSONA, TITLE_INSTRUCTION, REPLY_MAX_TOKENS, TITLE_MAX_TOKENS,
  REPLY_SAMPLING, replyPersona, toTurn, splitTranscript, chatFor,
} from './prompt.js';

// The no-LLM reply engine (line bank, ELIZA rules, grammar, dialogue: ~330 KB) is
// loaded on demand rather than before the book opens (issue #42); the app calls
// loadReplyEngine() when the book opens so the first reply doesn't wait.
let replyKit = null;
export function loadReplyEngine() {
  replyKit ??= Promise.all([
    import('./fallback.js'), import('./understand.js'), import('./emotion.js'), import('./retrieve.js'),
  ]).then(([f, u, e, r]) => ({ ...f, ...u, ...e, ...r }));
  return replyKit;
}

// Which model to load (and whether to load one at all) is decided by the app
// with js/mind.js and passed to initEngine(); see GitHub issues #6 and #25.
// The model runs in a Web Worker (js/workers/llm-worker.js) so generation never blocks the UI.

const LM_IO = [{ type: 'text', languageCode: 'en' }];





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
  const { history, prompt } = splitTranscript(messages, instruction);
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
    const chat = chatFor(persona, messages, instruction);
    let raw = '';
    const text = await eng.llm.generate(chat, { max_new_tokens: maxTokens, ...REPLY_SAMPLING }, onRaw ? { onToken: (piece) => { raw += piece; onRaw(raw); } } : {});
    return typeof text === 'string' ? text : '';
  }

  throw new Error('No model backend available.');
}

// ---------------------------------------------------------------------------
// Public generation API
// ---------------------------------------------------------------------------

const STRIKE_CHANCE = 0.25;   // chance a reply is *allowed* one (the model may still not use it)

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
    if (c.crisis) {
      if (ctx.trace) ctx.trace.crisis = true; // the ledger softens its remarks (issue #50)
      return crisisReply(recentDiaryTexts(messages));
    }
  } catch { /* never let the check itself break a reply; eliza.js has its own phrase check */ }

  // While the model is still loading (weights downloading, warming up) answer
  // at once with the scripted ELIZA-style engine instead of making the user wait.
  if (!engine) return scripted(messages, ctx);
  return enqueue(async () => {
    const eng = await ensureEngine();
    if (eng.backend !== 'scripted') {
      try {
        const allowStrike = !recentDiaryTexts(messages).some(hasStrike) && Math.random() < STRIKE_CHANCE;
        const persona = replyPersona({
          short: eng.short, recollections: ctx.recollections, time: ctx.time, familiarity: ctx.familiarity, allowStrike,
        });
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
        if (out) {
          if (ctx.trace) ctx.trace.family = 'llm';
          return out;
        }
      } catch (err) {
        console.warn('[ai] Generation failed, using a scripted line.', err);
      }
    }
    return scripted(messages, ctx);
  });
}


/**
 * The ELIZA-style engine, helped by the small embedding model: if the user's
 * words are slangy or unusual, map them to the nearest canonical intent first.
 * matchIntent resolves to null at once when the embedder isn't ready.
 */
async function scripted(messages, ctx) {
  const { scriptedReply, analyze, emotionByMeaning, semanticCandidates } = await loadReplyEngine();
  const last = [...messages].reverse().find((m) => m.role === 'user');
  const text = last?.text || '';
  let rewrite = null;
  try { rewrite = (await matchIntent(text))?.canonical || null; } catch { /* ignore */ }
  // When MiniLM is ready: emotion and line retrieval by meaning (issues #31, #34).
  let analysis = null;
  let emotion = null;
  let semantic = null;
  try { analysis = analyze(text); } catch { /* engine analyses it itself */ }
  try { emotion = await emotionByMeaning(text); } catch { /* lexicon fallback in the engine */ }
  try {
    const exclude = new Set([...recentDiaryTexts(messages), ...(ctx.recentAcross || [])]);
    semantic = await semanticCandidates(text, { k: 6, exclude, analysis });
  } catch { /* lexical fallback in the engine */ }
  const line = scriptedReply(messages, { ...ctx, rewrite, analysis, emotion, semantic });
  return maybeStrike(line, { recentDiary: recentDiaryTexts(messages) });
}

/**
 * A short, grim or passive-aggressive title for the entry.
 * With { previous }, a revised, sharper title that differs from it (issue #17).
 */
export function makeTitle(messages, { previous = null } = {}) {
  const scriptedNew = async () => {
    const { scriptedTitle } = await loadReplyEngine();
    for (let i = 0; i < 6; i++) {
      const t = scriptedTitle(messages);
      if (t !== previous) return t;
    }
    return scriptedTitle(messages);
  };
  if (!engine) return scriptedNew();
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
