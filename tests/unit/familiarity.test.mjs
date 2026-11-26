// js/familiarity.js: the three levels and their thresholds, the 30-day window
// of distinct local days, the 0..1 score (monotone), and the prompt notes.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { familiarity, familiarityNote } from '../../js/familiarity.js';

const DAY = 86400000;
const NOW = new Date(2026, 10, 26, 12, 0, 0, 0).getTime();

/** A session whose user messages fall at the given day offsets before NOW. */
function session(id, dayOffsets, { perDay = 1, diary = 0 } = {}) {
  const messages = [];
  for (const off of dayOffsets) {
    for (let k = 0; k < perDay; k++) {
      messages.push({ role: 'user', text: `message ${id}-${off}-${k}`, ts: NOW - off * DAY - k * 60000 });
    }
  }
  for (let k = 0; k < diary; k++) {
    messages.push({ role: 'diary', text: 'Do go on.', ts: NOW - k * 1000 });
  }
  return { id, createdAt: NOW - (dayOffsets[0] ?? 0) * DAY, messages };
}

/** n sessions, each with `per` user messages on the same recent day. */
function many(n, per, { days = 1 } = {}) {
  return Array.from({ length: n }, (_, i) => {
    const offs = Array.from({ length: days }, (_, d) => d + 1);
    return session(`s${i}`, offs, { perDay: Math.ceil(per / days) });
  });
}

describe('familiarity: levels', () => {
  test('no sessions is a stranger, with a zero score', () => {
    const f = familiarity([], NOW);
    assert.equal(f.level, 'stranger');
    assert.equal(f.score, 0);
    assert.deepEqual([f.sessions, f.messages, f.recentDays], [0, 0, 0]);
  });

  test('fewer than three sessions is a stranger, however many messages', () => {
    assert.equal(familiarity(many(2, 200), NOW).level, 'stranger');
  });

  test('fewer than twelve messages is a stranger, however many sessions', () => {
    assert.equal(familiarity(many(10, 1), NOW).level, 'stranger');
  });

  test('three sessions and twelve messages is an acquaintance (the floor)', () => {
    const sessions = [session('a', [1, 2, 3, 4]), session('b', [5, 6, 7, 8]), session('c', [9, 10, 11, 12])];
    assert.equal(familiarity(sessions, NOW).messages, 12);
    assert.equal(familiarity(sessions, NOW).level, 'acquaintance');
  });

  test('eleven messages is still a stranger (the boundary below the floor)', () => {
    const sessions = [session('a', [1, 2, 3, 4]), session('b', [5, 6, 7, 8]), session('c', [9, 10, 11])];
    assert.equal(familiarity(sessions, NOW).messages, 11);
    assert.equal(familiarity(sessions, NOW).level, 'stranger');
  });

  test('confidant needs eight sessions, sixty messages and four recent days together', () => {
    // 8 sessions, 60 messages on 4 distinct recent days
    const sessions = Array.from({ length: 8 }, (_, i) => session(`s${i}`, [i % 4 + 1], { perDay: 8 }));
    const f = familiarity(sessions, NOW);
    assert.equal(f.sessions, 8);
    assert.equal(f.messages, 64);
    assert.equal(f.recentDays, 4);
    assert.equal(f.level, 'confidant');
  });

  test('exactly the confidant thresholds qualify', () => {
    // 8 sessions, 4*8 + 4*7 = 60 messages, 4 distinct recent days
    const exact = Array.from({ length: 8 }, (_, i) => session(`e${i}`, [i % 4 + 1], { perDay: i < 4 ? 8 : 7 }));
    const f = familiarity(exact, NOW);
    assert.equal(f.sessions, 8);
    assert.equal(f.messages, 60);
    assert.equal(f.recentDays, 4);
    assert.equal(f.level, 'confidant');
  });

  test('59 messages is not a confidant', () => {
    const sessions = Array.from({ length: 8 }, (_, i) => session(`s${i}`, [i % 4 + 1], { perDay: i < 3 ? 8 : 7 }));
    const f = familiarity(sessions, NOW);
    assert.equal(f.messages, 59);
    assert.equal(f.level, 'acquaintance');
  });

  test('seven sessions is not a confidant', () => {
    const sessions = Array.from({ length: 7 }, (_, i) => session(`s${i}`, [i % 4 + 1], { perDay: 10 }));
    assert.equal(familiarity(sessions, NOW).level, 'acquaintance');
  });

  test('three recent days is not enough for a confidant', () => {
    const sessions = Array.from({ length: 8 }, (_, i) => session(`s${i}`, [i % 3 + 1], { perDay: 8 }));
    const f = familiarity(sessions, NOW);
    assert.equal(f.recentDays, 3);
    assert.equal(f.level, 'acquaintance');
  });

  test('messages older than thirty days count as messages but not as recent days', () => {
    const sessions = Array.from({ length: 8 }, (_, i) => session(`s${i}`, [40 + i], { perDay: 8 }));
    const f = familiarity(sessions, NOW);
    assert.equal(f.messages, 64);
    assert.equal(f.recentDays, 0);
    assert.equal(f.level, 'acquaintance');
  });
});

describe('familiarity: counting', () => {
  test('counts sessions and only user messages', () => {
    const s = [session('a', [1], { perDay: 2, diary: 5 }), session('b', [2], { perDay: 1 })];
    const f = familiarity(s, NOW);
    assert.equal(f.sessions, 2);
    assert.equal(f.messages, 3);
  });

  test('several messages on one calendar day count as one recent day', () => {
    const f = familiarity([session('a', [1], { perDay: 20 })], NOW);
    assert.equal(f.recentDays, 1);
    assert.equal(f.messages, 20);
  });

  test('recent days are local calendar days, not 24-hour spans', () => {
    // Two messages 2 hours apart that straddle local midnight are two days.
    const before = new Date(2026, 10, 25, 23, 0, 0).getTime();
    const after = new Date(2026, 10, 26, 1, 0, 0).getTime();
    const sessions = [{ id: 'x', createdAt: before, messages: [
      { role: 'user', text: 'late', ts: before },
      { role: 'user', text: 'early', ts: after },
    ] }];
    const f = familiarity(sessions, new Date(2026, 10, 26, 12).getTime());
    assert.equal(f.recentDays, 2);
  });

  test('the window is thirty days back from now', () => {
    const onEdge = { id: 'e', createdAt: 0, messages: [{ role: 'user', text: 'x', ts: NOW - 30 * DAY }] };
    const outside = { id: 'o', createdAt: 0, messages: [{ role: 'user', text: 'y', ts: NOW - 31 * DAY }] };
    assert.equal(familiarity([onEdge], NOW).recentDays, 1);
    assert.equal(familiarity([outside], NOW).recentDays, 0);
  });

  test('tolerates malformed sessions and messages', () => {
    const f = familiarity([null, { messages: 'nope' }, { messages: [null, { role: 'user', ts: NOW }] }], NOW);
    assert.equal(f.sessions, 3);
    assert.equal(f.messages, 1);
  });

  test('defaults now to the current time', () => {
    const real = Date.now();
    const f = familiarity([{ id: 'a', createdAt: real, messages: [{ role: 'user', text: 'hi', ts: real - 1000 }] }]);
    assert.equal(f.recentDays, 1);
  });

  test('a non-array sessions argument is treated as empty', () => {
    assert.equal(familiarity(undefined, NOW).sessions, 0);
  });
});

describe('familiarity: score', () => {
  test('score is between 0 and 1', () => {
    for (const n of [0, 1, 5, 20, 200]) {
      const { score } = familiarity(many(n, 30, { days: 4 }), NOW);
      assert.ok(score >= 0 && score <= 1, `score ${score} for ${n}`);
    }
  });

  test('score reaches 1 at the caps and does not exceed it', () => {
    assert.equal(familiarity(many(50, 200, { days: 10 }), NOW).score, 1);
  });

  test('score is monotone as messages grow', () => {
    let prev = -1;
    for (let m = 0; m <= 80; m += 4) {
      const { score } = familiarity([session('a', [1], { perDay: m })], NOW);
      assert.ok(score >= prev, `score fell at ${m} messages`);
      prev = score;
    }
  });

  test('score is monotone as sessions grow', () => {
    let prev = -1;
    for (let n = 0; n <= 10; n++) {
      const { score } = familiarity(many(n, 6), NOW);
      assert.ok(score >= prev, `score fell at ${n} sessions`);
      prev = score;
    }
  });

  test('score is monotone as recent days grow', () => {
    let prev = -1;
    for (let d = 0; d <= 6; d++) {
      const offs = Array.from({ length: d }, (_, i) => i + 1);
      const sessions = [session('a', offs.length ? offs : [40], { perDay: 10 })];
      const { score } = familiarity(sessions, NOW);
      assert.ok(score >= prev, `score fell at ${d} days`);
      prev = score;
    }
  });

  test('score is greater for a confidant than an acquaintance than a stranger', () => {
    const stranger = familiarity([], NOW).score;
    const acq = familiarity(many(3, 4), NOW).score;
    const conf = familiarity(many(8, 8, { days: 4 }), NOW).score;
    assert.ok(stranger < acq && acq < conf, `${stranger} < ${acq} < ${conf}`);
  });
});

describe('familiarityNote', () => {
  const levels = ['stranger', 'acquaintance', 'confidant'];

  for (const level of levels) {
    test(`${level} note keeps the self-harm kindness rule`, () => {
      assert.match(familiarityNote(level), /self-harm/);
      assert.match(familiarityNote(level), /kindly/);
    });
  }

  test('each level gives a distinct paragraph', () => {
    const notes = levels.map(familiarityNote);
    assert.equal(new Set(notes).size, 3);
    for (const n of notes) assert.ok(n.length > 80);
  });

  test('stranger is formal, cool and does not presume', () => {
    const n = familiarityNote('stranger');
    assert.match(n, /formal/);
    assert.match(n, /cool/);
    assert.match(n, /contemptuous/);
    assert.match(n, /presume/);
  });

  test('acquaintance is curious and uses remembered details', () => {
    const n = familiarityNote('acquaintance');
    assert.match(n, /curious/);
    assert.match(n, /remembered detail/);
  });

  test('confidant is warmer and possessive, with the sanctioned line', () => {
    const n = familiarityNote('confidant');
    assert.match(n, /warmer/);
    assert.match(n, /possessive/);
    assert.ok(n.includes('You came back. They always do, to me.'));
    assert.match(n, /courteous/);
  });

  test('an unknown level falls back to the stranger note', () => {
    assert.equal(familiarityNote('nonsense'), familiarityNote('stranger'));
    assert.equal(familiarityNote(undefined), familiarityNote('stranger'));
  });
});
