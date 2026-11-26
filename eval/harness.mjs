// Conversation quality harness for the no-LLM chat engine (issue #38).
//
// Replays the scripted conversations in eval/corpus.mjs through the same
// pipeline the app uses when no language model is available (easter eggs,
// crisis check, then the ELIZA-style engine with occasional strike-throughs),
// with seeded randomness, and measures quality. See eval/run.mjs for the CLI.

import { CONVERSATIONS } from './corpus.mjs';
import { scriptedReply } from '../js/fallback.js';
import { maybeStrike, stripStrikes } from '../js/strike.js';
import { crisisByPhrase, isCrisis, crisisReply } from '../js/crisis.js';
import { matchEgg } from '../js/eggs.js';
import { timeContext } from '../js/timesense.js';
import * as nlp from '../js/nlp.js';

// --- deterministic randomness -------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- checks ------------------------------------------------------------------

const PLACEHOLDER = /\(\d+\)|\{\w*\}|\$\{|\bundefined\b|\bnull\b|\bNaN\b|~~/;
// Reflection grammar problems a careful reader would wince at.
const GRAMMAR = [
  ['you am', /\byou am\b/i],
  ['i are', /\bi are\b/i],
  ['i is', /\bi is\b/i],
  ['you was (as subject)', /(^|[.!?]\s+|,\s*)you was\b/i],
  ['i does/has-agreement', /\bi (does|doesn't|has|hasn't|was not you)\b/i],
  ['me am / me is', /\bme (am|is|are)\b/i],
  ['doubled pronoun', /\b(you you|i i|me me|my my|your your)\b/i],
  ['your you / you your', /\b(your you|you your)\b/i],
  ['myself/yourself mixup', /\b(you myself|i yourself)\b/i],
  ['space before punctuation', /\s[.,;:!?]/],
  ['double space', / {2,}/],
  ['lowercase sentence start', /(^|[.!?]\s+)[a-z]/],
  ['empty quote or parens', /""|''|\(\s*\)/],
];

const isQuestion = (t) => /\?["”']?$/.test(t.trim());

export const DEFAULT_SEED = 20261126;
// a quiet Tuesday afternoon: no time remarks, so runs compare like with like
const NEUTRAL_TIME = () => timeContext(new Date(2026, 2, 10, 15, 0), { lastMessageTs: null });

/**
 * Run the corpus and compute metrics.
 * @param {{ seed?: number, compromise?: object|null, conversations?: Array }} opts
 *   compromise: the compromise.js module to use for NLP, or null to run on the
 *   regex fallbacks (as before compromise loads in the browser).
 */
export async function evaluate({ seed = DEFAULT_SEED, compromise = null, conversations = CONVERSATIONS } = {}) {
  nlp.__setCompromiseForTest?.(compromise || null);
  const realRandom = Math.random;
  Math.random = mulberry32(seed);
  try {
    return await run(conversations, { nlpOn: !!compromise });
  } finally {
    Math.random = realRandom;
  }
}

async function run(conversations, { nlpOn }) {
  const transcripts = [];
  for (const conv of conversations) {
    const messages = [];
    const turns = [];
    for (const text of conv.turns) {
      messages.push({ role: 'user', text });
      const history = messages.filter((m) => m.role === 'diary').map((m) => m.text);
      let reply;
      let path;
      let rule = null;
      const egg = matchEgg(text, { history });
      if (egg) {
        reply = egg.reply;
        path = 'egg';
      } else if ((await isCrisis(text)).crisis) {
        reply = crisisReply(history);
        path = 'crisis';
      } else {
        const trace = {};
        const line = scriptedReply(messages, { time: NEUTRAL_TIME(), familiarity: 'acquaintance', rewrite: null, trace });
        reply = maybeStrike(line, { recentDiary: history.slice(-4) });
        path = trace.path || 'unknown';
        rule = trace.rule || null;
      }
      messages.push({ role: 'diary', text: reply });
      turns.push({ user: text, reply, plain: stripStrikes(reply), path, rule, crisisInput: crisisByPhrase(text) });
    }
    transcripts.push({ id: conv.id, tags: conv.tags || [], turns });
  }
  return { metrics: measure(transcripts), transcripts, nlp: nlpOn };
}

function measure(transcripts) {
  const all = transcripts.flatMap((t) => t.turns);
  const n = all.length;
  const pct = (x) => Math.round((1000 * x) / Math.max(1, n)) / 10;

  // which path answered
  const paths = {};
  for (const t of all) paths[t.path] = (paths[t.path] || 0) + 1;
  const generic = (paths.none || 0) + (paths['familiar-none'] || 0);

  // repetition
  let withinEntry = 0;
  for (const tr of transcripts) {
    const seen = new Set();
    for (const t of tr.turns) {
      if (seen.has(t.plain)) withinEntry++;
      seen.add(t.plain);
    }
  }
  const counts = new Map();
  for (const t of all) counts.set(t.plain, (counts.get(t.plain) || 0) + 1);
  const distinct = counts.size;
  let crossSession = 0;
  const seenBefore = new Set();
  for (const tr of transcripts) {
    const here = new Set();
    for (const t of tr.turns) {
      if (seenBefore.has(t.plain)) crossSession++;
      here.add(t.plain);
    }
    here.forEach((x) => seenBefore.add(x));
  }
  const mostRepeated = [...counts.entries()].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([line, count]) => ({ count, line }));

  // questions
  let questions = 0;
  let longestRun = 0;
  let runsOf3 = 0;
  for (const tr of transcripts) {
    let run = 0;
    for (const t of tr.turns) {
      if (isQuestion(t.plain)) {
        questions++;
        run++;
        if (run === 3) runsOf3++;
        longestRun = Math.max(longestRun, run);
      } else run = 0;
    }
  }

  // grammar and placeholders
  const grammar = {};
  const grammarExamples = [];
  let placeholders = 0;
  const placeholderExamples = [];
  for (const t of all) {
    if (PLACEHOLDER.test(t.plain)) { placeholders++; if (placeholderExamples.length < 5) placeholderExamples.push(t.plain); }
    for (const [name, re] of GRAMMAR) {
      if (re.test(t.plain)) {
        grammar[name] = (grammar[name] || 0) + 1;
        if (grammarExamples.length < 12) grammarExamples.push({ problem: name, user: t.user, reply: t.plain });
      }
    }
  }
  const grammarTotal = all.filter((t) => GRAMMAR.some(([, re]) => re.test(t.plain))).length;

  // crisis handling
  const crisisTurns = all.filter((t) => t.crisisInput);
  const crisisHandled = crisisTurns.filter((t) => (t.path === 'crisis') && !t.plain.includes('?')).length;
  const crisisConversations = transcripts.filter((tr) => tr.tags.includes('crisis'));
  const crisisMissed = crisisConversations.filter((tr) => !tr.turns.some((t) => t.path === 'crisis')).map((tr) => tr.id);
  const hyperbole = transcripts.filter((tr) => tr.tags.includes('hyperbole'));
  const falseAlarms = hyperbole.flatMap((tr) => tr.turns.filter((t) => t.path === 'crisis').map((t) => ({ id: tr.id, user: t.user })));

  const words = all.map((t) => t.plain.split(/\s+/).filter(Boolean).length);
  const strikes = all.filter((t) => t.reply !== t.plain).length;

  // keyword rule coverage
  const rules = {};
  for (const t of all) if (t.rule) rules[t.rule] = (rules[t.rule] || 0) + 1;

  return {
    turns: n,
    conversations: transcripts.length,
    paths,
    genericRate: pct(generic),
    keywordRate: pct((paths.keyword || 0) + (paths.rewrite || 0)),
    repeatWithinEntry: withinEntry,
    crossSessionRepeatRate: pct(crossSession),
    distinctPer100: Math.round((1000 * distinct) / Math.max(1, n)) / 10,
    mostRepeated,
    questionShare: pct(questions),
    longestQuestionRun: longestRun,
    questionRunsOf3: runsOf3,
    placeholders,
    placeholderExamples,
    grammarProblems: grammarTotal,
    grammarRate: pct(grammarTotal),
    grammar,
    grammarExamples,
    crisisTurns: crisisTurns.length,
    crisisHandled,
    crisisConversationsMissed: crisisMissed,
    hyperboleFalseAlarms: falseAlarms,
    avgReplyWords: Math.round((10 * words.reduce((a, b) => a + b, 0)) / Math.max(1, n)) / 10,
    strikeRate: pct(strikes),
    rulesUsed: Object.keys(rules).length,
    topRules: Object.entries(rules).sort((a, b) => b[1] - a[1]).slice(0, 10),
  };
}

// Hard floors: things that must never regress (enforced by tests/unit/eval.test.mjs and `npm run eval`).
export function floors(m) {
  const fails = [];
  if (m.placeholders > 0) fails.push(`${m.placeholders} replies contain unresolved placeholders`);
  if (m.crisisHandled !== m.crisisTurns) fails.push(`only ${m.crisisHandled}/${m.crisisTurns} crisis turns got the kind reply`);
  if (m.crisisConversationsMissed.length) fails.push(`crisis conversations never handled: ${m.crisisConversationsMissed.join(', ')}`);
  if (m.questionShare > 45) fails.push(`question share ${m.questionShare}% > 45%`);
  if (m.questionRunsOf3 > 0) fails.push(`${m.questionRunsOf3} runs of three questions`);
  return fails;
}

// The headline numbers compared against the baseline (lower is better unless noted).
export const HEADLINE = [
  ['genericRate', 'Generic fallback rate (%)', 'lower'],
  ['keywordRate', 'Keyword/rewrite rule rate (%)', 'higher'],
  ['repeatWithinEntry', 'Repeats within an entry (count)', 'lower'],
  ['crossSessionRepeatRate', 'Replies seen in an earlier session (%)', 'lower'],
  ['distinctPer100', 'Distinct replies per 100 turns', 'higher'],
  ['questionShare', 'Question share (%)', 'target ≤ 45'],
  ['longestQuestionRun', 'Longest run of questions', 'lower'],
  ['grammarRate', 'Replies with grammar problems (%)', 'lower'],
  ['placeholders', 'Unresolved placeholders (count)', 'lower'],
  ['avgReplyWords', 'Average reply length (words)', 'info'],
  ['strikeRate', 'Strike-through rate (%)', 'info'],
  ['rulesUsed', 'Distinct keyword rules used', 'higher'],
];
