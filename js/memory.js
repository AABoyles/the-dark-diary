// Cross-session memory: the diary keeps short facts from what you wrote and
// brings them up in later entries. Facts live in IndexedDB ('memories' store),
// are extracted with compromise.js (js/nlp.js), and are matched to the current
// message by topic word and, when the embedding model is ready, by meaning.
import * as db from './db.js';
import { extractFacts } from './nlp.js';
import { embed, cosine, embedderReady } from './embed.js';

const DAY = 86400000;
const SEMANTIC_THRESHOLD = 0.45;   // cosine similarity for "this is about the same thing"
const MAX_MEMORIES = 400;          // keep the newest; the diary is forgetful, not infinite

const words = (s) => String(s || '').toLowerCase().match(/[a-z']+/g) || [];

/** Extract facts from one user message and store them (deduped per session+topic). */
export async function remember(sessionId, text, ts = Date.now()) {
  let facts = [];
  try { facts = extractFacts(text) || []; } catch { return []; }
  if (!facts.length) return [];
  const existing = await db.listMemories();
  const saved = [];
  for (const f of facts) {
    if (existing.some((m) => m.sessionId === sessionId && m.topic === f.topic)) continue;
    let vec = null;
    if (embedderReady()) {
      try { vec = await embed(f.phrase); } catch { vec = null; }
    }
    const rec = { id: crypto.randomUUID(), sessionId, ts, topic: f.topic, phrase: f.phrase, kind: f.kind, vec };
    await db.putMemory(rec);
    saved.push(rec);
  }
  // prune the oldest beyond the cap
  if (existing.length + saved.length > MAX_MEMORIES) {
    const all = await db.listMemories();
    for (const m of all.slice(MAX_MEMORIES)) await db.deleteMemory(m.id).catch(() => {});
  }
  return saved;
}

/**
 * Memories from OTHER sessions worth mentioning now.
 * Returns [{ phrase, topic, kind, daysAgo, sessionId, relevant }], best first.
 * `relevant` is true when the current text shares the topic word or is
 * semantically close; the rest are older "unprompted" candidates.
 */
export async function recollect(currentSessionId, currentText, { limit = 4 } = {}) {
  const all = (await db.listMemories()).filter((m) => m.sessionId !== currentSessionId);
  if (!all.length) return [];
  const now = Date.now();
  const cur = new Set(words(currentText));
  let curVec = null;
  if (embedderReady() && cur.size >= 2) {
    try { curVec = await embed(currentText); } catch { curVec = null; }
  }
  const scored = all.map((m) => {
    const topicHit = words(m.topic).some((w) => w.length > 2 && cur.has(w));
    const sim = curVec && m.vec ? cosine(curVec, m.vec) : 0;
    const relevant = topicHit || sim >= SEMANTIC_THRESHOLD;
    const recency = 1 / (1 + (now - m.ts) / (30 * DAY));
    return { m, relevant, score: (topicHit ? 1 : 0) + sim + recency * 0.15 };
  });
  scored.sort((a, b) => b.score - a.score);
  // relevant ones first, then a couple of older fallbacks for unprompted recall
  const rel = scored.filter((s) => s.relevant);
  const rest = scored.filter((s) => !s.relevant).sort(() => Math.random() - 0.5);
  return [...rel, ...rest].slice(0, limit).map(({ m, relevant }) => ({
    phrase: m.phrase,
    topic: m.topic,
    kind: m.kind,
    daysAgo: Math.max(0, Math.floor((now - m.ts) / DAY)),
    sessionId: m.sessionId,
    relevant,
  }));
}

/** One-time: learn from sessions written before memories existed. */
export async function backfill() {
  try {
    if (localStorage.getItem('dd-memories-v1')) return;
  } catch { /* storage blocked: just run once per load */ }
  const sessions = await db.listSessions();
  for (const s of sessions) {
    for (const m of s.messages) {
      if (m.role === 'user') await remember(s.id, m.text, m.ts || s.createdAt).catch(() => {});
    }
  }
  try { localStorage.setItem('dd-memories-v1', '1'); } catch { /* ignore */ }
}

/** A line for the LLM's system prompt describing what the diary remembers. */
export function memoryNote(recollections) {
  const rel = (recollections || []).slice(0, 3);
  if (!rel.length) return '';
  const age = (d) => (d === 0 ? 'earlier today' : d === 1 ? 'yesterday' : d < 7 ? `${d} days ago` : d < 14 ? 'last week' : d < 60 ? 'some weeks ago' : 'some time ago');
  const lines = rel.map((r) => `- ${age(r.daysAgo)} they wrote: "${r.phrase}"`);
  return `\n\nFrom earlier entries you remember (bring up at most ONE, only if it fits naturally, as a quiet, faintly menacing aside; never list them):\n${lines.join('\n')}`;
}
