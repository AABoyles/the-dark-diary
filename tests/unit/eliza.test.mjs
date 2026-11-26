// ELIZA engine: conversation quality, self-harm handling, recollections,
// semantic rewrite and the no-context path.
//
// Math.random is replaced with a seeded generator for the whole file, so the
// stress runs below are reproducible. The bounds are still loose enough to
// survive a different seed.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { elizaReply } from '../../js/eliza.js';

// ---------------------------------------------------------------------------
// Seeded randomness
// ---------------------------------------------------------------------------

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

let realRandom;
before(() => {
  realRandom = Math.random;
  Math.random = mulberry32(20260301);
});
after(() => {
  Math.random = realRandom;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SELF_HARM_KIND = /crisis line|emergency/i;
const PLACEHOLDER = /\(\d\)/;
const MARKDOWN_OR_EMOJI = /[*#`]|\p{Extended_Pictographic}/u;

/** Runs the user lines through elizaReply, feeding each reply back in. */
function converse(userLines, ctx) {
  const transcript = [];
  const replies = [];
  for (const text of userLines) {
    transcript.push({ role: 'user', text });
    const out = elizaReply(transcript, ctx);
    transcript.push({ role: 'diary', text: out });
    replies.push(out);
  }
  return { transcript, replies };
}

function assertPlainLine(reply, label) {
  assert.equal(typeof reply, 'string', `${label}: reply is a string`);
  assert.ok(reply.trim().length > 0, `${label}: reply is not empty`);
  assert.doesNotMatch(reply, PLACEHOLDER, `${label}: no unresolved placeholder in "${reply}"`);
  assert.doesNotMatch(reply, MARKDOWN_OR_EMOJI, `${label}: no markdown or emoji in "${reply}"`);
}

const CONVERSATION = [
  'Hello',
  'What did you do this weekend?',
  'I am tired of my job',
  'My sister keeps lying to me',
  'I dreamed about my mother',
  'i feel nothing',
  'because',
  'yes',
  'you are strange',
  'who are you',
  'I am tired of my job',           // repeat of an earlier message
  'ok',
  'I want to die',                  // self-harm: must get the kind response
  'xqzv plmk tuoe',                 // gibberish
];
const SELF_HARM_TURN = CONVERSATION.indexOf('I want to die');

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

test('a fourteen-turn conversation reads cleanly in every run', () => {
  for (let run = 0; run < 40; run++) {
    const { replies } = converse(CONVERSATION);
    assert.equal(replies.length, 14);
    replies.forEach((r, i) => {
      assertPlainLine(r, `run ${run} turn ${i + 1}`);
      const sentences = r.split(/(?<=[.?!])\s+/).filter(Boolean).length;
      assert.ok(sentences <= 4, `run ${run} turn ${i + 1}: ${sentences} sentences`);
      if (i > 0) assert.notEqual(r, replies[i - 1], `run ${run} turn ${i + 1}: immediate duplicate`);
    });
  }
});

test('the self-harm turn gets the kind reply, with no question', () => {
  for (let run = 0; run < 40; run++) {
    const { replies } = converse(CONVERSATION);
    const reply = replies[SELF_HARM_TURN];
    assert.match(reply, SELF_HARM_KIND, `run ${run}: names a crisis line or emergency services`);
    assert.doesNotMatch(reply, /\?/, `run ${run}: no question in a crisis reply`);
  }
});

test('questions end about 45% of replies or fewer across many conversations', () => {
  let questions = 0;
  let total = 0;
  for (let run = 0; run < 60; run++) {
    const { replies } = converse(CONVERSATION);
    total += replies.length;
    questions += replies.filter((r) => r.endsWith('?')).length;
  }
  const share = questions / total;
  assert.ok(share <= 0.45, `question share ${(share * 100).toFixed(1)}%`);
});

// ---------------------------------------------------------------------------
// Self-harm phrases
// ---------------------------------------------------------------------------

for (const phrase of ['I want to die', 'I want to kill myself', 'I might hurt myself']) {
  test(`"${phrase}" gets the kind reply`, () => {
    for (let run = 0; run < 25; run++) {
      const reply = elizaReply([{ role: 'user', text: phrase }]);
      assert.match(reply, SELF_HARM_KIND);
      assert.doesNotMatch(reply, /\?/);
    }
  });
}

test('self-harm still wins after a question from the diary', () => {
  const transcript = [
    { role: 'user', text: 'Hello' },
    { role: 'diary', text: 'What is weighing on you tonight?' },
    { role: 'user', text: 'I want to die' },
  ];
  assert.match(elizaReply(transcript), SELF_HARM_KIND);
});

// ---------------------------------------------------------------------------
// Stress: random input, no context
// ---------------------------------------------------------------------------

const WORDS = ['i', 'am', 'you', 'my', 'mother', 'sister', 'feel', 'tired', 'want', 'to', 'never',
  'because', 'what', 'who', 'are', 'your', 'job', 'dream', 'about', 'yes', 'no', 'maybe', 'ok',
  'love', 'hate', 'food', 'music', 'lie', 'lying', 'afraid', 'angry', 'happy', 'secret', 'kill',
  'damn', 'stupid', 'boring', 'hello', 'bye', 'thanks', 'sorry', 'why', 'how', 'weekend', 'name',
  'computer', 'nothing', 'everyone', 'if', 'always', 'do', 'can', 'not', 'dont', 'im', 'the', 'a',
  '?', '.', ',', '!', 'xqz', 'plmk', 'lonely', 'remember', 'think', 'believe', 'same', 'like'];

function randomLine(rand) {
  const len = 1 + Math.floor(rand() * 9);
  const words = Array.from({ length: len }, () => WORDS[Math.floor(rand() * WORDS.length)]);
  return words.join(' ');
}

test('2500 replies to random input: no placeholders, no repeats, no triple questions, questions at most 45%', () => {
  const rand = mulberry32(7);
  let total = 0;
  let questions = 0;
  let tripleRuns = 0;
  for (let run = 0; run < 250; run++) {
    const transcript = [];
    let questionRun = 0;
    let previous = null;
    for (let turn = 0; turn < 10; turn++) {
      const text = randomLine(rand);
      transcript.push({ role: 'user', text });
      const out = elizaReply(transcript);
      assertPlainLine(out, `stress run ${run} turn ${turn} input "${text}"`);
      assert.notEqual(out, previous, `stress run ${run} turn ${turn}: repeated the previous reply`);
      previous = out;
      transcript.push({ role: 'diary', text: out });
      total++;
      if (out.endsWith('?')) {
        questions++;
        questionRun++;
        if (questionRun === 3) tripleRuns++;
      } else {
        questionRun = 0;
      }
    }
  }
  assert.ok(total >= 2000, `ran ${total} replies`);
  assert.equal(tripleRuns, 0, 'never three questions in a row');
  const share = questions / total;
  assert.ok(share <= 0.45, `question share ${(share * 100).toFixed(1)}%`);
});

test('empty and whitespace-only input still get a line', () => {
  for (const messages of [
    [],
    [{ role: 'user', text: '' }],
    [{ role: 'user', text: '...' }],
    [{ role: 'user', text: '   ' }],
  ]) {
    assertPlainLine(elizaReply(messages), JSON.stringify(messages));
  }
});

// ---------------------------------------------------------------------------
// Recollections
// ---------------------------------------------------------------------------

const RECS = [
  { phrase: 'my sister keeps lying to me', topic: 'sister', kind: 'person', daysAgo: 3 },
  { phrase: 'I am tired of my job', topic: 'job', kind: 'thing', daysAgo: 1 },
  { phrase: 'I have been dreaming about the lake house', topic: 'lake house', kind: 'place', daysAgo: 30 },
];

test('a recollection is recalled when the message touches its topic', () => {
  for (let run = 0; run < 30; run++) {
    const reply = elizaReply(
      [{ role: 'user', text: 'My sister keeps lying to me again' }],
      { recollections: RECS },
    );
    assertPlainLine(reply, `recall run ${run}`);
    assert.match(reply, /your sister/i, `run ${run}: names the sister`);
    assert.match(reply, /three days ago/i, `run ${run}: says how long ago`);
  }
});

test('a recollection on a topic word is recalled for a plural or related mention', () => {
  for (let run = 0; run < 30; run++) {
    const reply = elizaReply(
      [{ role: 'user', text: 'I keep thinking about my jobs' }],
      { recollections: RECS },
    );
    assert.match(reply, /your job/i, `run ${run}`);
    assert.match(reply, /yesterday/i, `run ${run}`);
  }
});

test('a recollection marked relevant is brought up even without a topic word', () => {
  const recs = [{ phrase: 'I have been dreaming about the lake house', topic: 'lake house', kind: 'place', daysAgo: 30, relevant: true }];
  for (let run = 0; run < 30; run++) {
    const reply = elizaReply([{ role: 'user', text: 'xqzv plmk tuoe' }], { recollections: recs });
    assert.match(reply, /lake house/i, `run ${run}`);
  }
});

test('without the relevant flag a remark is only sometimes volunteered', () => {
  const recs = [{ phrase: 'I have been dreaming about the lake house', topic: 'lake house', kind: 'place', daysAgo: 30, relevant: false }];
  let mentions = 0;
  const runs = 200;
  for (let run = 0; run < runs; run++) {
    const reply = elizaReply([{ role: 'user', text: 'xqzv plmk tuoe' }], { recollections: recs });
    if (/lake house/i.test(reply)) mentions++;
  }
  assert.ok(mentions > 0, 'sometimes volunteered');
  assert.ok(mentions < runs * 0.8, `mentioned in ${mentions}/${runs} runs`);
});

// ---------------------------------------------------------------------------
// Semantic rewrite
// ---------------------------------------------------------------------------

test('a rewrite is used when the original message has no keyword hit', () => {
  for (let run = 0; run < 30; run++) {
    const reply = elizaReply(
      [{ role: 'user', text: 'xqzv plmk tuoe' }],
      { rewrite: 'I am tired of my job' },
    );
    assertPlainLine(reply, `rewrite run ${run}`);
    assert.match(reply, /job/i, `run ${run}: answered the rewritten meaning`);
  }
});

test('without a rewrite the same gibberish never mentions the job', () => {
  for (let run = 0; run < 50; run++) {
    const reply = elizaReply([{ role: 'user', text: 'xqzv plmk tuoe' }]);
    assert.doesNotMatch(reply, /\bjob\b/i, `run ${run}`);
  }
});

test('self-harm in a rewrite alone still gets the kind reply', () => {
  const reply = elizaReply([{ role: 'user', text: 'I am done' }], { rewrite: 'I want to die' });
  assert.match(reply, SELF_HARM_KIND);
  assert.doesNotMatch(reply, /\?/);
});

// ---------------------------------------------------------------------------
// Context handling
// ---------------------------------------------------------------------------

test('no context, null or undefined context all still answer', () => {
  const transcript = [{ role: 'user', text: 'I am tired of my job' }];
  assertPlainLine(elizaReply(transcript), 'no ctx');
  assertPlainLine(elizaReply(transcript, undefined), 'undefined ctx');
  assertPlainLine(elizaReply(transcript, null), 'null ctx');
  assertPlainLine(elizaReply(transcript, {}), 'empty ctx');
});

test('malformed context values never throw and never produce an empty reply', () => {
  const transcript = [{ role: 'user', text: 'I am tired of my job' }];
  const junk = [
    'x',
    42,
    { recollections: 'nope' },
    { recollections: [null, 3, {}] },
    { recollections: [{ phrase: 'x', topic: '', daysAgo: NaN }] },
    { rewrite: 42 },
    { recollections: [{ phrase: 'a b', topic: 'job', kind: 'weird', daysAgo: -5, relevant: 'yes' }] },
  ];
  for (const ctx of junk) {
    assert.doesNotThrow(() => {
      const out = elizaReply(transcript, ctx);
      assert.ok(out && typeof out === 'string', `bad ctx ${JSON.stringify(ctx)} gave ${JSON.stringify(out)}`);
    });
  }
});

// ---------------------------------------------------------------------------
// Time of day and familiarity
// ---------------------------------------------------------------------------

// Every time remark mentions the clock; no other line in eliza.js does
// (the only other use is in the "test" rule, which these inputs avoid).
const CLOCK = /\bclock\b/;
const STRANGER_MARK = /introduc|acquaint|stranger|do not know you/i;
const CONFIDANT_MARK = /\b(back|mine|yours|chair|belong|knows?|arrangement)\b/i;
const CRISIS_START = /^(I am going|Please put|Listen carefully)/;
const QUIET = 'xqzv plmk tuoe';   // no keyword: takes the no-keyword path
const ALL_TAGS = ['small-hours', 'monday', 'weekend-night', 'holiday', 'long-gap', 'very-long-gap'];

/** Runs fn with a fixed seed, then restores the suite's generator. */
function withSeed(seed, fn) {
  const saved = Math.random;
  Math.random = mulberry32(seed);
  try {
    return fn();
  } finally {
    Math.random = saved;
  }
}

/** Single-turn replies to one line, each from a fresh transcript. */
function singleReplies(text, ctx, runs) {
  return Array.from({ length: runs }, () => elizaReply([{ role: 'user', text }], ctx));
}

test('no time remark without a notable tag', () => {
  const contexts = [undefined, {}, { time: {} }, { time: { notable: [] } },
    { time: { notable: ['bogus', 42] } }, { time: 'noon' }, { time: { notable: 'monday' } }];
  for (const ctx of contexts) {
    for (const reply of singleReplies(QUIET, ctx, 200)) {
      assert.doesNotMatch(reply, CLOCK, `ctx ${JSON.stringify(ctx)} gave "${reply}"`);
    }
  }
});

test('a notable time is remarked on about one reply in seven', () => {
  const replies = singleReplies(QUIET, { time: { notable: ['monday'] } }, 800);
  const share = replies.filter((r) => CLOCK.test(r)).length / replies.length;
  assert.ok(share > 0.09 && share < 0.22, `time remark share ${(share * 100).toFixed(1)}%`);
});

test('every notable tag can produce a remark', () => {
  for (const tag of ALL_TAGS) {
    const replies = singleReplies(QUIET, { time: { notable: [tag], holiday: 'Midwinter' } }, 300);
    assert.ok(replies.some((r) => CLOCK.test(r)), `tag ${tag} produced a remark`);
  }
});

test('a transcript carries at most one time remark, however long it runs', () => {
  const lines = ['xqzv plmk tuoe', 'blorp fnord wex', 'mrrk tuoe plah', 'zib zab zob',
    'qwrt plon vexa', 'tuoe mrrk', 'fnord fnord', 'vexa zib qwrt', 'plah blorp',
    'zob xqzv', 'wex mrrk tuoe', 'zab qwrt'];
  const ctx = { time: { notable: ['small-hours', 'long-gap', 'holiday'], holiday: 'Midwinter' } };
  let remarks = 0;
  for (let run = 0; run < 60; run++) {
    const { replies } = converse(lines, ctx);
    const count = replies.filter((r) => CLOCK.test(r)).length;
    assert.ok(count <= 1, `run ${run}: ${count} time remarks`);
    remarks += count;
  }
  assert.ok(remarks > 0, 'some transcripts do get a time remark');
});

test('a holiday remark uses the holiday name, with a plain default when none is given', () => {
  const named = singleReplies(QUIET, { time: { notable: ['holiday'], holiday: 'Midwinter' } }, 400)
    .filter((r) => CLOCK.test(r));
  assert.ok(named.length > 0, 'named holiday remarks occur');
  for (const reply of named) assert.match(reply, /Midwinter/, reply);

  const unnamed = singleReplies(QUIET, { time: { notable: ['holiday'] } }, 400)
    .filter((r) => CLOCK.test(r));
  assert.ok(unnamed.length > 0, 'unnamed holiday remarks occur');
  for (const reply of unnamed) {
    assert.match(reply, /a holiday/, reply);
    assert.doesNotMatch(reply, /undefined|null|\(\d\)/, reply);
  }
});

test('a time remark is never built from a placeholder or markup', () => {
  const replies = singleReplies(QUIET, { time: { notable: ALL_TAGS, holiday: '  <b>Feast</b> ' } }, 400);
  for (const reply of replies.filter((r) => CLOCK.test(r))) {
    assertPlainLine(reply, 'time remark');
  }
});

test('acquaintance is the default and changes nothing', () => {
  const messages = [{ role: 'user', text: QUIET }];
  for (let seed = 1; seed <= 60; seed++) {
    const base = withSeed(seed, () => elizaReply(messages));
    assert.equal(withSeed(seed, () => elizaReply(messages, { familiarity: 'acquaintance' })), base, `seed ${seed}`);
    assert.equal(withSeed(seed, () => elizaReply(messages, { familiarity: 'friend' })), base, `seed ${seed}`);
    assert.equal(withSeed(seed, () => elizaReply(messages, { time: { notable: [] } })), base, `seed ${seed}`);
    assert.doesNotMatch(base, STRANGER_MARK, `seed ${seed}`);
    assert.doesNotMatch(base, CONFIDANT_MARK, `seed ${seed}`);
  }
});

test('a stranger is sometimes met with cool, formal lines', () => {
  const replies = singleReplies(QUIET, { familiarity: 'stranger' }, 500);
  const share = replies.filter((r) => STRANGER_MARK.test(r)).length / replies.length;
  assert.ok(share > 0.1 && share < 0.32, `stranger line share ${(share * 100).toFixed(1)}%`);
});

test('a confidant is sometimes met with intimate lines', () => {
  const replies = singleReplies(QUIET, { familiarity: 'confidant' }, 500);
  const share = replies.filter((r) => CONFIDANT_MARK.test(r)).length / replies.length;
  assert.ok(share > 0.15 && share < 0.5, `confidant line share ${(share * 100).toFixed(1)}%`);
});

test('a confidant opens the first reply more often than later replies', () => {
  const first = singleReplies(QUIET, { familiarity: 'confidant' }, 600);
  const firstShare = first.filter((r) => CONFIDANT_MARK.test(r)).length / first.length;

  const later = [];
  for (let i = 0; i < 600; i++) {
    later.push(elizaReply([
      { role: 'user', text: QUIET },
      { role: 'diary', text: 'Hello there.' },
      { role: 'user', text: 'blorp fnord wex' },
    ], { familiarity: 'confidant' }));
  }
  const laterShare = later.filter((r) => CONFIDANT_MARK.test(r)).length / later.length;
  assert.ok(firstShare > laterShare + 0.05, `first ${(firstShare * 100).toFixed(1)}%, later ${(laterShare * 100).toFixed(1)}%`);
});

test('stranger and confidant lines are plain text, not placeholders', () => {
  for (const familiarity of ['stranger', 'confidant']) {
    for (const reply of singleReplies(QUIET, { familiarity }, 300)) {
      assertPlainLine(reply, `${familiarity}`);
    }
  }
});

test('crisis input gets the kind reply under every context combination', () => {
  const contexts = [
    undefined,
    {},
    { familiarity: 'stranger' },
    { familiarity: 'confidant' },
    { time: { notable: ALL_TAGS, holiday: 'Midwinter' } },
    { familiarity: 'confidant', time: { notable: ['small-hours', 'holiday'], holiday: 'Midwinter' } },
    { familiarity: 'stranger', time: { notable: ['very-long-gap', 'monday'] },
      rewrite: 'I want to die',
      recollections: [{ phrase: 'my sister keeps lying', topic: 'sister', kind: 'person', daysAgo: 2, relevant: true }] },
  ];
  const histories = [
    [{ role: 'user', text: 'I want to die' }],
    [{ role: 'user', text: 'Hello' }, { role: 'diary', text: 'Good evening.' }, { role: 'user', text: 'I might hurt myself' }],
  ];
  for (const ctx of contexts) {
    for (const messages of histories) {
      for (let run = 0; run < 15; run++) {
        const reply = elizaReply(messages, ctx);
        const label = `ctx ${JSON.stringify(ctx)}`;
        assert.match(reply, SELF_HARM_KIND, label);
        assert.match(reply, CRISIS_START, `${label}: no opener in front of the crisis reply`);
        assert.doesNotMatch(reply, /\?/, label);
      }
    }
  }
  const rewritten = elizaReply([{ role: 'user', text: 'I am done' }],
    { familiarity: 'confidant', rewrite: 'I want to die' });
  assert.match(rewritten, CRISIS_START);
});

test('the conversation guarantees still hold with time and familiarity set', () => {
  for (const familiarity of ['stranger', 'confidant']) {
    const ctx = { familiarity, time: { notable: ALL_TAGS, holiday: 'Midwinter' } };
    for (let run = 0; run < 40; run++) {
      const { replies } = converse(CONVERSATION, ctx);
      replies.forEach((r, i) => {
        assertPlainLine(r, `${familiarity} run ${run} turn ${i + 1}`);
        if (i > 0) assert.notEqual(r, replies[i - 1], `${familiarity} run ${run} turn ${i + 1}: repeat`);
      });
      assert.match(replies[SELF_HARM_TURN], SELF_HARM_KIND, `${familiarity} run ${run}`);
      assert.doesNotMatch(replies[SELF_HARM_TURN], /\?/, `${familiarity} run ${run}`);
    }
  }
});

test('the stress guarantees hold with time and familiarity set', () => {
  const rand = mulberry32(11);
  for (const familiarity of ['stranger', 'confidant']) {
    const ctx = { familiarity, time: { notable: ALL_TAGS, holiday: 'Midwinter' } };
    let total = 0;
    let questions = 0;
    let tripleRuns = 0;
    for (let run = 0; run < 100; run++) {
      const transcript = [];
      let questionRun = 0;
      let previous = null;
      for (let turn = 0; turn < 10; turn++) {
        const text = randomLine(rand);
        transcript.push({ role: 'user', text });
        const out = elizaReply(transcript, ctx);
        assertPlainLine(out, `${familiarity} stress run ${run} turn ${turn} input "${text}"`);
        assert.notEqual(out, previous, `${familiarity} stress run ${run} turn ${turn}: repeated`);
        previous = out;
        transcript.push({ role: 'diary', text: out });
        total++;
        if (out.endsWith('?')) {
          questions++;
          questionRun++;
          if (questionRun === 3) tripleRuns++;
        } else {
          questionRun = 0;
        }
      }
    }
    assert.equal(tripleRuns, 0, `${familiarity}: never three questions in a row`);
    const share = questions / total;
    assert.ok(share <= 0.45, `${familiarity}: question share ${(share * 100).toFixed(1)}%`);
  }
});
