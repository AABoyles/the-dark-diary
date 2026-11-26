/**
 * retrieve.js - finds in-voice lines (js/lines.js) for the fallback engine.
 *
 * Two retrievers:
 *   lexicalCandidates(text, opts)   sync. Topic and synonym overlap, weighted by
 *                                   BM25-style idf, plus tag and emotion bonuses.
 *   semanticCandidates(text, opts)  async. Cosine similarity between embeddings
 *                                   of the text and of every line. Uses the
 *                                   MiniLM embedder from js/embed.js unless the
 *                                   caller supplies its own embedFn.
 *
 * Both skip lines whose text is in `exclude`, and lines whose {name} or {topic}
 * slot cannot be filled from the analysis. Scores are in [0, 1).
 *
 * fillSlots(line, { name, topic }) returns the line text with its slots filled,
 * or null when a slot it needs has no value.
 */

import { LINES } from './lines.js';
import { embedMany, embedderReady, cosine } from './embed.js';

const TAG_WEIGHT = 1.5;      // per matched analysis tag
const EMOTION_WEIGHT = 0.6;  // matching emotion, lexical path
const EMOTION_RANK = 0.05;   // matching emotion, semantic ranking only
const SATURATION = 3;        // score = raw / (raw + SATURATION)

const STOP = new Set((
  'a an the and or but of to in on at for with from by as is are was were be been being ' +
  'it its i me my mine you your yours we us our he she they them their this that these those ' +
  'so do did does not no just have has had about if than then what which who whom when how ' +
  'im ive dont didnt cant there here very too really also still get got am s t'
).split(' '));

// Raw word -> canonical topic word, applied before stemming (on both sides).
const ALIAS = {
  mum: 'mother', mom: 'mother', mummy: 'mother', mama: 'mother', mothers: 'mother',
  dad: 'father', daddy: 'father', papa: 'father', fathers: 'father',
  bro: 'brother', brothers: 'brother', sis: 'sister', sisters: 'sister',
  kid: 'children', kids: 'children', child: 'children', son: 'children',
  daughter: 'children', baby: 'children', babies: 'children',
  boyfriend: 'romance', girlfriend: 'romance', partner: 'romance', ex: 'romance',
  love: 'romance', marriage: 'romance', married: 'romance', crush: 'romance',
  breakup: 'romance', kiss: 'romance',
  friend: 'friendship', friends: 'friendship', mate: 'friendship', mates: 'friendship',
  lonely: 'loneliness', alone: 'loneliness', solitude: 'loneliness', lonesome: 'loneliness',
  died: 'grief', dead: 'grief', death: 'grief', dying: 'grief', funeral: 'grief',
  mourning: 'grief', sad: 'grief', cry: 'grief', crying: 'grief',
  scared: 'fear', afraid: 'fear', frightened: 'fear', nervous: 'fear', anxious: 'fear',
  anxiety: 'fear', worried: 'fear', panic: 'fear', terrified: 'fear',
  furious: 'anger', angry: 'anger', mad: 'anger', annoyed: 'anger', rage: 'anger',
  yelled: 'anger', shouted: 'anger', shout: 'anger', hate: 'anger',
  bored: 'boredom', boring: 'boredom', dull: 'boredom',
  happy: 'joy', glad: 'joy', delighted: 'joy', news: 'joy', celebrate: 'joy',
  cook: 'food', cooking: 'food', dinner: 'food', lunch: 'food', eat: 'food', eating: 'food',
  meal: 'food', hungry: 'food', wine: 'food', breakfast: 'food', supper: 'food',
  dream: 'sleep', dreams: 'sleep', dreamt: 'sleep', dreamed: 'sleep', insomnia: 'sleep',
  tired: 'sleep', nap: 'sleep', bed: 'sleep',
  exam: 'school', exams: 'school', test: 'school', college: 'school',
  university: 'school', teacher: 'school', revision: 'school',
  doctor: 'health', ill: 'health', sick: 'health', illness: 'health', hospital: 'health',
  pain: 'health', injury: 'health',
  cat: 'pets', dog: 'pets', pet: 'pets', puppy: 'pets', kitten: 'pets',
  house: 'home', flat: 'home', moving: 'home', move: 'home', moved: 'home',
  christmas: 'holiday', holidays: 'holiday', vacation: 'holiday', easter: 'holiday',
  rain: 'weather', snow: 'weather', sun: 'weather', cold: 'weather', storm: 'weather',
  secret: 'secrets', lie: 'lies', lied: 'lies', lying: 'lies', liar: 'lies', lies: 'lies',
  failed: 'failure', fail: 'failure', failing: 'failure', useless: 'failure', flop: 'failure',
  future: 'plans', tomorrow: 'plans', plan: 'plans', plans: 'plans', someday: 'plans',
  regret: 'regret', regrets: 'regret', wish: 'regret', sorry: 'regret',
  diary: 'diary', journal: 'diary', notebook: 'diary', page: 'diary', pages: 'diary',
  ok: 'terse', okay: 'terse', fine: 'terse', idk: 'terse', dunno: 'terse',
  whatever: 'terse', meh: 'terse',
  job: 'work', jobs: 'work', boss: 'work', office: 'work', career: 'work',
  colleague: 'work', manager: 'work', shift: 'work', deadline: 'work', employer: 'work',
  money: 'money', rent: 'money', bill: 'money', bills: 'money', debt: 'money',
  cash: 'money', salary: 'money', loan: 'money', pay: 'money', broke: 'money',
  goal: 'ambition', goals: 'ambition',
};

// Light suffix stripping: -ing, -ed, -es, -s, and a final -e. Applied to both
// text words and line topics, so the same stem comes out on each side.
function stem(w) {
  let s = w;
  if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2);
  else if (s.length > 4 && /(ch|sh|ss|x|z)es$/.test(s)) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('s') && !/(ss|us|is)$/.test(s)) s = s.slice(0, -1);
  if (s.length > 4 && s.endsWith('e')) s = s.slice(0, -1);
  return s;
}

function key(word) {
  const base = ALIAS[word] ?? ALIAS[stem(word)] ?? word;
  return stem(base);
}

function tokenize(text) {
  return String(text ?? '').toLowerCase().replace(/['’]/g, '').match(/[a-z]+/g) ?? [];
}

function firstString(list) {
  return Array.isArray(list) && typeof list[0] === 'string' && list[0].trim() ? list[0].trim() : null;
}

function emotionOf(value) {
  if (value && typeof value === 'object') value = value.emotion;
  return typeof value === 'string' && value ? value : null;
}

// Index: stemmed topic keys and tags per line, and idf over topics + tags.
const INDEX = LINES.map((line) => ({
  line,
  keys: new Set((line.topics || []).map(key)),
  tags: new Set(line.tags || []),
}));

const IDF = (() => {
  const df = new Map();
  for (const { keys, tags } of INDEX) {
    const seen = new Set([...keys, ...[...tags].map((t) => `tag:${t}`)]);
    for (const k of seen) df.set(k, (df.get(k) ?? 0) + 1);
  }
  const n = LINES.length;
  const idf = new Map();
  for (const [k, d] of df) idf.set(k, Math.log(1 + (n - d + 0.5) / (d + 0.5)));
  return idf;
})();

/**
 * Fills {name} and {topic} in a line. Returns null when a slot in the text has
 * no value. A line without slots returns its text unchanged.
 */
export function fillSlots(line, { name = null, topic = null } = {}) {
  const text = String(line?.text ?? '');
  let ok = true;
  const out = text.replace(/\{(name|topic)\}/g, (_, slot) => {
    const value = slot === 'name' ? name : topic;
    const clean = typeof value === 'string' ? value.trim() : '';
    if (!clean) {
      ok = false;
      return '';
    }
    return clean;
  });
  return ok ? out : null;
}

/**
 * Sync retrieval by topic overlap. Returns up to k entries
 * [{ line, text, score }], best first. Returns [] when nothing scores above zero.
 */
export function lexicalCandidates(text, { analysis = null, emotion = null, k = 8, exclude = new Set() } = {}) {
  const words = tokenize(text);
  const queryKeys = new Set(words.filter((w) => !STOP.has(w)).map(key));
  const name = firstString(analysis?.names);
  const topic = firstString(analysis?.topics);
  const emo = emotionOf(emotion);

  const wanted = new Set();
  if (words.length > 0 && words.length <= 2) wanted.add('evasive');
  if (analysis?.negation) wanted.add('deny-call');
  if (analysis?.tense === 'future') wanted.add('plan');
  if (analysis?.tense === 'past') wanted.add('regret');
  if (analysis?.question === 'about-diary') wanted.add('about-diary');

  const out = [];
  for (const { line, keys, tags } of INDEX) {
    let topicScore = 0;
    for (const qk of queryKeys) {
      if (keys.has(qk)) topicScore += IDF.get(qk) ?? 0;
    }
    let tagHits = 0;
    for (const t of wanted) if (tags.has(t)) tagHits += 1;
    const base = topicScore + tagHits * TAG_WEIGHT;
    if (base <= 0) continue;
    if (exclude.has(line.text)) continue;
    const filled = fillSlots(line, { name, topic });
    if (filled === null || exclude.has(filled)) continue;
    const raw = base + (emo && line.emotion === emo ? EMOTION_WEIGHT : 0);
    out.push({ line, text: filled, score: raw / (raw + SATURATION) });
  }
  out.sort((a, b) => b.score - a.score || (a.line.id < b.line.id ? -1 : a.line.id > b.line.id ? 1 : 0));
  return out.slice(0, Math.max(0, k));
}

// Embedding of each line, cached per embedder. The default embedder is
// js/embed.js, keyed by a private object.
const DEFAULT_KEY = {};
const lineVectorCache = new WeakMap();

// Lines are embedded with their slots replaced by neutral words, so that a
// placeholder does not pull the vector toward the template itself.
const embedTemplate = (text) => text.replace(/\{name\}/g, 'them').replace(/\{topic\}/g, 'it');

async function embedBatch(fn, texts) {
  let out;
  try {
    out = fn ? await fn(texts) : await embedMany(texts);
  } catch {
    return null;
  }
  if (!Array.isArray(out) || out.length !== texts.length || out.some((v) => !v)) return null;
  return out;
}

function lineVectors(fn) {
  const cacheKey = fn || DEFAULT_KEY;
  let pending = lineVectorCache.get(cacheKey);
  if (!pending) {
    pending = embedBatch(fn, LINES.map((l) => embedTemplate(l.text)));
    lineVectorCache.set(cacheKey, pending);
    pending.then((vecs) => { if (!vecs) lineVectorCache.delete(cacheKey); });
  }
  return pending;
}

/**
 * Semantic retrieval. With no embedFn, uses js/embed.js and returns null when
 * the embedder is not ready. embedFn(texts) must return one vector per text
 * (the same shape as embedMany). analysis.emotion gives a small bonus to lines
 * with that emotion. Returns [{ line, text, score }] with score = cosine.
 */
export async function semanticCandidates(text, { k = 8, exclude = new Set(), embedFn = null, analysis = null } = {}) {
  const fn = typeof embedFn === 'function' ? embedFn : null;
  if (!fn && !embedderReady()) return null;

  const query = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!query) return [];

  const queryVecs = await embedBatch(fn, [query]);
  if (!queryVecs) return null;
  const vecs = await lineVectors(fn);
  if (!vecs) return null;

  const [qv] = queryVecs;
  const name = firstString(analysis?.names);
  const topic = firstString(analysis?.topics);
  const emo = emotionOf(analysis?.emotion);

  const scored = [];
  LINES.forEach((line, i) => {
    if (exclude.has(line.text)) return;
    const filled = fillSlots(line, { name, topic });
    if (filled === null || exclude.has(filled)) return;
    const sim = cosine(qv, vecs[i]);
    if (!(sim > 0)) return;
    const rank = sim + (emo && line.emotion === emo ? EMOTION_RANK : 0);
    scored.push({ line, text: filled, score: sim, rank });
  });
  scored.sort((a, b) => b.rank - a.rank || (a.line.id < b.line.id ? -1 : a.line.id > b.line.id ? 1 : 0));
  return scored.slice(0, Math.max(0, k)).map(({ line, text: t, score }) => ({ line, text: t, score }));
}
