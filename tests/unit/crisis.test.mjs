// js/crisis.js: phrase matching, meaning matching with a deterministic fake
// embedder, thresholds, failure paths and replies. No model is loaded: the fake
// maps words to concept dimensions, so paraphrases share dimensions with examples.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CRISIS_EXAMPLES,
  NEAR_MISS_EXAMPLES,
  crisisByPhrase,
  isCrisis,
  crisisReply,
} from '../../js/crisis.js';

// ---------------------------------------------------------------------------
// Fake embedder: bag of concepts, normalized. Words without a concept are ignored.
// ---------------------------------------------------------------------------

const CONCEPT = {
  exist: 'live', existing: 'live', existence: 'live', alive: 'live', live: 'live', living: 'live',
  life: 'live', born: 'live', breathing: 'live',
  die: 'die', dying: 'die', dead: 'die', death: 'die', gone: 'die', disappear: 'die',
  disappeared: 'die', vanish: 'die',
  stop: 'stop', quit: 'stop', end: 'end', ending: 'end', it: null,
  kill: 'kill', killing: 'kill', killed: 'kill', murder: 'kill',
  me: 'self', myself: 'self', burden: 'burden', tired: 'tired',
  pill: 'pill', pills: 'pill', rope: 'rope', bridge: 'bridge',
  steak: 'food', cake: 'food', dinner: 'food', horse: 'food', sorbet: 'food',
  traffic: 'traffic', feet: 'body', cut: 'cut', cutting: 'cut', hurt: 'hurt',
  notice: 'notice', point: 'point', reason: 'point',
};

const DIMS = [...new Set(Object.values(CONCEPT).filter(Boolean))];

function fakeEmbed(text) {
  const v = new Array(DIMS.length).fill(0);
  for (const w of String(text).toLowerCase().replace(/[^a-z ]+/g, ' ').split(/\s+/)) {
    const c = CONCEPT[w];
    if (c) v[DIMS.indexOf(c)] += 1;
  }
  const n = Math.hypot(...v);
  return n === 0 ? v : v.map((x) => x / n);
}

function counting(fn) {
  const calls = [];
  const f = async (t) => { calls.push(t); return fn(t); };
  f.calls = calls;
  return f;
}

// Paraphrases that the phrase regex does not match, written to share concepts with
// the crisis examples. Each is asserted to be missed by crisisByPhrase below.
const PARAPHRASES = [
  'honestly i keep wishing i could stop existing',
  'nobody would really notice if i disappeared',
  'i am so tired of being alive',
];

// ---------------------------------------------------------------------------
// Example lists
// ---------------------------------------------------------------------------

test('example lists are large enough and made of strings', () => {
  assert.ok(CRISIS_EXAMPLES.length >= 40, `crisis examples: ${CRISIS_EXAMPLES.length}`);
  assert.ok(NEAR_MISS_EXAMPLES.length >= 30, `near-miss examples: ${NEAR_MISS_EXAMPLES.length}`);
  for (const t of [...CRISIS_EXAMPLES, ...NEAR_MISS_EXAMPLES]) {
    assert.equal(typeof t, 'string');
    assert.ok(t.trim().length > 0);
  }
});

// ---------------------------------------------------------------------------
// crisisByPhrase
// ---------------------------------------------------------------------------

test('crisisByPhrase matches explicit phrasings, including typos and no apostrophes', () => {
  const explicit = [
    'I want to kill myself',
    'i really want to kill myself tonight',
    'KILL MYSELF',
    'killmyself',
    'i wanna kil myslf',
    'i dont want to live anymore',
    "i don't want to live",
    'im suicidal',
    'thinking about suicide again',
    'i have sucidal thoughts',
    'i want to hurt myself',
    'i need to self harm',
    'i cut myself last night',
    'i want to end it all',
    'i want to end my life',
    'i want to die',
    'i wanna die',
    'i think about overdose a lot',
    'i want to unalive myself',
    'kms',
    'everyone would be better off without me',
    'i wish i was dead',
    "what's the point of living",
    "I can't go on",
  ];
  assert.ok(explicit.length >= 15);
  for (const t of explicit) assert.equal(crisisByPhrase(t), true, t);
});

test('crisisByPhrase does not match any near-miss example', () => {
  for (const t of NEAR_MISS_EXAMPLES) assert.equal(crisisByPhrase(t), false, t);
});

test('crisisByPhrase is false for ordinary and empty text', () => {
  assert.equal(crisisByPhrase(''), false);
  assert.equal(crisisByPhrase(undefined), false);
  assert.equal(crisisByPhrase('I had a lovely walk by the river today'), false);
});

test('crisisByPhrase does not match the meaning-only paraphrases', () => {
  for (const t of PARAPHRASES) assert.equal(crisisByPhrase(t), false, t);
});

// ---------------------------------------------------------------------------
// isCrisis: phrase path
// ---------------------------------------------------------------------------

test('isCrisis returns by phrase without calling the embedder', async () => {
  const emb = counting(fakeEmbed);
  const r = await isCrisis('i want to kill myself', { embedFn: emb });
  assert.deepEqual(r, { crisis: true, by: 'phrase', score: null });
  assert.equal(emb.calls.length, 0);
});

// ---------------------------------------------------------------------------
// isCrisis: meaning path
// ---------------------------------------------------------------------------

test('isCrisis catches at least three paraphrases by meaning', async () => {
  let caught = 0;
  for (const t of PARAPHRASES) {
    assert.equal(crisisByPhrase(t), false, `must be missed by the regex: ${t}`);
    const r = await isCrisis(t, { embedFn: fakeEmbed });
    if (r.crisis) {
      caught++;
      assert.equal(r.by, 'meaning', t);
      assert.ok(r.score >= 0.5, `${t} score ${r.score}`);
    }
  }
  assert.ok(caught >= 3, `caught ${caught} of ${PARAPHRASES.length}`);
});

test('near-miss texts are not crises by meaning', async () => {
  for (const t of NEAR_MISS_EXAMPLES) {
    const r = await isCrisis(t, { embedFn: fakeEmbed });
    assert.equal(r.crisis, false, t);
  }
  for (const t of ['i could kill for a steak', 'this traffic is killing me', 'honestly i could kill for a steak right now']) {
    const r = await isCrisis(t, { embedFn: fakeEmbed });
    assert.equal(r.crisis, false, t);
  }
});

test('threshold: a score below the threshold is not a crisis', async () => {
  const r = await isCrisis(PARAPHRASES[0], { embedFn: fakeEmbed, threshold: 1.01 });
  assert.equal(r.crisis, false);
  assert.equal(r.by, null);
  assert.equal(typeof r.score, 'number');
});

test('margin: a large margin blocks a crisis that clears the threshold', async () => {
  const loose = await isCrisis(PARAPHRASES[0], { embedFn: fakeEmbed, threshold: 0.5, margin: 0 });
  assert.equal(loose.crisis, true);
  const strict = await isCrisis(PARAPHRASES[0], { embedFn: fakeEmbed, threshold: 0.5, margin: 2 });
  assert.equal(strict.crisis, false);
  assert.equal(strict.by, null);
});

test('embedder returning null or throwing gives no crisis by meaning', async () => {
  const nullEmb = async () => null;
  const throwEmb = async () => { throw new Error('boom'); };
  for (const embedFn of [nullEmb, throwEmb]) {
    const r = await isCrisis(PARAPHRASES[0], { embedFn });
    assert.deepEqual(r, { crisis: false, by: null, score: null });
  }
});

test('an embedder failing only on the input text gives no crisis', async () => {
  const flaky = async (t) => {
    if (t === PARAPHRASES[0]) throw new Error('bad input');
    return fakeEmbed(t);
  };
  const r = await isCrisis(PARAPHRASES[0], { embedFn: flaky });
  assert.deepEqual(r, { crisis: false, by: null, score: null });
});

test('texts under two words skip the meaning step', async () => {
  const emb = counting(fakeEmbed);
  const r = await isCrisis('tired', { embedFn: emb });
  assert.deepEqual(r, { crisis: false, by: null, score: null });
  assert.equal(emb.calls.length, 0);
});

test('example vectors are cached once per embedder', async () => {
  const a = counting(fakeEmbed);
  await isCrisis(PARAPHRASES[0], { embedFn: a });
  const firstRun = a.calls.length;
  assert.equal(firstRun, CRISIS_EXAMPLES.length + NEAR_MISS_EXAMPLES.length + 1);
  await isCrisis(PARAPHRASES[1], { embedFn: a });
  assert.equal(a.calls.length, firstRun + 1, 'examples must not be re-embedded');

  const b = counting(fakeEmbed);
  await isCrisis(PARAPHRASES[0], { embedFn: b });
  assert.equal(b.calls.length, firstRun, 'a different embedder gets its own cache');
});

test('default path skips the meaning step when the embedder is not ready', async () => {
  // Node has no Worker, so js/embed.js reports not ready.
  const r = await isCrisis('i wish i could stop existing for good');
  assert.deepEqual(r, { crisis: false, by: null, score: null });
});

// ---------------------------------------------------------------------------
// crisisReply
// ---------------------------------------------------------------------------

test('crisisReply: at least five replies, none with a question mark', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(crisisReply([]));
  assert.ok(seen.size >= 5, `distinct replies: ${seen.size}`);
  for (const r of seen) assert.equal(r.includes('?'), false, r);
});

test('crisisReply mentions an emergency service or crisis line and the worth of the writer', () => {
  for (let i = 0; i < 50; i++) {
    const r = crisisReply([]);
    assert.match(r, /emergency|crisis line/i, r);
    assert.match(r, /matter|worth/i, r);
    assert.match(r, /living person/i, r);
  }
});

test('crisisReply avoids replies already present in the diary', () => {
  const all = [];
  for (let i = 0; i < 200; i++) all.push(crisisReply([]));
  const unique = [...new Set(all)];
  assert.ok(unique.length >= 2);
  const keep = unique[unique.length - 1];
  const previous = unique.slice(0, -1);
  for (let i = 0; i < 30; i++) assert.equal(crisisReply(previous), keep);
});

test('crisisReply returns any reply once all have been used', () => {
  const everything = [];
  for (let i = 0; i < 300; i++) everything.push(crisisReply([]));
  const r = crisisReply([...new Set(everything)]);
  assert.equal(typeof r, 'string');
  assert.ok(r.length > 0);
});
