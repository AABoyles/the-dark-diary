// bandit.js: reward shape, the Beta sampler, Thompson choice, bounded weights,
// persistence through the in-memory and localStorage stores, and the no-op
// store when localStorage is missing.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  FAMILIES, engagementReward, memoryStore, localStore, createBandit, sampleBeta,
} from '../../js/bandit.js';

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

const words = (n) => Array.from({ length: n }, () => 'word').join(' ');

describe('engagementReward', () => {
  test('returns a number in [0, 1]', () => {
    for (const text of ['', 'hello there', words(5), words(80), 'why? because', undefined, null, 42]) {
      const r = engagementReward(text);
      assert.equal(typeof r, 'number');
      assert.ok(r >= 0 && r <= 1, `out of range for ${JSON.stringify(text)}: ${r}`);
    }
  });

  test('dismissals score zero', () => {
    for (const text of ['', 'ok', 'idk', 'k', 'fine', 'whatever', 'Ok.', '  FINE  ']) {
      assert.equal(engagementReward(text), 0, text);
    }
  });

  test('about one half at twelve words, and close to one by forty', () => {
    assert.ok(Math.abs(engagementReward(words(12)) - 0.5) < 0.02);
    assert.ok(engagementReward(words(40)) > 0.85);
    assert.ok(engagementReward(words(40)) <= 1);
  });

  test('increases with length', () => {
    assert.ok(engagementReward(words(3)) < engagementReward(words(8)));
    assert.ok(engagementReward(words(8)) < engagementReward(words(20)));
  });

  test('a question or "because" earns a small capped bonus', () => {
    const plain = engagementReward(words(12));
    const asks = engagementReward(`${words(11)}?`);
    const because = engagementReward(`${words(11)} because`);
    assert.ok(asks > plain);
    assert.ok(because > plain);
    assert.ok(asks - plain <= 0.11);
    assert.ok(engagementReward(`${words(80)}?`) <= 1);
  });
});

describe('sampleBeta', () => {
  test('mean and variance match Beta(2, 5) over many seeded draws', () => {
    const rand = mulberry32(2024);
    const N = 40000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < N; i++) {
      const x = sampleBeta(2, 5, rand);
      assert.ok(x >= 0 && x <= 1);
      sum += x;
      sumSq += x * x;
    }
    const mean = sum / N;
    const variance = sumSq / N - mean * mean;
    assert.ok(Math.abs(mean - 2 / 7) < 0.005, `mean ${mean}`);
    assert.ok(Math.abs(variance - (2 * 5) / (49 * 8)) < 0.002, `variance ${variance}`);
  });

  test('handles shape below one', () => {
    const rand = mulberry32(5);
    let sum = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) sum += sampleBeta(0.5, 0.5, rand);
    assert.ok(Math.abs(sum / N - 0.5) < 0.01);
  });
});

describe('choose', () => {
  test('after about fifty updates, the rewarding family is picked most of the time, others still sometimes', () => {
    const bandit = createBandit(memoryStore());
    for (let i = 0; i < 50; i++) {
      bandit.update('grammar', 0.7);
      bandit.update('eliza', 0.45);
      bandit.update('retrieval', 0.45);
      bandit.update('dialogue', 0.45);
    }
    const rand = mulberry32(31);
    const counts = Object.fromEntries(FAMILIES.map((f) => [f, 0]));
    const N = 2000;
    for (let i = 0; i < N; i++) counts[bandit.choose(FAMILIES, rand)]++;
    assert.ok(counts.grammar / N > 0.5, `grammar picked ${counts.grammar / N}`);
    for (const other of ['eliza', 'retrieval', 'dialogue']) {
      assert.ok(counts[other] > 0, `${other} never picked`);
    }
  });

  test('returns one of the available families only', () => {
    const bandit = createBandit(memoryStore());
    const rand = mulberry32(8);
    for (let i = 0; i < 200; i++) {
      const pick = bandit.choose(['eliza', 'grammar'], rand);
      assert.ok(['eliza', 'grammar'].includes(pick));
    }
  });

  test('returns null when nothing usable is offered', () => {
    const bandit = createBandit(memoryStore());
    assert.equal(bandit.choose([], mulberry32(1)), null);
    assert.equal(bandit.choose(['nonsense'], mulberry32(1)), null);
  });
});

describe('weights', () => {
  test('uniform before any data', () => {
    const bandit = createBandit(memoryStore());
    const w = bandit.weights();
    for (const f of FAMILIES) assert.ok(Math.abs(w[f] - 1) < 1e-9, `${f} ${w[f]}`);
  });

  test('bounded to [floor, ceiling] with mean close to one', () => {
    const bandit = createBandit(memoryStore(), { floor: 0.5, ceiling: 2 });
    for (let i = 0; i < 200; i++) bandit.update('grammar', 1);
    for (let i = 0; i < 200; i++) bandit.update('eliza', 0);
    const w = bandit.weights();
    const values = Object.values(w);
    for (const v of values) assert.ok(v >= 0.5 && v <= 2, `out of bounds ${v}`);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    assert.ok(Math.abs(mean - 1) < 0.25, `mean ${mean}`);
    assert.ok(w.grammar > w.eliza);
  });

  test('restricting to available families normalises over those only', () => {
    const bandit = createBandit(memoryStore());
    const w = bandit.weights(['eliza', 'grammar']);
    assert.deepEqual(Object.keys(w).sort(), ['eliza', 'grammar']);
  });
});

describe('update and snapshot', () => {
  test('clamps rewards to [0, 1] and counts each update', () => {
    const bandit = createBandit(memoryStore());
    bandit.update('dialogue', 5);
    bandit.update('dialogue', -3);
    bandit.update('dialogue', 0.25);
    const snap = bandit.snapshot();
    assert.equal(snap.dialogue.n, 3);
    assert.ok(Math.abs(snap.dialogue.sum - 1.25) < 1e-9);
  });

  test('unknown family and non-finite reward are ignored safely', () => {
    const bandit = createBandit(memoryStore());
    assert.doesNotThrow(() => bandit.update('telepathy', 1));
    bandit.update('eliza', NaN);
    const snap = bandit.snapshot();
    assert.equal(snap.eliza.n, 0);
    assert.equal(Object.keys(snap).length, FAMILIES.length);
    assert.equal(snap.telepathy, undefined);
  });
});

describe('persistence', () => {
  test('state survives a round trip through memoryStore', () => {
    const store = memoryStore();
    createBandit(store).update('retrieval', 0.7);
    createBandit(store).update('retrieval', 0.2);
    const snap = createBandit(store).snapshot();
    assert.equal(snap.retrieval.n, 2);
    assert.ok(Math.abs(snap.retrieval.sum - 0.9) < 1e-9);
  });

  describe('through a stubbed globalThis.localStorage', () => {
    let saved;
    let data;

    beforeEach(() => {
      saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
      data = new Map();
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        writable: true,
        value: {
          getItem: (k) => (data.has(k) ? data.get(k) : null),
          setItem: (k, v) => data.set(k, String(v)),
          removeItem: (k) => data.delete(k),
        },
      });
    });

    afterEach(() => {
      if (saved) Object.defineProperty(globalThis, 'localStorage', saved);
      else delete globalThis.localStorage;
    });

    test('updates persist under the default key and reload in a new bandit', () => {
      createBandit().update('grammar', 0.8);
      assert.ok(data.has('dd-bandit'));
      const snap = createBandit().snapshot();
      assert.equal(snap.grammar.n, 1);
      assert.ok(Math.abs(snap.grammar.sum - 0.8) < 1e-9);
    });

    test('localStore accepts a custom key', () => {
      const store = localStore('custom-key');
      store.save({ eliza: { n: 3, sum: 1.5 } });
      assert.ok(data.has('custom-key'));
      assert.deepEqual(store.load(), { eliza: { n: 3, sum: 1.5 } });
    });

    test('corrupt stored JSON loads as empty state', () => {
      data.set('dd-bandit', '{not json');
      const snap = createBandit().snapshot();
      for (const f of FAMILIES) assert.deepEqual(snap[f], { n: 0, sum: 0 });
    });

    test('a throwing getItem or setItem does not escape', () => {
      globalThis.localStorage.getItem = () => { throw new Error('blocked'); };
      globalThis.localStorage.setItem = () => { throw new Error('quota'); };
      const bandit = createBandit();
      assert.doesNotThrow(() => bandit.update('fear', 1));
      assert.doesNotThrow(() => bandit.choose(FAMILIES, mulberry32(1)));
    });
  });

  test('localStore is a no-op where localStorage is missing', () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    delete globalThis.localStorage;
    try {
      const store = localStore();
      assert.doesNotThrow(() => store.save({ eliza: { n: 1, sum: 1 } }));
      assert.deepEqual(store.load(), {});
      const bandit = createBandit(store);
      assert.doesNotThrow(() => bandit.update('eliza', 1));
      assert.equal(bandit.snapshot().eliza.n, 0);
      assert.equal(typeof bandit.choose(FAMILIES, mulberry32(2)), 'string');
    } finally {
      if (saved) Object.defineProperty(globalThis, 'localStorage', saved);
    }
  });
});
