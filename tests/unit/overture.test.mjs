// js/overture.js: the rate limit, first contact, anniversaries (year and month,
// memory preferred, my -> your), absence wording at each band, the thread
// probability through an injected rand, null otherwise, and no immediate repeat.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { composeOverture } from '../../js/overture.js';

const DAY = 86400000;
const HOUR = 3600000;
const NOW = new Date(2026, 10, 26, 12, 0, 0, 0).getTime(); // 26 Nov 2026, local noon
const at = (y, mo, d, h = 10) => new Date(y, mo - 1, d, h, 0, 0, 0).getTime();
const rand = (v) => () => v;

/** A session with user messages at the given timestamps. */
function session(id, createdAt, userTexts = [], { diaryFirst = null } = {}) {
  const messages = [];
  if (diaryFirst !== null) messages.push({ role: 'diary', text: diaryFirst, ts: createdAt });
  userTexts.forEach((text, i) => messages.push({ role: 'user', text, ts: createdAt + (i + 1) * 60000 }));
  return { id, createdAt, messages };
}

/** A session with one user message at `ts`, so the writer was last heard then. */
const heardAt = (ts, id = 'h') => session(id, ts, ['a line'], {});

describe('composeOverture: rate limit', () => {
  test('nothing is said within twenty hours of the last overture', () => {
    const sessions = [session('a', NOW - 2 * DAY, ['hello'])];
    assert.equal(composeOverture({ sessions, now: NOW, lastOvertureAt: NOW - 19 * HOUR, rand: rand(0) }), null);
    assert.equal(composeOverture({ sessions, now: NOW, lastOvertureAt: NOW - 1000, rand: rand(0) }), null);
  });

  test('exactly twenty hours later is allowed', () => {
    const sessions = [session('a', NOW - 2 * DAY, ['hello'])];
    const out = composeOverture({ sessions, now: NOW, lastOvertureAt: NOW - 20 * HOUR, rand: rand(0) });
    assert.equal(out.kind, 'absence');
  });

  test('a null lastOvertureAt does not limit', () => {
    assert.equal(composeOverture({ sessions: [], now: NOW, lastOvertureAt: null }).kind, 'first');
  });

  test('the rate limit applies to every kind, not just absence', () => {
    const sessions = [session('a', at(2025, 11, 26), ['my sister keeps lying to me'])];
    const memories = [{ topic: 'my sister', phrase: 'my sister keeps lying to me', kind: 'person', ts: at(2025, 11, 26), sessionId: 'a' }];
    assert.equal(composeOverture({ sessions, memories, now: NOW, lastOvertureAt: NOW - HOUR, rand: rand(0) }), null);
  });
});

describe('composeOverture: first contact', () => {
  test('no sessions gives a first line', () => {
    const out = composeOverture({ sessions: [], now: NOW, rand: rand(0) });
    assert.equal(out.kind, 'first');
    assert.equal(out.text, 'So. You found me. Write, and I will answer. I always do.');
  });

  test('sessions that hold only diary lines still count as first contact', () => {
    const out = composeOverture({ sessions: [session('a', NOW - DAY, [], { diaryFirst: 'Do go on.' })], now: NOW, rand: rand(0) });
    assert.equal(out.kind, 'first');
  });

  test('all defaults give a first line when there is no history', () => {
    assert.equal(composeOverture().kind, 'first');
  });

  test('first contact has at least three distinct variants', () => {
    const texts = new Set([0, 0.34, 0.67, 0.99].map((r) => composeOverture({ now: NOW, rand: rand(r) }).text));
    assert.ok(texts.size >= 3, `only ${texts.size}`);
  });
});

describe('composeOverture: anniversary', () => {
  test('a memory from one year ago today gives the anniversary line, with my turned to your', () => {
    const sessions = [session('a', at(2025, 11, 26), ['my sister keeps lying to me'])];
    const memories = [{ topic: 'my sister', phrase: 'my sister keeps lying to me', kind: 'person', ts: at(2025, 11, 26), sessionId: 'a' }];
    const out = composeOverture({ sessions, memories, now: NOW, rand: rand(0) });
    assert.equal(out.kind, 'anniversary');
    assert.equal(out.text, 'A year ago today you wrote about your sister. I remember it better than you do.');
  });

  test('a memory from one month ago today gives the month wording', () => {
    const memories = [{ topic: 'my sister', phrase: 'x', kind: 'person', ts: at(2026, 10, 26), sessionId: 'a' }];
    const out = composeOverture({ sessions: [heardAt(NOW - HOUR)], memories, now: NOW, rand: rand(0) });
    assert.equal(out.kind, 'anniversary');
    assert.equal(out.text, 'A month ago today you wrote about your sister. I remember it better than you do.');
  });

  test('a month ago across a year boundary is still one month ago', () => {
    const memories = [{ topic: 'my father', phrase: 'x', kind: 'person', ts: at(2026, 12, 10), sessionId: 'a' }];
    const out = composeOverture({ sessions: [heardAt(at(2027, 1, 9))], memories, now: at(2027, 1, 10), rand: rand(0) });
    assert.equal(out.kind, 'anniversary');
    assert.ok(out.text.includes('A month ago today') && out.text.includes('your father'));
  });

  test('a year-old memory is preferred to a month-old one', () => {
    const memories = [
      { topic: 'my cat', phrase: 'x', kind: 'thing', ts: at(2026, 10, 26), sessionId: 'a' },
      { topic: 'my sister', phrase: 'y', kind: 'person', ts: at(2025, 11, 26), sessionId: 'b' },
    ];
    const out = composeOverture({ sessions: [heardAt(NOW - HOUR)], memories, now: NOW, rand: rand(0) });
    assert.ok(out.text.includes('A year ago today') && out.text.includes('your sister'), out.text);
  });

  test('a memory is preferred to a session from the same day', () => {
    const sessions = [session('a', at(2025, 11, 26), ['something else entirely'])];
    const memories = [{ topic: 'my brother', phrase: 'x', kind: 'person', ts: at(2025, 11, 26), sessionId: 'a' }];
    const out = composeOverture({ sessions, memories, now: NOW, rand: rand(0) });
    assert.ok(out.text.includes('your brother'), out.text);
  });

  test('without a memory, the session first user message is quoted, shortened to eight words', () => {
    const sessions = [session('a', at(2025, 11, 26), ['my sister keeps lying to me and I cannot stop thinking about it all'])];
    const out = composeOverture({ sessions, memories: [], now: NOW, rand: rand(0) });
    assert.equal(out.kind, 'anniversary');
    const quoted = out.text.match(/"([^"]*)"/)[1];
    assert.ok(quoted.split(/\s+/).length <= 8, quoted);
    assert.equal(quoted, 'your sister keeps lying to you and you');
    assert.ok(out.text.startsWith('A year ago today you wrote, "'), out.text);
  });

  test('a session with no user message on that day is not an anniversary', () => {
    const sessions = [session('a', at(2025, 11, 26), [], { diaryFirst: 'Do go on.' })];
    assert.equal(composeOverture({ sessions, now: NOW, rand: rand(0) }).kind, 'first'); // no user line anywhere
  });

  test('a memory two years ago is not an anniversary', () => {
    const memories = [{ topic: 'my sister', phrase: 'x', kind: 'person', ts: at(2024, 11, 26), sessionId: 'a' }];
    assert.equal(composeOverture({ sessions: [heardAt(NOW - HOUR)], memories, now: NOW, rand: rand(0.9) }), null);
  });

  test('a different day of the same month is not an anniversary', () => {
    const memories = [{ topic: 'my sister', phrase: 'x', kind: 'person', ts: at(2025, 11, 25), sessionId: 'a' }];
    assert.equal(composeOverture({ sessions: [heardAt(NOW - HOUR)], memories, now: NOW, rand: rand(0.9) }), null);
  });

  test('an anniversary has at least three distinct variants', () => {
    const memories = [{ topic: 'my sister', phrase: 'x', kind: 'person', ts: at(2025, 11, 26), sessionId: 'a' }];
    const texts = new Set([0, 0.34, 0.67].map((r) => composeOverture({ sessions: [heardAt(NOW - HOUR)], memories, now: NOW, rand: rand(r) }).text));
    assert.equal(texts.size, 3);
  });
});

describe('composeOverture: absence', () => {
  const heard = (daysAgo) => [heardAt(NOW - daysAgo * DAY)];

  test('a message from last night does not count as absence', () => {
    const yesterdayLate = new Date(2026, 10, 25, 23, 0).getTime();
    assert.equal(composeOverture({ sessions: heard(0), now: NOW, rand: rand(0) }), null);
    assert.equal(composeOverture({ sessions: [heardAt(yesterdayLate)], now: NOW, rand: rand(0) }), null);
  });

  test('two days gives the spelled-out two-day line', () => {
    const out = composeOverture({ sessions: heard(2), now: NOW, rand: rand(0) });
    assert.equal(out.kind, 'absence');
    assert.equal(out.text, 'Two days. I had begun to wonder.');
  });

  test('four days gives the four-day line from the brief', () => {
    const out = composeOverture({ sessions: heard(4), now: NOW, rand: rand(0) });
    assert.equal(out.text, 'Four days. I had begun to wonder.');
  });

  test('twelve days is still spelled out', () => {
    const out = composeOverture({ sessions: heard(12), now: NOW, rand: rand(0) });
    assert.ok(out.text.startsWith('Twelve days.'), out.text);
  });

  test('thirteen days gives the weeks line', () => {
    const out = composeOverture({ sessions: heard(13), now: NOW, rand: rand(0) });
    assert.equal(out.text, "Weeks. I had begun to think you'd found another confidant.");
  });

  test('sixty days is still weeks', () => {
    const out = composeOverture({ sessions: heard(60), now: NOW, rand: rand(0) });
    assert.ok(out.text.startsWith('Weeks.'), out.text);
  });

  test('seventy days gives the months line', () => {
    const out = composeOverture({ sessions: heard(70), now: NOW, rand: rand(0) });
    assert.equal(out.text, 'Months. The ink had nearly dried.');
  });

  test('absence is measured from the most recent user message anywhere', () => {
    const sessions = [heardAt(NOW - 10 * DAY, 'old'), heardAt(NOW - 1 * HOUR, 'new')];
    assert.equal(composeOverture({ sessions, now: NOW, rand: rand(0) }), null);
  });

  test('absence wins over a thread memory, so the thread is not offered', () => {
    const memories = [{ topic: 'my mother', phrase: 'x', kind: 'person', ts: NOW - 5 * DAY, sessionId: 'a' }];
    const out = composeOverture({ sessions: heard(3), memories, now: NOW, rand: rand(0.1) });
    assert.equal(out.kind, 'absence');
  });

  test('absence has at least three distinct variants at two days', () => {
    const texts = new Set([0, 0.34, 0.67].map((r) => composeOverture({ sessions: heard(2), now: NOW, rand: rand(r) }).text));
    assert.equal(texts.size, 3);
  });
});

describe('composeOverture: thread', () => {
  const mother = (ts = NOW - 3 * DAY) => [{ topic: 'my mother', phrase: 'my mother and I do not speak', kind: 'person', ts, sessionId: 'a' }];
  const recent = [heardAt(NOW - HOUR)];

  test('with the probability met, a person from a day or more ago is brought up', () => {
    const out = composeOverture({ sessions: recent, memories: mother(), now: NOW, rand: rand(0.1) });
    assert.equal(out.kind, 'thread');
    assert.equal(out.text, 'You never did tell me more about your mother.');
  });

  test('the probability is 0.35: just under thread, at 0.35 nothing', () => {
    assert.equal(composeOverture({ sessions: recent, memories: mother(), now: NOW, rand: rand(0.349) }).kind, 'thread');
    assert.equal(composeOverture({ sessions: recent, memories: mother(), now: NOW, rand: rand(0.35) }), null);
    assert.equal(composeOverture({ sessions: recent, memories: mother(), now: NOW, rand: rand(0.9) }), null);
  });

  test('a person less than a day old is not brought up', () => {
    assert.equal(composeOverture({ sessions: recent, memories: mother(NOW - 3 * HOUR), now: NOW, rand: rand(0) }), null);
  });

  test('a person exactly a day old is brought up', () => {
    assert.equal(composeOverture({ sessions: recent, memories: mother(NOW - DAY), now: NOW, rand: rand(0) }).kind, 'thread');
  });

  test('only kind person memories are candidates', () => {
    const memories = [{ topic: 'my cat', phrase: 'x', kind: 'thing', ts: NOW - 5 * DAY, sessionId: 'a' }];
    assert.equal(composeOverture({ sessions: recent, memories, now: NOW, rand: rand(0) }), null);
  });

  test('the person is chosen by the injected rand among eligible memories', () => {
    const memories = [
      { topic: 'my mother', phrase: 'x', kind: 'person', ts: NOW - 5 * DAY, sessionId: 'a' },
      { topic: 'my brother', phrase: 'y', kind: 'person', ts: NOW - 5 * DAY, sessionId: 'b' },
    ];
    // rand: 0.1 passes the probability, 0.9 picks the second memory, 0 picks the first variant
    const out = composeOverture({ sessions: recent, memories, now: NOW, rand: seq([0.1, 0.9, 0]) });
    assert.ok(out.text.includes('your brother'), out.text);
  });

  test('my and me are reflected in the topic', () => {
    const memories = [{ topic: 'me and my brother', phrase: 'x', kind: 'person', ts: NOW - 5 * DAY, sessionId: 'a' }];
    const out = composeOverture({ sessions: recent, memories, now: NOW, rand: rand(0.1) });
    assert.ok(out.text.includes('you and your brother'), out.text);
  });

  test('thread has at least three distinct variants', () => {
    const texts = new Set([0, 0.34, 0.67].map((r) => composeOverture({ sessions: recent, memories: mother(), now: NOW, rand: seq([0.1, 0.1, r]) }).text));
    assert.equal(texts.size, 3);
  });
});

describe('composeOverture: otherwise null', () => {
  test('a recent writer with no memories gets no overture', () => {
    assert.equal(composeOverture({ sessions: [heardAt(NOW - HOUR)], memories: [], now: NOW, rand: rand(0) }), null);
  });

  test('a recent writer with only old, non-person memories gets no overture', () => {
    const memories = [{ topic: 'my cat', phrase: 'x', kind: 'thing', ts: NOW - 40 * DAY, sessionId: 'a' }];
    assert.equal(composeOverture({ sessions: [heardAt(NOW - HOUR)], memories, now: NOW, rand: rand(0) }), null);
  });
});

describe('composeOverture: no immediate repeat', () => {
  test('when the last opening line is the first absence variant, another is chosen', () => {
    const opening = 'Two days. I had begun to wonder.';
    const sessions = [session('a', NOW - 2 * DAY, ['hello'], { diaryFirst: opening })];
    const out = composeOverture({ sessions, now: NOW, rand: rand(0) });
    assert.equal(out.kind, 'absence');
    assert.notEqual(out.text, opening);
    assert.equal(out.text, 'Two days without a word from you. I had begun to wonder where you had gone.');
  });

  test('when the last opening line is the first-contact line, another is chosen', () => {
    const opening = 'So. You found me. Write, and I will answer. I always do.';
    const sessions = [session('a', NOW - DAY, [], { diaryFirst: opening })];
    const out = composeOverture({ sessions, now: NOW, rand: rand(0) });
    assert.equal(out.kind, 'first');
    assert.notEqual(out.text, opening);
  });

  test('the check looks at the most recent session only', () => {
    const older = session('old', NOW - 3 * DAY, ['hello'], { diaryFirst: 'Two days. I had begun to wonder.' });
    const newer = session('new', NOW - 2 * DAY, ['hello again'], { diaryFirst: 'Something else.' });
    const out = composeOverture({ sessions: [older, newer], now: NOW, rand: rand(0) });
    assert.equal(out.text, 'Two days. I had begun to wonder.');
  });

  test('a diary opener that is not the same text does not block the first variant', () => {
    const sessions = [session('a', NOW - 2 * DAY, ['hello'], { diaryFirst: 'Something else.' })];
    assert.equal(composeOverture({ sessions, now: NOW, rand: rand(0) }).text, 'Two days. I had begun to wonder.');
  });
});

/** A rand that returns the given values in order, then the last one. */
function seq(values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}
