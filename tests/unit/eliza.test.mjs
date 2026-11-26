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
