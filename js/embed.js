/**
 * embed.js - main-thread client for js/workers/embed-worker.js.
 *
 * Semantic intent matching: a message is embedded and compared with the example
 * sentences in js/intents.js. A match returns the intent's canonical sentence,
 * which the ELIZA engine can answer through a keyword rule.
 *
 * Exports:
 *   initEmbedder(onStatus) -> Promise<boolean>   boots once; never rejects; false = unavailable
 *   embedderReady()        -> boolean
 *   embed(text)            -> Promise<Float32Array | null>
 *   embedMany(texts)       -> Promise<Float32Array[] | null>
 *   cosine(a, b)           -> number   (0 for missing, mismatched or zero vectors)
 *   matchIntent(text, { threshold = 0.52 }) -> Promise<{ intent, score, canonical } | null>
 *
 * Model: 'Xenova/all-MiniLM-L6-v2' (see the worker). Vectors are normalized.
 */

import { INTENTS } from './intents.js';

export const EMBED_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const DEFAULT_THRESHOLD = 0.52;
const CACHE_LIMIT = 256;
const BATCH_SIZE = 32;
const MIN_WORDS = 2;
const MAX_WORDS = 60;

let worker = null;
let initPromise = null;
let ready = false;
let exemplars = [];            // [{ intent, canonical, vec }]
let nextId = 1;
const pending = new Map();     // id -> { resolve, reject }
const statusListeners = new Set();
const cache = new Map();       // normalised text -> Float32Array (Map order = recency)

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

function emit(text) {
  for (const fn of statusListeners) {
    try { fn(text); } catch { /* a status listener must never break boot */ }
  }
}

function progressText(event) {
  if (event?.status === 'progress' && Number.isFinite(event.progress)) {
    return `Teaching the diary to read between the lines… ${Math.round(event.progress)}%`;
  }
  if (event?.status === 'initiate') {
    return 'The diary is leafing through its index of human moods…';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Worker plumbing
// ---------------------------------------------------------------------------

function handleMessage(e) {
  const msg = e?.data ?? {};
  if (msg.type === 'progress') {
    const text = progressText(msg.event);
    if (text) emit(text);
    return;
  }
  const slot = pending.get(msg.id);
  if (!slot) return;
  pending.delete(msg.id);
  if (msg.type === 'error') slot.reject(new Error(msg.message || 'Embedding worker error.'));
  else slot.resolve(msg);
}

function send(payload) {
  return new Promise((resolve, reject) => {
    if (!worker) {
      reject(new Error('Embedding worker is not running.'));
      return;
    }
    const id = nextId++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...payload, id });
  });
}

/** Marks the embedder unavailable for good and releases the worker. */
function failWorker(reason) {
  ready = false;
  exemplars = [];
  for (const { reject } of pending.values()) reject(new Error(reason));
  pending.clear();
  if (worker) {
    try { worker.terminate(); } catch { /* ignore */ }
    worker = null;
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

/**
 * Starts the embedding worker, then embeds every intent example once.
 * Shared promise: calling again returns the same boot, and adds onStatus.
 */
export function initEmbedder(onStatus) {
  if (typeof onStatus === 'function') statusListeners.add(onStatus);
  if (!initPromise) initPromise = boot();
  return initPromise;
}

async function boot() {
  try {
    if (typeof Worker === 'undefined') return false;
    worker = new Worker(new URL('./workers/embed-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = handleMessage;
    worker.onerror = (e) => failWorker(e?.message || 'Embedding worker crashed.');

    emit('The diary clears its throat and reaches for its reading glasses…');
    await send({ type: 'init' });

    const meta = [];
    const texts = [];
    for (const { intent, canonical, examples } of INTENTS) {
      for (const text of [canonical, ...(examples || [])]) {
        meta.push({ intent, canonical });
        texts.push(text);
      }
    }
    emit('The diary is committing your moods to memory…');
    const vectors = await embedBatches(texts);
    exemplars = meta.map((m, i) => ({ intent: m.intent, canonical: m.canonical, vec: vectors[i] }));
    ready = true;
    emit('The diary reads between the lines now.');
    return true;
  } catch (err) {
    console.warn('[embed] Embedder unavailable.', err);
    failWorker('Embedder failed to start.');
    return false;
  }
}

export function embedderReady() {
  return ready;
}

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

/** Sends texts to the worker in batches. Throws on any failure. */
async function embedBatches(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const chunk = texts.slice(i, i + BATCH_SIZE);
    const msg = await send({ type: 'embed', texts: chunk });
    const vectors = Array.isArray(msg.vectors) ? msg.vectors : null;
    if (!vectors || vectors.length !== chunk.length) throw new Error('Bad embedding batch.');
    for (const v of vectors) {
      if (!Array.isArray(v) || v.length === 0) throw new Error('Bad embedding vector.');
      out.push(Float32Array.from(v));
    }
  }
  return out;
}

function normKey(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function cacheGet(key) {
  const v = cache.get(key);
  if (v) {
    cache.delete(key);
    cache.set(key, v);
  }
  return v;
}

function cacheSet(key, v) {
  cache.delete(key);
  cache.set(key, v);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

/**
 * Embeds several texts. Cached texts are answered locally; the rest go to the
 * worker in one request. Returns null when the embedder is unavailable.
 */
export async function embedMany(texts) {
  if (!ready || !Array.isArray(texts)) return null;
  const keys = texts.map(normKey);
  const result = new Array(keys.length).fill(null);
  const misses = [];
  const seen = new Set();
  keys.forEach((k, i) => {
    const hit = cacheGet(k);
    if (hit) result[i] = hit;
    else if (!seen.has(k)) { seen.add(k); misses.push(k); }
  });

  if (misses.length) {
    let fresh;
    try {
      fresh = await embedBatches(misses);
    } catch (err) {
      console.warn('[embed] Embedding failed.', err);
      return null;
    }
    const got = new Map();
    misses.forEach((k, j) => { got.set(k, fresh[j]); cacheSet(k, fresh[j]); });
    keys.forEach((k, i) => { if (!result[i]) result[i] = got.get(k) ?? null; });
  }
  return result.every(Boolean) ? result : null;
}

/** One text's embedding, or null when unavailable or the text is empty. */
export async function embed(text) {
  const key = normKey(text);
  if (!key) return null;
  const list = await embedMany([key]);
  return list ? list[0] : null;
}

// ---------------------------------------------------------------------------
// Similarity and matching
// ---------------------------------------------------------------------------

/**
 * Cosine similarity. Vectors from this module are normalized, so this equals
 * their dot product; the norms are still divided out so odd inputs stay sane.
 * Returns 0 for null, empty, mismatched or non-finite input.
 */
export function cosine(a, b) {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Finds the intent whose examples are closest to `text`. Returns null without
 * waiting when the embedder is not ready, or when the text is outside 2-60
 * words, or when the best score is below `threshold`.
 */
export async function matchIntent(text, { threshold = DEFAULT_THRESHOLD } = {}) {
  if (!ready) return null;
  const key = normKey(text);
  const words = key ? key.split(' ').length : 0;
  if (words < MIN_WORDS || words > MAX_WORDS) return null;

  const vec = await embed(key);
  if (!vec || !ready) return null;

  // Best example per intent, then the best intent overall.
  const bestByIntent = new Map(); // intent -> { score, canonical }
  for (const ex of exemplars) {
    const score = cosine(vec, ex.vec);
    const cur = bestByIntent.get(ex.intent);
    if (!cur || score > cur.score) bestByIntent.set(ex.intent, { score, canonical: ex.canonical });
  }
  let top = null;
  for (const [intent, { score, canonical }] of bestByIntent) {
    if (!top || score > top.score) top = { intent, score, canonical };
  }
  if (!top || top.score < threshold) return null;
  return { intent: top.intent, score: top.score, canonical: top.canonical };
}
