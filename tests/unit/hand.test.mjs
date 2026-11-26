// Issue #22: the hand-written look. Pure helpers only: per-letter jitter,
// stable seeds and the word-start weight boost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handFor, seedFor, blotFor } from '../../js/ink.js';

test('handFor is deterministic for a given seed and index', () => {
  assert.deepEqual(handFor(12345, 7), handFor(12345, 7));
  assert.deepEqual(handFor('abc', 0, { pos: 3 }), handFor('abc', 0, { pos: 3 }));
});

test('handFor varies with seed and index', () => {
  assert.notDeepEqual(handFor(1, 0), handFor(2, 0));
  assert.notDeepEqual(handFor(1, 0), handFor(1, 1));
});

test('handFor stays within its ranges', () => {
  for (let seed = 0; seed < 20; seed++) {
    for (let index = 0; index < 200; index++) {
      const { rot, dy, weight } = handFor(seed * 7919, index, { pos: index % 6 });
      assert.ok(Math.abs(rot) <= 2.2, `rot ${rot}`);
      // jitter ±0.06 plus baseline drift of about 0.05em
      assert.ok(Math.abs(dy) <= 0.06 + 0.05 + 1e-9, `dy ${dy}`);
      assert.ok(weight >= 0.82 && weight <= 1, `weight ${weight}`);
    }
  }
});

test('the baseline drift is slow: neighbouring letters agree more than distant ones', () => {
  const drift = (i) => handFor(99, i).dy;
  let near = 0;
  let far = 0;
  for (let i = 0; i < 100; i++) {
    near += Math.abs(drift(i + 1) - drift(i));
    far += Math.abs(drift(i + 50) - drift(i));
  }
  assert.ok(near / 100 < far / 100 + 0.02, `near ${near / 100}, far ${far / 100}`);
});

test('the first two letters of a word are written darker', () => {
  let boosted = 0;
  for (let index = 0; index < 200; index++) {
    const start = handFor(42, index, { pos: 0 }).weight;
    const late = handFor(42, index, { pos: 5 }).weight;
    assert.ok(start >= late, `index ${index}: ${start} < ${late}`);
    assert.ok(start <= 1);
    if (start > late) boosted += 1;
    assert.equal(handFor(42, index, { pos: 1 }).weight, start);
  }
  assert.ok(boosted > 150, `most word starts should be boosted by the cap (${boosted})`);
});

test('the default position is not a word start', () => {
  assert.deepEqual(handFor(5, 5), handFor(5, 5, { pos: 99 }));
});

test('seedFor is a stable 32-bit integer of the text', () => {
  assert.equal(seedFor('Washing blood'), seedFor('Washing blood'));
  assert.notEqual(seedFor('Washing blood'), seedFor('Washing blood.'));
  const s = seedFor('anything at all');
  assert.ok(Number.isInteger(s) && s >= 0 && s <= 0xffffffff);
  assert.equal(seedFor(''), seedFor(undefined));
});

test('blotFor appears for some seeds and not others, roughly one in five', () => {
  let blots = 0;
  for (let seed = 0; seed < 1000; seed++) {
    const b = blotFor(seed);
    if (b) {
      blots += 1;
      assert.ok(b.size >= 0.5 && b.size <= 0.9, `size ${b.size}`);
    }
  }
  assert.ok(blots > 120 && blots < 280, `blots ${blots} of 1000`);
  assert.deepEqual(blotFor(7), blotFor(7));
});
