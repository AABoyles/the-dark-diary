// The no-LLM chat engine: composes a reply from several sources and picks one.
//
//   respond(messages, ctx) -> string            (fills ctx.trace with { path, family, rule })
//
// Sources (issues #31–#34, #36, #37):
//   eliza      js/eliza.js — keyword rules, reflection, memory, crisis, repeats, time
//   retrieval  js/retrieve.js — a bank of in-voice lines, by meaning (ctx.semantic,
//              computed asynchronously by js/ai.js when MiniLM is ready) or by words
//   dialogue   js/dialogue.js — follow-ups, dodged questions, abandoned topics
//   grammar    js/grammar.js — Tracery-style composed lines for the detected emotion
// Understanding comes from js/understand.js (negation, tense, questions, names) and
// js/emotion.js; a bandit (js/bandit.js, ctx.bandit) gently favours the sources that
// keep this writer writing. ELIZA's deliberate paths (crisis, empty input, repeats,
// recollections, time remarks) always win.
//
// ctx: { recollections, time, familiarity, rewrite, trace, analysis?, emotion?,
//        semantic?: [{ text, score, line }], recentAcross?: Iterable<string>, bandit? }

import { elizaReply } from './eliza.js';
import { analyze } from './understand.js';
import { emotionByLexicon } from './emotion.js';
import { lexicalCandidates } from './retrieve.js';
import { LINES } from './lines.js';
import { dialogueState, dialogueMoves } from './dialogue.js';
import { compose } from './grammar.js';

// ELIZA paths that are deliberate and must not be overridden.
const KEEP_ELIZA = new Set(['crisis', 'empty', 'repeat', 'recollection', 'time', 'volunteer']);
// How much each kind of candidate is worth before weighting.
const BASE = {
  elizaSpecific: 0.72,   // a keyword rule matched
  elizaRecall: 0.42,     // quoting an earlier remark
  elizaGeneric: 0.14,    // a catch-all line
  dialogue: 0.62,
  grammar: 0.3,
  grammarEmotional: 0.42,
};

// Nouns the line bank is written about: a {topic} slot is only filled with one of these,
// so the diary never says "two is a scrap of paper..." (found by the eval harness).
const TOPIC_VOCAB = new Set(LINES.flatMap((l) => l.topics || []));
const MIN_LEXICAL = 0.3;       // weaker word overlaps pick unrelated lines

const words = (t) => new Set(String(t || '').toLowerCase().match(/[a-z']+/g) || []);
const capitalise = (t) => String(t || '').replace(/^(\s*["“'‘]?)([a-z])/, (m, q, c) => q + c.toUpperCase());

// Lines that open by quoting the writer ("Cool. A word that...") only fit if the writer said it.
function quotesUnsaid(text, userWords) {
  const m = /^["“]?([A-Za-z']+)[.,!]/.exec(text);
  if (!m) return false;
  const w = m[1].toLowerCase();
  return w.length > 1 && !userWords.has(w) && !['you', 'so', 'well', 'ah', 'oh', 'yes', 'no', 'good', 'there', 'now', 'come'].includes(w);
}

const isQ = (t) => /\?["”']?\s*$/.test(String(t || ''));

function lastUser(messages) {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]?.role === 'user') return String(messages[i].text || '');
  return '';
}

// Only the last part of a very long message is read (issue #46): nothing the
// diary says echoes more than a few words, and this bounds every module's work.
const MAX_PROCESSED_CHARS = 1200;
function trimLong(text) {
  const t = String(text ?? '');
  if (t.length <= MAX_PROCESSED_CHARS) return t;
  return t.slice(-MAX_PROCESSED_CHARS).replace(/^\S*\s+/, '');
}

export function respond(messages = [], ctx = {}) {
  const trace = ctx.trace && typeof ctx.trace === 'object' ? ctx.trace : {};
  const list = (Array.isArray(messages) ? messages.filter((m) => m && typeof m === 'object') : [])
    .map((m, i, all) => (i === all.length - 1 && m.role === 'user' && String(m.text || '').length > MAX_PROCESSED_CHARS
      ? { ...m, text: trimLong(m.text) } : m));
  const latest = lastUser(list);
  let analysis = ctx.analysis;
  try { analysis = analysis || analyze(latest); } catch { analysis = null; }
  let emotion = ctx.emotion && ctx.emotion.emotion ? ctx.emotion : null;
  try { emotion = emotion || emotionByLexicon(latest, analysis); } catch { emotion = { emotion: 'neutral', score: 0 }; }

  // 1. ELIZA, with the analysis (negation) and a trace of the path it took.
  const et = {};
  const elizaText = elizaReply(list, { ...ctx, analysis, trace: et });
  const done = (text, family, path, rule = null) => {
    trace.family = family;
    trace.path = path;
    trace.rule = rule;
    trace.emotion = emotion?.emotion || null;
    return text;
  };
  if (KEEP_ELIZA.has(et.path)) return done(elizaText, 'eliza', et.path, et.rule);

  // 2. Pacing and repetition constraints, as ELIZA applies them.
  const history = list.filter((m) => m.role === 'diary').map((m) => String(m.text || ''));
  const lastQ = isQ(history.at(-1));
  const prevQ = isQ(history.at(-2));
  const mustStatement = lastQ && prevQ;
  const wantQ = mustStatement ? false : Math.random() < (lastQ ? 0.15 : 0.4);
  const across = new Set(ctx.recentAcross || []);
  const inEntry = new Set(history);
  const exclude = new Set([...inEntry, ...across]);

  // 3. Candidates.
  const cands = [];
  const specific = et.path === 'keyword' || et.path === 'rewrite';
  cands.push({
    family: 'eliza',
    text: elizaText,
    path: et.path,
    rule: et.rule,
    base: specific ? BASE.elizaSpecific : et.path === 'recall' ? BASE.elizaRecall : BASE.elizaGeneric,
  });

  try {
    const state = dialogueState(list);
    for (const mv of dialogueMoves(state).slice(0, 2)) {
      // follow up on people and events, not on whatever noun happened to be nearby ("your sock again")
      if (mv.kind === 'follow-up' && state.thread?.kind === 'topic') continue;
      // only a short, evasive reply reads as dodging the diary's question
      if (mv.kind === 'dodged' && (analysis?.words ?? latest.split(/\s+/).length) > 5) continue;
      cands.push({ family: 'dialogue', text: mv.text, path: `dialogue:${mv.kind}`, base: BASE.dialogue });
    }
  } catch { /* no dialogue moves */ }

  try {
    const pool = Array.isArray(ctx.semantic) && ctx.semantic.length
      ? ctx.semantic
      : lexicalCandidates(latest, { analysis, emotion: emotion?.emotion, k: 6, exclude });
    const semantic = Array.isArray(ctx.semantic) && ctx.semantic.length > 0;
    const userWords = words(latest);
    const topic = analysis?.topics?.[0] || null;
    for (const c of pool.slice(0, 4)) {
      if (!c?.text || exclude.has(c.text)) continue;
      if (!semantic && c.score < MIN_LEXICAL) continue;
      // matching by words: the line must be about something the writer actually mentioned,
      // except the lines written for one- or two-word evasions
      if (!semantic && !(c.line?.topics || []).some((t) => userWords.has(t) || userWords.has(`${t}s`))
        && !((c.line?.tags || []).includes('evasive') && userWords.size <= 2)) continue;
      if (c.line?.slots?.includes('topic') && !(topic && TOPIC_VOCAB.has(topic))) continue;
      if (quotesUnsaid(c.text, userWords)) continue;
      // cosine scores sit lower than lexical ones; map both onto roughly the same scale
      const s = semantic ? Math.max(0, Math.min(1, (c.score - 0.2) / 0.45)) : c.score;
      cands.push({ family: 'retrieval', text: c.text, path: semantic ? 'retrieval:semantic' : 'retrieval:lexical', base: 0.25 + 0.6 * s });
    }
  } catch { /* no retrieval */ }

  try {
    const g = compose(emotion?.emotion || 'neutral', {
      name: analysis?.names?.[0] || null,
      topic: analysis?.topics?.[0] || null,
      wantQ,
    });
    if (g?.text && !exclude.has(g.text)) {
      const emotional = emotion && emotion.emotion !== 'neutral' && emotion.score >= 0.3;
      cands.push({ family: 'grammar', text: g.text, path: 'grammar', base: emotional ? BASE.grammarEmotional : BASE.grammar });
    }
  } catch { /* no grammar */ }

  // 4. Score: base x bandit weight x pacing x novelty x a little jitter.
  const families = [...new Set(cands.map((c) => c.family))];
  let weights = {};
  try { weights = ctx.bandit?.weights?.(families) || {}; } catch { weights = {}; }
  let best = null;
  for (const c of cands) {
    const q = isQ(c.text);
    if (mustStatement && q) continue;
    if (inEntry.has(c.text) && c.family !== 'eliza') continue;
    let score = c.base * (weights[c.family] ?? 1);
    score *= q ? (wantQ ? 1.25 : 0.65) : (wantQ ? 0.9 : 1.1);
    if (across.has(c.text)) score *= 0.35;          // seen in an earlier session
    score *= 0.88 + 0.24 * Math.random();
    if (!best || score > best.score) best = { ...c, score };
  }
  if (!best) return done(elizaText, 'eliza', et.path, et.rule);
  return done(capitalise(best.text), best.family, best.path, best.rule || null);
}
