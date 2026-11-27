// js/ledger.js: the mood entries, the day and week grouping, the patterns and
// their thresholds, and the diary's remarks (voice, crisis gentleness, banned words).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { HEAVY, moodEntries, dayKey, byDay, weeks, patterns, remarks, VARIANTS } from '../../js/ledger.js';
import { menaceIn } from '../../eval/menace.mjs';

const DAY = 86400000;
// Local-noon helpers. Month index 9 is October; day arithmetic runs past the month end.
const onDay = (offset, hour = 12) => new Date(2026, 9, 4 + offset, hour).getTime();
const NOW = new Date(2026, 10, 26, 12).getTime();
const ago = (k, hour = 12) => new Date(2026, 10, 26 - k, hour).getTime();

const msg = (ts, emotion, extra = {}) => ({ role: 'user', text: 'x', ts, ...(emotion ? { emotion, mood: 0.8 } : {}), ...extra });
const session = (messages) => ({ id: 's', createdAt: messages[0]?.ts ?? 0, messages });
/** A quick history from [ts, emotion] pairs. */
const history = (pairs) => [session(pairs.map(([ts, e]) => msg(ts, e)))];
const entriesOf = (pairs) => moodEntries(history(pairs));

// Lines the crisis path may return, and the templates the other cases may return.
const FILL = { Day: 'Sundays', N: 'Eleven', n: 'eleven' };
const fillAll = (line) => line.replace(/\{(\w+)\}/g, (_, k) => FILL[k]);
const allLines = () => [
  ...VARIANTS.tooLittle.a, ...VARIANTS.tooLittle.b,
  ...Object.values(VARIANTS.top).flat(),
  ...VARIANTS.weekday, ...VARIANTS.trendLighter, ...VARIANTS.trendHeavier, ...VARIANTS.absence,
  ...VARIANTS.gentle.opener, ...VARIANTS.gentle.person, ...VARIANTS.gentle.help,
  ...VARIANTS.filler,
].map(fillAll);
const BANNED = ['score', 'index', 'percent', '%', 'data', 'statistic', 'depress', 'anxiety', 'disorder',
  'diagnos', 'mental health', 'symptom', 'mood'];

/** Runs remarks() with every fraction of rng, so each variant of each list is picked once. */
function sweep(p) {
  const lines = new Set();
  for (let i = 0; i < 100; i++) {
    for (const line of remarks(p, { rng: () => i / 100 })) lines.add(line);
  }
  return [...lines];
}

describe('moodEntries', () => {
  test('keeps user messages with an emotion, sorted by time', () => {
    const e = moodEntries([session([msg(ts(3), 'fear'), msg(ts(1), 'grief')])]);
    assert.deepEqual(e.map((x) => x.emotion), ['grief', 'fear']);
    assert.deepEqual(Object.keys(e[0]).sort(), ['crisis', 'emotion', 'score', 'ts']);
  });

  test('skips diary messages', () => {
    const e = moodEntries([session([{ role: 'diary', text: 'Do go on.', ts: ts(1), emotion: 'grief' }])]);
    assert.deepEqual(e, []);
  });

  test('skips user messages without an emotion, but keeps crisis ones with a null emotion', () => {
    const e = moodEntries([session([msg(ts(1)), msg(ts(2), null, { crisis: true })])]);
    assert.equal(e.length, 1);
    assert.equal(e[0].emotion, null);
    assert.equal(e[0].crisis, true);
  });

  test('skips unknown emotion names, unless the message is a crisis', () => {
    const e = moodEntries([session([msg(ts(1), 'joy'), msg(ts(2), 'joy', { crisis: true })])]);
    assert.equal(e.length, 1);
    assert.equal(e[0].crisis, true);
    assert.equal(e[0].emotion, null);
  });

  test('clamps the confidence to 0..1 and defaults it to 0', () => {
    const e = moodEntries([session([msg(ts(1), 'grief', { mood: 4 }), msg(ts(2), 'grief', { mood: -1 }), { role: 'user', ts: ts(3), emotion: 'grief' }])]);
    assert.deepEqual(e.map((x) => x.score), [1, 0, 0]);
  });

  test('skips malformed sessions and messages without failing', () => {
    const good = session([msg(ts(1), 'delight')]);
    const e = moodEntries([
      null, 42, {}, { messages: 'nope' },
      { messages: [null, 'x', { role: 'user', emotion: 'grief', ts: 'yesterday' }, { role: 'user', emotion: 'grief' }] },
      good,
    ]);
    assert.deepEqual(e.map((x) => x.emotion), ['delight']);
  });

  test('a non-array input gives no entries', () => {
    assert.deepEqual(moodEntries(null), []);
    assert.deepEqual(moodEntries(undefined), []);
  });
});

/** A timestamp N hours into an arbitrary fixed day, for the simple cases. */
function ts(h) { return new Date(2026, 9, 4, h).getTime(); }

describe('dayKey and byDay', () => {
  test('dayKey is the local calendar day', () => {
    assert.equal(dayKey(new Date(2026, 0, 9, 23, 59).getTime()), '2026-01-09');
    assert.equal(dayKey(new Date(2026, 11, 31, 0, 1).getTime()), '2026-12-31');
  });

  test('groups entries by local day, with the local midnight as ts', () => {
    const days = byDay(entriesOf([[onDay(0, 8), 'grief'], [onDay(0, 22), 'grief'], [onDay(1, 9), 'delight']]));
    assert.equal(days.size, 2);
    const first = days.get(dayKey(onDay(0)));
    assert.equal(first.n, 2);
    assert.equal(first.ts, new Date(2026, 9, 4).getTime());
    assert.deepEqual(first.counts, { grief: 2 });
  });

  test('dominant is the most frequent emotion, and intensity is its mean score', () => {
    const e = [
      { ts: onDay(0, 8), emotion: 'grief', score: 0.2, crisis: false },
      { ts: onDay(0, 9), emotion: 'grief', score: 0.6, crisis: false },
      { ts: onDay(0, 10), emotion: 'anger', score: 0.99, crisis: false },
    ];
    const d = byDay(e).get(dayKey(onDay(0)));
    assert.equal(d.dominant, 'grief');
    assert.ok(Math.abs(d.intensity - 0.4) < 1e-9);
  });

  test('a tie in count goes to the higher summed score', () => {
    const e = [
      { ts: onDay(0, 8), emotion: 'grief', score: 0.4, crisis: false },
      { ts: onDay(0, 9), emotion: 'anger', score: 0.9, crisis: false },
    ];
    assert.equal(byDay(e).get(dayKey(onDay(0))).dominant, 'anger');
  });

  test('a tie in count and score goes to EMOTIONS order', () => {
    const e = [
      { ts: onDay(0, 8), emotion: 'delight', score: 0.5, crisis: false },
      { ts: onDay(0, 9), emotion: 'grief', score: 0.5, crisis: false },
    ];
    assert.equal(byDay(e).get(dayKey(onDay(0))).dominant, 'grief');
  });

  test('a day of crisis messages only has no dominant emotion, and is flagged', () => {
    const e = [{ ts: onDay(0, 8), emotion: null, score: 0, crisis: true }];
    const d = byDay(e).get(dayKey(onDay(0)));
    assert.equal(d.dominant, null);
    assert.equal(d.intensity, 0);
    assert.equal(d.crisis, true);
    assert.equal(d.n, 1);
  });
});

describe('weeks', () => {
  test('rows start on Monday, with seven days each, oldest first', () => {
    const days = byDay(entriesOf([[onDay(0), 'grief'], [onDay(12), 'delight']]));
    const rows = weeks(days, { now: onDay(12) });
    assert.ok(rows.length >= 2);
    for (const row of rows) {
      assert.equal(new Date(row.start).getDay(), 1);
      assert.equal(row.days.length, 7);
    }
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i].start > rows[i - 1].start);
  });

  test('days with no record are null, and the week of now is the last row', () => {
    const days = byDay(entriesOf([[onDay(0), 'grief'], [onDay(12), 'delight']]));
    const rows = weeks(days, { now: onDay(12) });
    const flat = rows.flatMap((r) => r.days);
    assert.equal(flat.filter((d) => d !== null).length, 2);
    assert.ok(flat.some((d) => d === null));
    const last = rows[rows.length - 1];
    assert.ok(last.start <= onDay(12) && onDay(12) < last.start + 7 * DAY);
  });

  test('a day sits in the row and column of its own weekday', () => {
    const days = byDay(entriesOf([[onDay(0), 'grief']]));
    const rows = weeks(days, { now: onDay(0) });
    assert.equal(rows.length, 1);
    const col = new Date(onDay(0)).getDay() === 0 ? 6 : new Date(onDay(0)).getDay() - 1;
    assert.equal(rows[0].days[col].dominant, 'grief');
  });

  test('maxWeeks caps the rows, keeping the week of now', () => {
    const days = byDay(entriesOf([[onDay(0), 'grief'], [onDay(70), 'delight']]));
    const rows = weeks(days, { now: onDay(70), maxWeeks: 4 });
    assert.equal(rows.length, 4);
    const last = rows[rows.length - 1];
    assert.ok(last.start <= onDay(70) && onDay(70) < last.start + 7 * DAY);
  });

  test('no days gives no rows', () => {
    assert.deepEqual(weeks(new Map(), { now: NOW }), []);
    assert.deepEqual(weeks([], { now: NOW }), []);
  });
});

/** Sunday grief, every other day delight, for `count` weeks starting at the first Sunday. */
function sundayHistory(count) {
  const pairs = [];
  for (let w = 0; w < count; w++) {
    for (let d = 0; d < 7; d++) pairs.push([onDay(7 * w + d), d === 0 ? 'grief' : 'delight']);
  }
  return entriesOf(pairs);
}

describe('patterns: totals and top', () => {
  test('no entries gives an empty reading', () => {
    assert.deepEqual(patterns([], { now: NOW }), {
      total: 0, top: null, weekday: null, trend: null, absence: null, crisisRecent: false,
    });
  });

  test('top is the most frequent emotion, with its share', () => {
    const e = entriesOf([[onDay(0), 'grief'], [onDay(1), 'grief'], [onDay(2), 'grief'], [onDay(3), 'delight']]);
    const p = patterns(e, { now: onDay(3) });
    assert.equal(p.total, 4);
    assert.deepEqual(p.top, { emotion: 'grief', share: 0.75 });
  });
});

describe('patterns: weekday', () => {
  test('finds the heavy weekday in a Sunday-heavy history', () => {
    const p = patterns(sundayHistory(5), { now: onDay(40) });
    assert.equal(p.weekday.day, 0);
    assert.equal(p.weekday.emotion, 'grief');
    assert.ok(p.weekday.lift >= 1.5);
  });

  test('suppressed when the entries span under 21 days', () => {
    assert.equal(patterns(sundayHistory(3), { now: onDay(30) }).weekday, null);
  });

  test('allowed once the span reaches 21 days', () => {
    assert.ok(patterns(sundayHistory(4), { now: onDay(40) }).weekday);
  });

  test('suppressed under twelve entries', () => {
    // Four Sunday griefs and five delights: enough lift, but only nine entries.
    const pairs = [[onDay(0), 'grief'], [onDay(7), 'grief'], [onDay(14), 'grief'], [onDay(21), 'grief'],
      [onDay(1), 'delight'], [onDay(8), 'delight'], [onDay(2), 'delight'], [onDay(9), 'delight'], [onDay(3), 'delight']];
    assert.equal(patterns(entriesOf(pairs), { now: onDay(40) }).weekday, null);
  });

  test('suppressed when the weekday has fewer than three entries', () => {
    // Two Sunday griefs, and delights on every other day out to 24 days, so the span and the total pass.
    const pairs = [[onDay(0), 'grief'], [onDay(7), 'grief']];
    for (let d = 1; d <= 24; d++) if (d % 7 !== 0) pairs.push([onDay(d), 'delight']);
    assert.equal(patterns(entriesOf(pairs), { now: onDay(40) }).weekday, null);
  });

  test('suppressed when the heavy feelings are spread evenly (lift under 1.5)', () => {
    const pairs = [];
    for (let d = 0; d < 28; d++) {
      pairs.push([onDay(d, 9), 'grief']);
      pairs.push([onDay(d, 18), 'delight']);
    }
    assert.equal(patterns(entriesOf(pairs), { now: onDay(40) }).weekday, null);
  });

  test('suppressed when there are no heavy feelings at all', () => {
    const pairs = [];
    for (let d = 0; d < 28; d++) pairs.push([onDay(d), d % 2 ? 'delight' : 'neutral']);
    assert.equal(patterns(entriesOf(pairs), { now: onDay(40) }).weekday, null);
  });

  test('HEAVY is the four heavier feelings', () => {
    assert.deepEqual([...HEAVY].sort(), ['anger', 'fear', 'grief', 'shame']);
  });
});

describe('patterns: trend', () => {
  test('lighter when the last 28 days are lighter than the 56 before', () => {
    const pairs = [[ago(1), 'delight'], [ago(3), 'delight'], [ago(5), 'delight'], [ago(8), 'delight'],
      [ago(12), 'delight'], [ago(20), 'delight'],
      [ago(35), 'grief'], [ago(40), 'grief'], [ago(45), 'grief'], [ago(50), 'grief'], [ago(55), 'grief'], [ago(60), 'grief']];
    const t = patterns(entriesOf(pairs), { now: NOW }).trend;
    assert.equal(t.direction, 'lighter');
    assert.equal(t.recent, 0);
    assert.equal(t.before, 1);
  });

  test('heavier when the last 28 days are heavier', () => {
    const pairs = [[ago(1), 'grief'], [ago(3), 'grief'], [ago(5), 'anger'], [ago(8), 'fear'],
      [ago(12), 'delight'], [ago(20), 'delight'],
      [ago(35), 'delight'], [ago(40), 'delight'], [ago(45), 'delight'], [ago(50), 'delight'], [ago(55), 'delight'], [ago(60), 'delight']];
    assert.equal(patterns(entriesOf(pairs), { now: NOW }).trend.direction, 'heavier');
  });

  test('suppressed when the two windows are close', () => {
    const pairs = [[ago(1), 'grief'], [ago(3), 'delight'], [ago(5), 'grief'], [ago(8), 'delight'],
      [ago(35), 'grief'], [ago(40), 'delight'], [ago(45), 'grief'], [ago(50), 'delight']];
    assert.equal(patterns(entriesOf(pairs), { now: NOW }).trend, null);
  });

  test('suppressed with fewer than four entries in a window', () => {
    const pairs = [[ago(1), 'delight'], [ago(3), 'delight'], [ago(5), 'delight'],
      [ago(35), 'grief'], [ago(40), 'grief'], [ago(45), 'grief'], [ago(50), 'grief'], [ago(55), 'grief']];
    assert.equal(patterns(entriesOf(pairs), { now: NOW }).trend, null);
  });
});

describe('patterns: absence and crisis', () => {
  test('absence counts whole days since the last entry', () => {
    assert.deepEqual(patterns(entriesOf([[ago(11), 'grief']]), { now: NOW }).absence, { days: 11 });
  });

  test('absence is reported at exactly ten days', () => {
    assert.deepEqual(patterns(entriesOf([[ago(10), 'grief']]), { now: NOW }).absence, { days: 10 });
  });

  test('no absence under ten days', () => {
    assert.equal(patterns(entriesOf([[ago(9), 'grief']]), { now: NOW }).absence, null);
  });

  test('crisisRecent is true for a crisis within 14 days', () => {
    const e = moodEntries([session([msg(ago(5), null, { crisis: true })])]);
    assert.equal(patterns(e, { now: NOW }).crisisRecent, true);
  });

  test('crisisRecent is false for a crisis older than 14 days', () => {
    const e = moodEntries([session([msg(ago(20), 'grief', { crisis: true })])]);
    assert.equal(patterns(e, { now: NOW }).crisisRecent, false);
  });
});

describe('remarks: voice', () => {
  test('too little gives two lines', () => {
    const r = remarks({ total: 3, top: null, crisisRecent: false }, { rng: () => 0.5 });
    assert.equal(r.length, 2);
    assert.ok(r.every((x) => typeof x === 'string' && x.length > 0));
  });

  test('a normal case gives two or three strings', () => {
    const p = { total: 30, top: { emotion: 'grief', share: 0.4 }, weekday: { day: 0, emotion: 'grief', lift: 3 },
      trend: { direction: 'lighter', recent: 0.1, before: 0.5 }, absence: { days: 11 }, crisisRecent: false };
    for (let i = 0; i < 100; i++) {
      const r = remarks(p, { rng: () => i / 100 });
      assert.ok(r.length === 2 || r.length === 3, `got ${r.length}`);
    }
  });

  test('a single case is padded with a filler to two lines', () => {
    const r = remarks({ total: 20, top: null, weekday: null, trend: null, absence: null, crisisRecent: false });
    assert.equal(r.length, 2);
    assert.notEqual(r[0], r[1]);
  });

  test('the absence remark writes the real number in words up to twenty, digits after', () => {
    const text = (days) => remarks({ total: 20, absence: { days } }, { rng: () => 0 }).join(' ');
    assert.match(text(11), /Eleven days without a word/);
    assert.match(text(23), /23 days without a word/);
  });

  test('the weekday remark names the day', () => {
    const lines = sweep({ total: 20, weekday: { day: 0, emotion: 'grief', lift: 3 }, top: null });
    assert.ok(lines.some((l) => l.includes('Sundays')));
  });

  test('every case has three or more variants', () => {
    assert.equal(VARIANTS.tooLittle.a.length >= 3 && VARIANTS.tooLittle.b.length >= 3, true);
    for (const emotion of ['grief', 'anger', 'fear', 'shame', 'boredom', 'delight', 'neutral']) {
      assert.ok(VARIANTS.top[emotion].length >= 3, emotion);
    }
    for (const list of [VARIANTS.weekday, VARIANTS.trendLighter, VARIANTS.trendHeavier, VARIANTS.absence,
      VARIANTS.gentle.opener, VARIANTS.gentle.person, VARIANTS.gentle.help, VARIANTS.filler]) {
      assert.ok(list.length >= 3);
    }
  });

  test('every variant is a non-empty line ending in . ! or "', () => {
    for (const line of allLines()) {
      assert.equal(typeof line, 'string');
      assert.ok(line.trim().length > 0);
      assert.match(line, /[.!"]$/, line);
    }
  });

  test('no variant uses clinical or scoring language', () => {
    for (const line of allLines()) {
      const lower = line.toLowerCase();
      for (const word of BANNED) assert.ok(!lower.includes(word), `"${word}" in: ${line}`);
    }
  });

  test('no variant contains a question mark', () => {
    for (const line of allLines()) assert.ok(!line.includes('?'), line);
  });

  test('every normal-case remark is reachable by the sweep, and none is empty', () => {
    const p = { total: 30, top: { emotion: 'shame', share: 0.4 }, weekday: { day: 3, emotion: 'fear', lift: 2 },
      trend: { direction: 'heavier', recent: 0.6, before: 0.2 }, absence: { days: 12 }, crisisRecent: false };
    const lines = sweep(p);
    assert.ok(lines.length >= 3);
    for (const l of lines) assert.ok(l.length > 0);
  });
});

describe('remarks: crisis', () => {
  const crisisP = { total: 30, top: { emotion: 'grief', share: 0.5 }, weekday: { day: 0, emotion: 'grief', lift: 3 },
    trend: { direction: 'heavier', recent: 0.6, before: 0.2 }, absence: { days: 12 }, crisisRecent: true };

  test('returns only gentle lines, and no other remark', () => {
    const gentle = new Set([...VARIANTS.gentle.opener, ...VARIANTS.gentle.person, ...VARIANTS.gentle.help]);
    const lines = sweep(crisisP);
    assert.ok(lines.length > 0);
    for (const l of lines) assert.ok(gentle.has(l), `not gentle: ${l}`);
  });

  test('gives two or three lines, never the top or absence remarks', () => {
    for (let i = 0; i < 50; i++) {
      const r = remarks(crisisP, { rng: () => i / 50 });
      assert.ok(r.length === 2 || r.length === 3);
      assert.ok(!r.join(' ').includes('Grief, mostly'));
      assert.ok(!r.join(' ').includes('kept your place'));
    }
  });

  test('every gentle line has no menace, no question, and no clinical word', () => {
    for (const line of [...VARIANTS.gentle.opener, ...VARIANTS.gentle.person, ...VARIANTS.gentle.help]) {
      assert.equal(menaceIn(line), null, `menace in: ${line}`);
      assert.ok(!line.includes('?'), line);
      const lower = line.toLowerCase();
      for (const word of BANNED) assert.ok(!lower.includes(word), `"${word}" in: ${line}`);
    }
  });

  test('the gentle lines point to a living person and to the emergency or crisis line', () => {
    assert.ok(VARIANTS.gentle.person.every((l) => /living|person/.test(l)));
    assert.ok(VARIANTS.gentle.help.every((l) => /emergency|crisis line/.test(l)));
  });

  test('a menace check passes for each gentle remark returned', () => {
    for (let i = 0; i < 100; i++) {
      for (const line of remarks(crisisP, { rng: () => i / 100 })) assert.equal(menaceIn(line), null, line);
    }
  });

  test('the menace check flags a line that is not gentle', () => {
    assert.equal(menaceIn('I could strangle you.'), 'strangle');
  });
});
