// js/timesense.js: period and weekday boundaries, holidays, gaps, the notable
// tags, the prompt note, and the one-line remark with its priority. Dates are
// local so the hours mean what they say. 2026 calendar: 26 Nov is a Thursday.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { timeContext, timeNote, timeRemark } from '../../js/timesense.js';

const at = (y, mo, d, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0);
const MIN = 60000;
const DAY_MS = 1440 * MIN;

// Deterministic "random": always the same index.
const rand = (v) => () => v;

describe('timeContext: periods', () => {
  const cases = [
    [0, 'small hours'], [4, 'small hours'],
    [5, 'early morning'], [7, 'early morning'],
    [8, 'morning'], [11, 'morning'],
    [12, 'afternoon'], [16, 'afternoon'],
    [17, 'evening'], [20, 'evening'],
    [21, 'night'], [23, 'night'],
  ];
  for (const [h, period] of cases) {
    test(`hour ${h} is ${period}`, () => {
      assert.equal(timeContext(at(2026, 11, 27, h, 30)).period, period);
    });
  }

  test('hour and minute are reported', () => {
    const ctx = timeContext(at(2026, 11, 27, 9, 45));
    assert.equal(ctx.hour, 9);
    assert.equal(ctx.minute, 45);
  });
});

describe('timeContext: weekday and weekend', () => {
  test('weekday names are English, Sunday-indexed', () => {
    assert.equal(timeContext(at(2026, 11, 29)).weekday, 'Sunday');
    assert.equal(timeContext(at(2026, 11, 30)).weekday, 'Monday');
    assert.equal(timeContext(at(2026, 12, 4)).weekday, 'Friday');
    assert.equal(timeContext(at(2026, 11, 28)).weekday, 'Saturday');
  });

  test('isWeekend is true only for Saturday and Sunday', () => {
    assert.equal(timeContext(at(2026, 11, 28)).isWeekend, true);
    assert.equal(timeContext(at(2026, 11, 29)).isWeekend, true);
    assert.equal(timeContext(at(2026, 11, 27)).isWeekend, false);
    assert.equal(timeContext(at(2026, 11, 30)).isWeekend, false);
  });
});

describe('timeContext: holidays', () => {
  const holidays = [
    [1, 1, "New Year's Day"],
    [2, 14, "Valentine's Day"],
    [10, 31, 'Halloween'],
    [12, 24, 'Christmas Eve'],
    [12, 25, 'Christmas Day'],
    [12, 31, "New Year's Eve"],
  ];
  for (const [mo, d, name] of holidays) {
    test(`${name} is recognised`, () => {
      assert.equal(timeContext(at(2026, mo, d, 12)).holiday, name);
    });
  }

  test('Friday the 13th is recognised (13 Feb 2026 is a Friday)', () => {
    assert.equal(timeContext(at(2026, 2, 13)).holiday, 'Friday the 13th');
  });

  test('the 13th on a Saturday is not Friday the 13th (13 Jun 2026)', () => {
    assert.equal(timeContext(at(2026, 6, 13)).holiday, null);
  });

  test('an ordinary day has no holiday', () => {
    assert.equal(timeContext(at(2026, 11, 27)).holiday, null);
  });

  test('the day before and after a holiday are not holidays', () => {
    assert.equal(timeContext(at(2026, 10, 30)).holiday, null);
    assert.equal(timeContext(at(2026, 11, 1)).holiday, null);
    assert.equal(timeContext(at(2026, 12, 26)).holiday, null);
  });
});

describe('timeContext: gap', () => {
  test('gapMinutes is null without a last message', () => {
    assert.equal(timeContext(at(2026, 11, 27, 10)).gapMinutes, null);
    assert.equal(timeContext(at(2026, 11, 27, 10), { lastMessageTs: null }).gapMinutes, null);
  });

  test('gapMinutes counts whole minutes since the last message', () => {
    const now = at(2026, 11, 27, 10, 0);
    const last = now.getTime() - (125 * MIN + 30000);
    assert.equal(timeContext(now, { lastMessageTs: last }).gapMinutes, 125);
  });

  test('gapMinutes accepts a Date as well as a number', () => {
    const now = at(2026, 11, 27, 10, 0);
    assert.equal(timeContext(now, { lastMessageTs: new Date(now.getTime() - 30 * MIN) }).gapMinutes, 30);
  });

  test('a last message in the future gives a gap of zero', () => {
    const now = at(2026, 11, 27, 10, 0);
    assert.equal(timeContext(now, { lastMessageTs: now.getTime() + 5 * MIN }).gapMinutes, 0);
  });

  test('an unparseable last message gives no gap', () => {
    assert.equal(timeContext(at(2026, 11, 27, 10), { lastMessageTs: 'not a date' }).gapMinutes, null);
  });
});

describe('timeContext: notable tags', () => {
  const tagsAt = (date, opts) => timeContext(date, opts).notable;

  test('nothing notable on an ordinary weekday afternoon', () => {
    assert.deepEqual(tagsAt(at(2026, 11, 27, 14)), []);
  });

  test('small-hours covers 00:00 through 04:59', () => {
    assert.ok(tagsAt(at(2026, 11, 27, 0, 0)).includes('small-hours'));
    assert.ok(tagsAt(at(2026, 11, 27, 4, 59)).includes('small-hours'));
    assert.ok(!tagsAt(at(2026, 11, 27, 5, 0)).includes('small-hours'));
  });

  test('monday is tagged only before 12:00 on a Monday', () => {
    assert.ok(tagsAt(at(2026, 11, 30, 11, 59)).includes('monday'));
    assert.ok(!tagsAt(at(2026, 11, 30, 12, 0)).includes('monday'));
    assert.ok(!tagsAt(at(2026, 12, 1, 9, 0)).includes('monday'));
  });

  test('weekend-night is Friday or Saturday from 21:00', () => {
    assert.ok(tagsAt(at(2026, 11, 27, 21, 0)).includes('weekend-night'));
    assert.ok(tagsAt(at(2026, 11, 28, 23, 30)).includes('weekend-night'));
    assert.ok(!tagsAt(at(2026, 11, 27, 20, 59)).includes('weekend-night'));
    assert.ok(!tagsAt(at(2026, 11, 29, 22, 0)).includes('weekend-night'), 'Sunday is not weekend-night');
    assert.ok(!tagsAt(at(2026, 11, 26, 22, 0)).includes('weekend-night'), 'Thursday is not weekend-night');
  });

  test('holiday tag follows the holiday', () => {
    assert.ok(tagsAt(at(2026, 10, 31, 15)).includes('holiday'));
    assert.ok(!tagsAt(at(2026, 11, 27, 15)).includes('holiday'));
  });

  test('long-gap starts at exactly 60 minutes; very-long-gap at exactly 1440', () => {
    const now = at(2026, 11, 27, 14);
    assert.ok(!tagsAt(now, { lastMessageTs: now.getTime() - 59 * MIN }).includes('long-gap'));
    assert.ok(tagsAt(now, { lastMessageTs: now.getTime() - 60 * MIN }).includes('long-gap'));
    const oneDay = tagsAt(now, { lastMessageTs: now.getTime() - 1440 * MIN });
    assert.ok(oneDay.includes('long-gap') && oneDay.includes('very-long-gap'));
    const almostDay = tagsAt(now, { lastMessageTs: now.getTime() - (1439 * MIN) });
    assert.ok(almostDay.includes('long-gap') && !almostDay.includes('very-long-gap'));
  });

  test('tags are present only when true, and in the documented order', () => {
    const date = at(2026, 10, 31, 3, 12); // Saturday, Halloween, small hours
    const now = date.getTime();
    const ctx = timeContext(date, { lastMessageTs: now - 2 * DAY_MS });
    assert.deepEqual(ctx.notable, ['small-hours', 'holiday', 'long-gap', 'very-long-gap']);
    assert.ok(!timeContext(at(2026, 11, 27, 14)).notable.includes('holiday'));
  });

  test('a Monday before dawn carries both small-hours and monday', () => {
    assert.deepEqual(tagsAt(at(2026, 11, 30, 3, 0)), ['small-hours', 'monday']);
  });
});

describe('timeNote', () => {
  test('is empty when nothing is notable', () => {
    assert.equal(timeNote(timeContext(at(2026, 11, 27, 14))), '');
  });

  test('is empty for a missing or malformed context', () => {
    assert.equal(timeNote(null), '');
    assert.equal(timeNote({}), '');
    assert.equal(timeNote({ notable: [] }), '');
  });

  test('describes the time, the weekday and the instruction to be sparing', () => {
    const note = timeNote(timeContext(at(2026, 11, 30, 3, 12)));
    assert.ok(note.includes('It is 3:12 in the small hours on a Monday.'), note);
    assert.ok(/rarely/.test(note) && /obliquely/.test(note), note);
    assert.ok(/never in every reply|every reply/.test(note), note);
  });

  test('uses twelve-hour time, so midnight reads as 12', () => {
    const note = timeNote(timeContext(at(2026, 11, 27, 0, 5)));
    assert.ok(note.includes('It is 12:05'), note);
  });

  test('names the holiday when there is one', () => {
    const note = timeNote(timeContext(at(2026, 10, 31, 20)));
    assert.ok(note.includes('Today is Halloween.'), note);
  });

  test('mentions the gap in hours when it is at least an hour', () => {
    const now = at(2026, 11, 27, 14);
    const note = timeNote(timeContext(now, { lastMessageTs: now.getTime() - 2 * 60 * MIN }));
    assert.ok(note.includes('The writer last wrote here 2 hours ago.'), note);
  });

  test('a gap under an hour is not mentioned', () => {
    const now = at(2026, 11, 30, 9);
    const note = timeNote(timeContext(now, { lastMessageTs: now.getTime() - 20 * MIN }));
    assert.ok(note.includes('Monday'));
    assert.ok(!note.includes('last wrote here'));
  });
});

describe('timeRemark', () => {
  test('null when nothing is notable', () => {
    assert.equal(timeRemark(timeContext(at(2026, 11, 27, 14)), rand(0)), null);
  });

  test('null for a missing context', () => {
    assert.equal(timeRemark(null, rand(0)), null);
    assert.equal(timeRemark({ notable: [] }, rand(0)), null);
  });

  test('returns a single line (no newlines) that is a statement', () => {
    const ctx = timeContext(at(2026, 11, 27, 3, 0));
    for (let i = 0; i < 10; i++) {
      const line = timeRemark(ctx, rand(i / 10));
      assert.ok(typeof line === 'string' && line.length > 0);
      assert.ok(!line.includes('\n'));
      assert.ok(!line.includes('?'), line);
    }
  });

  test('each tag has at least four distinct variants', () => {
    const ctxs = {
      'small-hours': timeContext(at(2026, 11, 27, 2, 0)),
      monday: timeContext(at(2026, 11, 30, 10, 0)),
      'weekend-night': timeContext(at(2026, 11, 27, 22, 0)),
      holiday: timeContext(at(2026, 10, 31, 14, 0)),
    };
    for (const [tag, ctx] of Object.entries(ctxs)) {
      const seen = new Set();
      for (let i = 0; i < 10; i++) seen.add(timeRemark(ctx, rand(i / 10)));
      assert.ok(seen.size >= 4, `${tag} has ${seen.size} variants`);
    }
    const now = at(2026, 11, 27, 14).getTime();
    const gap = (min) => timeContext(at(2026, 11, 27, 14), { lastMessageTs: now - min * MIN });
    for (const [tag, min] of [['long-gap', 120], ['very-long-gap', 4 * 1440]]) {
      const seen = new Set();
      for (let i = 0; i < 10; i++) seen.add(timeRemark(gap(min), rand(i / 10)));
      assert.ok(seen.size >= 4, `${tag} has ${seen.size} variants`);
    }
  });

  test('the holiday line uses the holiday name', () => {
    const ctx = timeContext(at(2026, 12, 25, 10));
    for (let i = 0; i < 10; i++) {
      assert.ok(timeRemark(ctx, rand(i / 10)).includes('Christmas Day'));
    }
  });

  test('the long-gap line states the gap in words', () => {
    const now = at(2026, 11, 27, 14).getTime();
    const ctx = timeContext(at(2026, 11, 27, 14), { lastMessageTs: now - 180 * MIN });
    for (let i = 0; i < 10; i++) {
      assert.ok(timeRemark(ctx, rand(i / 10)).includes('3 hours'));
    }
  });

  test('the very-long-gap line states the gap in days', () => {
    const now = at(2026, 11, 27, 14).getTime();
    const ctx = timeContext(at(2026, 11, 27, 14), { lastMessageTs: now - 3 * DAY_MS });
    for (let i = 0; i < 10; i++) {
      assert.ok(timeRemark(ctx, rand(i / 10)).includes('3 days'));
    }
  });

  test('the first long-gap variant is the one from the brief, for a one-hour gap', () => {
    const now = at(2026, 11, 27, 14).getTime();
    const ctx = timeContext(at(2026, 11, 27, 14), { lastMessageTs: now - 60 * MIN });
    assert.equal(timeRemark(ctx, rand(0)), 'You left mid-sentence an hour ago. I kept your place.');
  });

  test('priority: holiday beats small-hours, long-gap and monday', () => {
    const now = at(2026, 10, 31, 3, 0).getTime();
    const ctx = timeContext(at(2026, 10, 31, 3, 0), { lastMessageTs: now - 5 * DAY_MS });
    assert.ok(timeRemark(ctx, rand(0)).includes('Halloween'));
  });

  test('priority: small-hours beats very-long-gap and long-gap', () => {
    const now = at(2026, 11, 27, 3, 0).getTime();
    const ctx = timeContext(at(2026, 11, 27, 3, 0), { lastMessageTs: now - 3 * DAY_MS });
    const line = timeRemark(ctx, rand(0));
    assert.equal(line, 'The hour suits you. Few honest things are written before dawn.');
  });

  test('priority: very-long-gap beats long-gap', () => {
    const now = at(2026, 11, 27, 14).getTime();
    const ctx = timeContext(at(2026, 11, 27, 14), { lastMessageTs: now - 2 * DAY_MS });
    assert.ok(timeRemark(ctx, rand(0)).includes('2 days'));
  });

  test('priority: long-gap beats weekend-night and monday', () => {
    const now = at(2026, 11, 27, 22).getTime();
    const ctx = timeContext(at(2026, 11, 27, 22), { lastMessageTs: now - 90 * MIN });
    assert.ok(timeRemark(ctx, rand(0)).includes('an hour'));
  });

  test('priority: weekend-night beats monday when both are hand-built', () => {
    const ctx = { hour: 10, weekday: 'Friday', notable: ['monday', 'weekend-night'], holiday: null };
    const line = timeRemark(ctx, rand(0));
    assert.ok(line.includes('Friday night'), line);
  });

  test('the rand argument chooses among variants deterministically', () => {
    const ctx = timeContext(at(2026, 11, 30, 10));
    assert.equal(timeRemark(ctx, rand(0)), timeRemark(ctx, rand(0)));
    assert.notEqual(timeRemark(ctx, rand(0)), timeRemark(ctx, rand(0.99)));
  });

  test('a bad random value still gives a line', () => {
    const ctx = timeContext(at(2026, 11, 30, 10));
    assert.equal(typeof timeRemark(ctx, rand(NaN)), 'string');
    assert.equal(typeof timeRemark(ctx, rand(1)), 'string');
  });
});
