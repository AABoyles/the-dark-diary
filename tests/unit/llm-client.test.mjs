// js/llm-client.js with the Worker replaced by a fake. Covers the request and
// reply protocol, init failure, out-of-order replies, errors, crashes and
// dispose.
//
// Extending for streaming: the fake's dispatch() gets a `post(data)` helper.
// A streamed piece is `post({ type: 'token', id: msg.id, text })` sent before
// the final `result`. The client routes tokens by id, so the handler only
// has to post them before it resolves the request.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createLlm } from '../../js/llm-client.js';

// ---------------------------------------------------------------------------
// Fake worker
// ---------------------------------------------------------------------------

const fake = {
  instances: [],
  log: [],   // every message the client posted, in order
  initError: null,
};

class FakeLlmWorker {
  constructor(url, opts) {
    assert.equal(opts.type, 'module');
    assert.ok(String(url).endsWith('/js/workers/llm-worker.js'), String(url));
    this.terminated = false;
    this.onmessage = null;
    this.onerror = null;
    fake.instances.push(this);
  }

  postMessage(msg) {
    fake.log.push(msg);
    // Replies arrive asynchronously, as they would from a real worker.
    const delay = msg.type === 'generate' && msg.chat.at(-1).content === 'slow' ? 25 : 0;
    setTimeout(() => this.dispatch(msg), delay);
  }

  dispatch(msg) {
    if (this.terminated) return;
    const post = (data) => this.onmessage?.({ data });
    if (msg.type === 'init') {
      post({ type: 'progress', event: { status: 'progress', progress: 10 } });
      if (fake.initError) post({ type: 'error', id: msg.id, message: fake.initError });
      else post({ type: 'ready', id: msg.id });
      return;
    }
    if (msg.type === 'generate') {
      const last = msg.chat.at(-1).content;
      if (last === 'boom') post({ type: 'error', id: msg.id, message: 'generation exploded' });
      else if (last === 'hang') return; // never answers
      else if (last === 'empty') post({ type: 'result', id: msg.id }); // no text field
      else if (last === 'stream') {
        // streaming (issue #7): only when the client asked for it
        if (msg.stream) for (const t of ['Washing ', 'blood ', 'from ', 'silk.']) post({ type: 'token', id: msg.id, text: t });
        post({ type: 'result', id: msg.id, text: 'Washing blood from silk.' });
      }
      else post({ type: 'result', id: msg.id, text: `got ${last} ${msg.options.max_new_tokens}` });
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
  Object.defineProperty(globalThis, 'Worker', { value: FakeLlmWorker, configurable: true, writable: true });
});
after(() => {
  if (realWorker) Object.defineProperty(globalThis, 'Worker', realWorker);
  else delete globalThis.Worker;
});

function resetFake() {
  fake.log.length = 0;
  fake.initError = null;
}

const user = (content) => [{ role: 'user', content }];

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

test('createLlm boots the worker with the model settings and forwards progress', async () => {
  resetFake();
  const progress = [];
  const llm = await createLlm({ modelId: 'm', device: 'webgpu', dtype: 'q4f16', onProgress: (e) => progress.push(e) });
  const init = fake.log.find((m) => m.type === 'init');
  assert.equal(init.modelId, 'm');
  assert.equal(init.device, 'webgpu');
  assert.equal(init.dtype, 'q4f16');
  assert.deepEqual(progress, [{ status: 'progress', progress: 10 }]);
  llm.dispose();
});

test('createLlm defaults to the wasm device', async () => {
  resetFake();
  const llm = await createLlm({ modelId: 'm' });
  assert.equal(fake.log.find((m) => m.type === 'init').device, 'wasm');
  llm.dispose();
});

test('generate resolves with the text and passes the options through', async () => {
  resetFake();
  const llm = await createLlm({ modelId: 'm' });
  assert.equal(await llm.generate(user('hi'), { max_new_tokens: 9 }), 'got hi 9');
  const gen = fake.log.filter((m) => m.type === 'generate').at(-1);
  assert.deepEqual(gen.options, { max_new_tokens: 9 });
  assert.deepEqual(gen.chat, user('hi'));
  llm.dispose();
});

test('streaming: onToken receives each piece in order, before the final text resolves', async () => {
  resetFake();
  const llm = await createLlm({ modelId: 'm' });
  const pieces = [];
  const text = await llm.generate(user('stream'), {}, { onToken: (t) => pieces.push(t) });
  assert.deepEqual(pieces, ['Washing ', 'blood ', 'from ', 'silk.']);
  assert.equal(pieces.join(''), text);
  assert.equal(fake.log.filter((m) => m.type === 'generate').at(-1).stream, true);
  llm.dispose();
});

test('streaming: without onToken the worker is not asked to stream, and a throwing onToken is contained', async () => {
  resetFake();
  const llm = await createLlm({ modelId: 'm' });
  assert.equal(await llm.generate(user('stream'), {}), 'Washing blood from silk.');
  assert.equal(fake.log.filter((m) => m.type === 'generate').at(-1).stream, false);
  const text = await llm.generate(user('stream'), {}, { onToken: () => { throw new Error('display hiccup'); } });
  assert.equal(text, 'Washing blood from silk.');
  llm.dispose();
});

test('generate with no options still works', async () => {
  resetFake();
  const llm = await createLlm({ modelId: 'm' });
  assert.equal(await llm.generate(user('a')), 'got a undefined');
  llm.dispose();
});

test('a reply with no text resolves to an empty string', async () => {
  resetFake();
  const llm = await createLlm({ modelId: 'm' });
  assert.equal(await llm.generate(user('empty')), '');
  llm.dispose();
});

test('every request carries its own id, and the replies match them', async () => {
  resetFake();
  const llm = await createLlm({ modelId: 'm' });
  const [a, b] = await Promise.all([llm.generate(user('a'), {}), llm.generate(user('b'), {})]);
  assert.equal(a, 'got a undefined');
  assert.equal(b, 'got b undefined');
  const ids = fake.log.filter((m) => m.type === 'generate').map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  llm.dispose();
});

test('replies are routed by id even when they arrive out of order', async () => {
  resetFake();
  const llm = await createLlm({ modelId: 'm' });
  // 'slow' is answered after 'fast', although it was sent first.
  const [slow, fast] = await Promise.all([llm.generate(user('slow'), {}), llm.generate(user('fast'), {})]);
  assert.equal(slow, 'got slow undefined');
  assert.equal(fast, 'got fast undefined');
  llm.dispose();
});

test('a reply for an unknown id is ignored', async () => {
  resetFake();
  const llm = await createLlm({ modelId: 'm' });
  const worker = fake.instances.at(-1);
  assert.doesNotThrow(() => worker.onmessage({ data: { type: 'result', id: 99999, text: 'stray' } }));
  assert.equal(await llm.generate(user('still fine'), {}), 'got still fine undefined');
  llm.dispose();
});

test('a throwing progress listener does not break boot', async () => {
  resetFake();
  const llm = await createLlm({ modelId: 'm', onProgress: () => { throw new Error('listener bug'); } });
  assert.equal(await llm.generate(user('ok'), {}), 'got ok undefined');
  llm.dispose();
});

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

test('an init failure rejects with the worker message and terminates the worker', async () => {
  resetFake();
  fake.initError = 'load failed';
  await assert.rejects(createLlm({ modelId: 'm' }), /load failed/);
  assert.equal(fake.instances.at(-1).terminated, true);
});

test('a generate error rejects that call only, and the client keeps working', async () => {
  resetFake();
  const llm = await createLlm({ modelId: 'm' });
  await assert.rejects(llm.generate(user('boom'), {}), /generation exploded/);
  assert.equal(await llm.generate(user('next'), {}), 'got next undefined');
  llm.dispose();
});

test('a worker crash rejects the pending call, and later calls are refused', async () => {
  resetFake();
  const llm = await createLlm({ modelId: 'm' });
  const worker = fake.instances.at(-1);
  const pending = llm.generate(user('hang'), {});
  worker.crash('worker died');
  await assert.rejects(pending, /worker died/);
  assert.equal(worker.terminated, true);
  await assert.rejects(llm.generate(user('after'), {}), /disposed/);
});

// ---------------------------------------------------------------------------
// Dispose
// ---------------------------------------------------------------------------

test('dispose rejects pending calls and terminates the worker', async () => {
  resetFake();
  const llm = await createLlm({ modelId: 'm' });
  const worker = fake.instances.at(-1);
  const pending = llm.generate(user('hang'), {});
  llm.dispose();
  await assert.rejects(pending, /disposed/);
  assert.equal(worker.terminated, true);
});

test('generate after dispose is refused, and a second dispose is harmless', async () => {
  resetFake();
  const llm = await createLlm({ modelId: 'm' });
  llm.dispose();
  assert.doesNotThrow(() => llm.dispose());
  await assert.rejects(llm.generate(user('late'), {}), /disposed/);
});
