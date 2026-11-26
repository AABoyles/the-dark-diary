// js/embed.js with the Worker replaced by a fake that answers with hashed
// bag-of-words vectors. Covers protocol, boot, gating, cache, threshold and
// the failure paths. Each scenario gets a fresh module instance (query string),
// because embed.js keeps its state at module level.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { INTENTS } from '../../js/intents.js';

const DIM = 64;

// ---------------------------------------------------------------------------
// Fake worker
// ---------------------------------------------------------------------------

const fake = {
  instances: [],   // every FakeEmbedWorker constructed
  inits: 0,        // init messages handled
  embedded: 0,     // texts embedded across all instances
  mode: 'ok',      // 'ok' | 'initfail'
};

function vecFor(text) {
  const v = new Array(DIM).fill(0);
  for (const w of String(text).toLowerCase().split(/\s+/).filter(Boolean)) {
    let h = 0;
    for (const c of w) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    v[h % DIM] += 1;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

class FakeEmbedWorker {
  constructor(url, opts) {
    assert.equal(opts.type, 'module');
    assert.ok(String(url).endsWith('/js/workers/embed-worker.js'), String(url));
    this.url = String(url);
    this.terminated = false;
    this.onmessage = null;
    this.onerror = null;
    fake.instances.push(this);
  }

  postMessage(msg) {
    setTimeout(() => this.handle(msg), 0);
  }

  handle(msg) {
    if (this.terminated) return;
    const reply = (data) => this.onmessage?.({ data });
    if (msg.type === 'init') {
      fake.inits++;
      if (fake.mode === 'initfail') {
        reply({ type: 'error', id: msg.id, message: 'no gpu, no wasm' });
        return;
      }
      reply({ type: 'progress', event: { status: 'progress', progress: 40 } });
      reply({ type: 'ready', id: msg.id });
    } else if (msg.type === 'embed') {
      fake.embedded += msg.texts.length;
      reply({ type: 'result', id: msg.id, vectors: msg.texts.map(vecFor) });
    }
  }

  terminate() {
    this.terminated = true;
  }

  /** Test helper: simulate the worker crashing. */
  crash(message) {
    this.onerror?.({ message });
  }
}

const realWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
before(() => {
  Object.defineProperty(globalThis, 'Worker', { value: FakeEmbedWorker, configurable: true, writable: true });
});
after(() => {
  if (realWorker) Object.defineProperty(globalThis, 'Worker', realWorker);
  else delete globalThis.Worker;
});

let scenario = 0;
/** A fresh copy of js/embed.js, with its own state. */
async function freshEmbed() {
  scenario++;
  return import(`../../js/embed.js?scenario=${scenario}`);
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test('cosine: identical, orthogonal and degenerate inputs', async () => {
  const E = await freshEmbed();
  assert.equal(E.cosine(new Float32Array([1, 0]), new Float32Array([1, 0])), 1);
  assert.equal(E.cosine([1, 0], [0, 1]), 0);
  assert.equal(E.cosine(null, [1]), 0);
  assert.equal(E.cosine([1, 2], [1]), 0, 'mismatched lengths');
  assert.equal(E.cosine([], []), 0, 'empty');
  assert.equal(E.cosine([0, 0], [1, 1]), 0, 'zero vector');
  assert.equal(E.cosine([NaN, 1], [1, 1]), 0, 'non-finite');
});

// ---------------------------------------------------------------------------
// Before boot
// ---------------------------------------------------------------------------

test('before boot the embedder is unavailable and starts no worker', async () => {
  const E = await freshEmbed();
  const before = fake.instances.length;
  assert.equal(E.embedderReady(), false);
  assert.equal(await E.embed('hello there friend'), null);
  assert.equal(await E.embedMany(['a b']), null);
  assert.equal(await E.matchIntent('i am so tired today'), null);
  assert.equal(fake.instances.length, before, 'no worker spawned by reads');
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

test('boot runs once, shares one promise, forwards progress and embeds each exemplar once', async () => {
  const E = await freshEmbed();
  fake.inits = 0;
  fake.embedded = 0;
  const workersBefore = fake.instances.length;

  const statusA = [];
  const statusB = [];
  const p1 = E.initEmbedder((s) => statusA.push(s));
  const p2 = E.initEmbedder((s) => statusB.push(s));
  assert.strictEqual(p1, p2, 'the same promise is returned');
  assert.equal(await p1, true);

  assert.equal(E.embedderReady(), true);
  assert.equal(fake.inits, 1, 'one init message');
  assert.equal(fake.instances.length - workersBefore, 1, 'one worker');

  const exemplars = INTENTS.reduce((n, i) => n + 1 + i.examples.length, 0);
  assert.equal(fake.embedded, exemplars, 'every exemplar embedded once');

  assert.ok(statusA.some((s) => s.includes('40%')), `progress forwarded: ${statusA.join(' | ')}`);
  assert.ok(statusB.length > 0, 'a second listener also hears the boot');
});

// ---------------------------------------------------------------------------
// Matching, gating and threshold
// ---------------------------------------------------------------------------

test('texts outside two to sixty words are never embedded', async () => {
  const E = await freshEmbed();
  await E.initEmbedder(() => {});
  fake.embedded = 0;

  assert.equal(await E.matchIntent('tired'), null, 'one word');
  assert.equal(await E.matchIntent('   '), null, 'blank');
  assert.equal(await E.matchIntent(Array(61).fill('word').join(' ')), null, '61 words');
  assert.equal(fake.embedded, 0, 'gated texts never reach the worker');

  await E.matchIntent(Array(60).fill('tired').join(' '));
  assert.equal(fake.embedded, 1, 'a sixty-word text passes the gate');
});

test('each intent canonical matches its own intent with score 1', async () => {
  const E = await freshEmbed();
  await E.initEmbedder(() => {});
  for (const it of INTENTS) {
    const words = it.canonical.trim().split(/\s+/).length;
    if (words < 2) {
      // Single words are below the two-word gate, so they never match.
      assert.equal(await E.matchIntent(it.canonical), null, `"${it.canonical}" is gated`);
      continue;
    }
    const m = await E.matchIntent(it.canonical);
    assert.ok(m, `no match for "${it.canonical}"`);
    assert.equal(m.intent, it.intent, `"${it.canonical}"`);
    assert.equal(m.canonical, it.canonical);
    assert.ok(Math.abs(m.score - 1) < 1e-6, `score ${m.score}`);
  }
});

test('the threshold decides: a high bar rejects a perfect match, a zero bar accepts anything', async () => {
  const E = await freshEmbed();
  await E.initEmbedder(() => {});
  const canonical = INTENTS.find((i) => i.canonical.split(/\s+/).length >= 2).canonical;
  assert.equal(await E.matchIntent(canonical, { threshold: 1.01 }), null);
  assert.ok(await E.matchIntent(canonical, { threshold: 0.999 }), 'an exact match clears 0.999');
  assert.ok(await E.matchIntent('zebra quartz umbrella xylophone', { threshold: 0 }), 'zero bar');
});

test('unrelated text falls below the default threshold', async () => {
  const E = await freshEmbed();
  await E.initEmbedder(() => {});
  assert.equal(await E.matchIntent('zebra quartz umbrella xylophone'), null);
});

// ---------------------------------------------------------------------------
// Embedding and cache
// ---------------------------------------------------------------------------

test('embed returns a normalized Float32Array of the right length, or null for blank text', async () => {
  const E = await freshEmbed();
  await E.initEmbedder(() => {});
  const v = await E.embed('hello dear diary');
  assert.ok(v instanceof Float32Array);
  assert.equal(v.length, DIM);
  assert.equal(await E.embed('   '), null);
});

test('embedMany keeps order and reuses the same vector for a repeated text', async () => {
  const E = await freshEmbed();
  await E.initEmbedder(() => {});
  const many = await E.embedMany(['one two', 'one two', 'three four']);
  assert.equal(many.length, 3);
  assert.strictEqual(many[0], many[1]);
  assert.notStrictEqual(many[0], many[2]);
});

test('the cache answers repeats locally, and evicts after 256 newer entries', async () => {
  const E = await freshEmbed();
  await E.initEmbedder(() => {});

  fake.embedded = 0;
  await E.embed('alpha beta gamma');
  await E.embed('alpha beta gamma');
  assert.equal(fake.embedded, 1, 'second call hits the cache');

  for (let i = 0; i < 256; i++) await E.embed(`filler text number${i} here`);
  fake.embedded = 0;
  await E.embed('alpha beta gamma');
  assert.equal(fake.embedded, 1, 'evicted once 256 newer entries arrived');
});

test('the cache keeps a recently used entry alive', async () => {
  const E = await freshEmbed();
  await E.initEmbedder(() => {});

  await E.embed('recent one here');
  for (let i = 0; i < 100; i++) await E.embed(`other text n${i} x`);
  await E.embed('recent one here'); // touch it again
  fake.embedded = 0;
  await E.embed('recent one here');
  assert.equal(fake.embedded, 0, 'still cached');
});

// ---------------------------------------------------------------------------
// Failure paths
// ---------------------------------------------------------------------------

test('an init failure resolves false, never rejects, and stays unavailable', async () => {
  const E = await freshEmbed();
  const before = fake.instances.length;
  fake.mode = 'initfail';
  try {
    const p = E.initEmbedder(() => {});
    assert.equal(await p, false);
    assert.equal(E.embedderReady(), false);
    assert.equal(await E.matchIntent('i am so tired today'), null);
    assert.equal(await E.embed('i am so tired today'), null);
    assert.equal(fake.instances.length - before, 1, 'one worker was tried');
    assert.equal(fake.instances.at(-1).terminated, true, 'the failed worker is terminated');

    // A second call shares the failed boot rather than retrying.
    const again = E.initEmbedder();
    assert.strictEqual(again, p);
    assert.equal(await again, false);
    assert.equal(fake.instances.length - before, 1, 'no retry');
  } finally {
    fake.mode = 'ok';
  }
});

test('a worker crash after boot makes the embedder unavailable', async () => {
  const E = await freshEmbed();
  await E.initEmbedder(() => {});
  assert.equal(E.embedderReady(), true);
  const worker = fake.instances.at(-1);

  worker.crash('boom');

  assert.equal(E.embedderReady(), false);
  assert.equal(worker.terminated, true);
  assert.equal(await E.matchIntent('i am so tired today'), null);
});

test('without a Worker constructor, boot returns false without throwing', async () => {
  const E = await freshEmbed();
  const saved = globalThis.Worker;
  delete globalThis.Worker;
  try {
    assert.equal(await E.initEmbedder(() => {}), false);
    assert.equal(E.embedderReady(), false);
  } finally {
    globalThis.Worker = saved;
  }
});
