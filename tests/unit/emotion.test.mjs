// js/emotion.js: the lexicon (sync, negation-aware) and the meaning route with a
// deterministic fake embedder. No model is loaded; embed.js is never booted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMOTIONS, PROTOTYPES, emotionByLexicon, emotionByMeaning } from '../../js/emotion.js';
import { analyze } from '../../js/understand.js';

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

test('EMOTIONS lists the seven labels with neutral last', () => {
  assert.deepEqual(EMOTIONS, ['grief', 'anger', 'fear', 'shame', 'boredom', 'delight', 'neutral']);
});

test('every emotion has 10 to 14 prototype sentences', () => {
  for (const e of EMOTIONS) {
    assert.ok(Array.isArray(PROTOTYPES[e]), e);
    assert.ok(PROTOTYPES[e].length >= 10 && PROTOTYPES[e].length <= 14, `${e}: ${PROTOTYPES[e].length}`);
    for (const s of PROTOTYPES[e]) assert.equal(typeof s, 'string');
  }
});

// ---------------------------------------------------------------------------
// Lexicon
// ---------------------------------------------------------------------------

const LEXICON_CASES = [
  // delight
  ["I'm so happy about the new flat", 'delight'],
  ["That was brilliant, I'm chuffed to bits", 'delight'],
  ["I'm buzzing about the trip", 'delight'],
  ['Got the job, I am stoked', 'delight'],
  ['Honestly life is lovely right now', 'delight'],
  ['Yay, the sun is out and I feel giddy', 'delight'],
  // grief
  ["I'm gutted, she's gone and I keep crying", 'grief'],
  ['I miss him so much it hurts', 'grief'],
  ['I cried all afternoon after the funeral', 'grief'],
  ["I feel so lonely lately, it's bleak", 'grief'],
  ['My gran passed away on Sunday', 'grief'],
  // anger
  ["I'm livid with my landlord", 'anger'],
  ['I could strangle him honestly', 'anger'],
  ["I'm so pissed off right now", 'anger'],
  ["I'm fuming about the parking fine", 'anger'],
  ['The kids are driving me up the wall', 'anger'],
  // fear
  ["I'm dreading the interview", 'fear'],
  ["I'm terrified of the results", 'fear'],
  ["I'm panicking about money", 'fear'],
  ["I'm nervous about tomorrow", 'fear'],
  ["Honestly I'm bricking it for the exam", 'fear'],
  // shame
  ["I'm mortified about what I said", 'shame'],
  ['I feel so guilty for snapping at her', 'shame'],
  ['I cringed at my own speech', 'shame'],
  ["I'm ashamed of how I behaved", 'shame'],
  ["I messed up again, it's entirely my fault", 'shame'],
  // boredom
  ["I'm so bored of this place", 'boredom'],
  ['Meh, nothing to do again', 'boredom'],
  ["I'm knackered after the shift", 'boredom'],
  ['This meeting is so dull', 'boredom'],
  ["I can't be bothered cooking", 'boredom'],
  // neutral
  ['I went to the shop and bought milk', 'neutral'],
  ['The train was on time', 'neutral'],
  ['Had toast for breakfast', 'neutral'],
  // negation: a cue under negation does not count
  ["I'm not happy", 'not-delight'],
  ["i'm not happy about it at all", 'not-delight'],
  ["It's not that I'm glad, I just feel tired", 'not-delight'],
  ["I'm not angry any more", 'neutral'],
  ["I'm not scared of him", 'neutral'],
  ["I don't feel anything", 'neutral'],
  ["I'm not bored, I'm just noticing", 'neutral'],
];

for (const [text, want] of LEXICON_CASES) {
  test(`lexicon: "${text}" -> ${want}`, () => {
    const got = emotionByLexicon(text);
    assert.ok(got && typeof got.emotion === 'string', 'has an emotion');
    assert.ok(got.score >= 0 && got.score <= 1, `score in [0,1]: ${got.score}`);
    if (want === 'not-delight') {
      assert.notEqual(got.emotion, 'delight', JSON.stringify(got));
    } else {
      assert.equal(got.emotion, want, JSON.stringify(got));
    }
  });
}

test('"i\'m not happy" is not delight, with or without analysis', () => {
  const text = "i'm not happy";
  assert.notEqual(emotionByLexicon(text).emotion, 'delight');
  assert.notEqual(emotionByLexicon(text, analyze(text)).emotion, 'delight');
});

test('a negated delight cue is weak grief, below a plain grief cue', () => {
  const weak = emotionByLexicon("I'm not happy");
  const plain = emotionByLexicon('I am miserable');
  assert.equal(weak.emotion, 'grief');
  assert.ok(weak.score > 0, 'a little grief');
  assert.ok(weak.score < plain.score, `${weak.score} < ${plain.score}`);
});

test('analysis.negated overrides the window rule', () => {
  // With analysis, "happy" is negated, so delight is not counted.
  const text = 'not happy';
  const fake = { negated: ['happy'] };
  assert.notEqual(emotionByLexicon(text, fake).emotion, 'delight');
  // With an analysis that says nothing is negated, the cue counts.
  assert.equal(emotionByLexicon('I am happy', { negated: [] }).emotion, 'delight');
});

test('neutral with score 0 when nothing matches, and empty input is neutral', () => {
  assert.deepEqual(emotionByLexicon('Rain again on the train'), { emotion: 'neutral', score: 0 });
  assert.deepEqual(emotionByLexicon(''), { emotion: 'neutral', score: 0 });
  assert.deepEqual(emotionByLexicon('   '), { emotion: 'neutral', score: 0 });
  assert.deepEqual(emotionByLexicon(null), { emotion: 'neutral', score: 0 });
});

test('more cues give a higher score than one cue', () => {
  const one = emotionByLexicon('I am terrified');
  const two = emotionByLexicon('I am terrified and nervous and dreading it');
  assert.equal(one.emotion, 'fear');
  assert.equal(two.emotion, 'fear');
  assert.ok(two.score > one.score, `${two.score} > ${one.score}`);
});

// ---------------------------------------------------------------------------
// Meaning route
// ---------------------------------------------------------------------------

test('emotionByMeaning returns null without an embedder (embed.js not booted)', async () => {
  assert.equal(await emotionByMeaning('I am so sad about my dad'), null);
});

test('emotionByMeaning returns null for empty text and for a throwing embedder', async () => {
  assert.equal(await emotionByMeaning('', { embedFn: async () => [1, 0] }), null);
  assert.equal(await emotionByMeaning('hello there', {
    embedFn: async () => { throw new Error('boom'); },
  }), null);
});

// Deterministic bag-of-words hashing: each word hashes to a dimension, the vector
// is normalised. Paraphrases that share content words land near their prototypes.
const DIMS = 512;
const STOP = new Set(['i', 'i\'m', 'im', 'a', 'an', 'the', 'and', 'of', 'to', 'in', 'on', 'my', 'me',
  'so', 'it', 'is', 'was', 'at', 'for', 'with', 'that', 'this', 'just', 'all', 'about', 'been', 'be',
  'do', 'did', 'don\'t', 'dont', 'not', 'there', 'i\'ve', 'have', 'had', 'out', 'up', 'they', 'them']);

function hashWord(w) {
  let h = 2166136261;
  for (let i = 0; i < w.length; i++) {
    h ^= w.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % DIMS;
}

function bagEmbed(text) {
  const v = new Array(DIMS).fill(0);
  for (const w of String(text).toLowerCase().match(/[a-z']+/g) || []) {
    if (STOP.has(w) || w.length < 2) continue;
    v[hashWord(w)] += 1;
  }
  const n = Math.hypot(...v);
  return n === 0 ? v : v.map((x) => x / n);
}

function countingEmbed(fn) {
  const calls = [];
  const f = async (t) => { calls.push(t); return fn(t); };
  f.calls = calls;
  return f;
}

const PARAPHRASES = [
  ['I keep sobbing about my grandma who passed away', 'grief'],
  ["I'm so pissed off, my landlord ignored every one of my emails", 'anger'],
  ['I am terrified and my hands keep shaking', 'fear'],
  ["I'm mortified, I tripped in front of the whole room", 'shame'],
  ['bored out of my skull with nothing to do all day', 'boredom'],
  ["over the moon, the offer came through and I'm buzzing", 'delight'],
  ['I went for a walk round the block and read the post', 'neutral'],
];

for (const [text, want] of PARAPHRASES) {
  test(`meaning (fake embedder): "${text}" -> ${want}`, async () => {
    const got = await emotionByMeaning(text, { embedFn: bagEmbed, threshold: 0.2 });
    assert.ok(got, 'an answer, not null');
    assert.equal(got.emotion, want, JSON.stringify(got));
    assert.ok(got.score >= 0 && got.score <= 1);
  });
}

test('meaning: a prototype sentence itself matches its emotion at the default threshold', async () => {
  const got = await emotionByMeaning(PROTOTYPES.grief[0], { embedFn: bagEmbed });
  assert.equal(got.emotion, 'grief', JSON.stringify(got));
});

test('meaning: text with no shared words falls back to neutral below the threshold', async () => {
  const got = await emotionByMeaning('zxq vbn plk', { embedFn: bagEmbed, threshold: 0.35 });
  assert.equal(got.emotion, 'neutral');
  assert.ok(got.score < 0.35, `below threshold: ${got.score}`);
});

test('meaning: prototypes are embedded once per embedFn and cached', async () => {
  const embedFn = countingEmbed(bagEmbed);
  const total = EMOTIONS.reduce((n, e) => n + PROTOTYPES[e].length, 0);
  await emotionByMeaning('I am scared', { embedFn });
  const afterFirst = embedFn.calls.length;
  await emotionByMeaning('I am bored', { embedFn });
  assert.equal(afterFirst, total + 1, 'prototypes plus the text');
  assert.equal(embedFn.calls.length, afterFirst + 1, 'second call embeds only its text');
});
