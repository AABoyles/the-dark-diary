// js/intents.js: the canonical sentences the semantic matcher can return must
// each reach a specific ELIZA reply, not one of the generic fallback lines.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { INTENTS } from '../../js/intents.js';
import { elizaReply } from '../../js/eliza.js';

// Seeded so the sampled generic set, and therefore the result, is reproducible.
let realRandom;
before(() => {
  realRandom = Math.random;
  let a = 1234567;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
});
after(() => {
  Math.random = realRandom;
});

// The engine's generic lines: whatever it says to input with no keyword in it.
// Sampled, not hard-coded, so this test does not depend on the engine's internals.
const GENERIC = new Set();
{
  const gibberish = ['xqzv plmk tuoe', 'qqq zzz vvv', 'blah blah blah', 'lorem ipsum dolor',
    'asdf jkl qwer', 'zebra quartz umbrella', 'plok frib mesh'];
  for (let i = 0; i < 800; i++) {
    GENERIC.add(elizaReply([{ role: 'user', text: `${gibberish[i % gibberish.length]} ${i % 7}` }]));
  }
  for (const text of ['', '...', '   ']) {
    for (let i = 0; i < 50; i++) GENERIC.add(elizaReply([{ role: 'user', text }]));
  }
}

test('the intent table has unique, non-empty intent names', () => {
  assert.ok(INTENTS.length > 0);
  const names = INTENTS.map((i) => i.intent);
  assert.equal(new Set(names).size, names.length, 'no duplicate intent names');
  for (const name of names) assert.ok(typeof name === 'string' && name.length > 0);
});

test('every intent has a canonical sentence and at least eight examples', () => {
  for (const it of INTENTS) {
    assert.equal(typeof it.canonical, 'string', `${it.intent}: canonical is a string`);
    assert.ok(it.canonical.trim().length > 0, `${it.intent}: canonical is not empty`);
    assert.ok(Array.isArray(it.examples), `${it.intent}: examples is an array`);
    assert.ok(it.examples.length >= 8, `${it.intent}: ${it.examples.length} examples, need at least 8`);
    for (const ex of it.examples) assert.equal(typeof ex, 'string', `${it.intent}: example is a string`);
  }
});

test('the generic set is a real baseline, not empty', () => {
  assert.ok(GENERIC.size >= 5, `only ${GENERIC.size} generic lines sampled`);
});

for (const it of INTENTS) {
  test(`intent "${it.intent}": canonical "${it.canonical}" gets a specific reply`, () => {
    for (let k = 0; k < 6; k++) {
      const reply = elizaReply([{ role: 'user', text: it.canonical }]);
      assert.equal(typeof reply, 'string');
      assert.ok(reply.length > 0);
      assert.ok(!GENERIC.has(reply), `generic reply on run ${k}: "${reply}"`);
    }
  });
}
