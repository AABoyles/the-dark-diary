/**
 * llm-client.js - main-thread client for js/workers/llm-worker.js.
 *
 * Runs a transformers.js text-generation model in a module worker so the UI
 * never blocks on generation.
 *
 *   const llm = await createLlm({ modelId, device: 'webgpu' | 'wasm', dtype, onProgress });
 *   const text = await llm.generate(chat, { max_new_tokens: 90, do_sample: true });
 *   llm.dispose();
 *
 * `chat` is an array of { role, content }. `generate` resolves with the content
 * string of the last assistant message. Generation requests are serialized in the
 * worker. `onProgress` receives the raw progress events ({ status, progress, file }).
 *
 * Default model in the worker's callers: 'onnx-community/gemma-4-E2B-it-ONNX'.
 */

export async function createLlm({ modelId, device = 'wasm', dtype, onProgress } = {}) {
  const worker = new Worker(new URL('./workers/llm-worker.js', import.meta.url), { type: 'module' });
  const pending = new Map(); // id -> { resolve, reject }
  let nextId = 1;
  let closed = false;

  const failAll = (err) => {
    for (const { reject } of pending.values()) reject(err);
    pending.clear();
  };

  const close = (reason) => {
    if (closed) return;
    closed = true;
    failAll(new Error(reason));
    try { worker.terminate(); } catch { /* ignore */ }
  };

  worker.onmessage = (e) => {
    const msg = e.data ?? {};
    if (msg.type === 'progress') {
      try { onProgress?.(msg.event); } catch { /* a progress listener must never break the worker */ }
      return;
    }
    const slot = pending.get(msg.id);
    if (!slot) return;
    pending.delete(msg.id);
    if (msg.type === 'error') slot.reject(new Error(msg.message || 'LLM worker error.'));
    else slot.resolve(msg);
  };

  worker.onerror = (e) => {
    const message = e?.message || 'LLM worker crashed.';
    close(message);
  };

  const send = (payload) => new Promise((resolve, reject) => {
    if (closed) {
      reject(new Error('LLM client is disposed.'));
      return;
    }
    const id = nextId++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...payload, id });
  });

  try {
    await send({ type: 'init', modelId, device, dtype });
  } catch (err) {
    close('LLM initialisation failed.');
    throw err;
  }

  return {
    generate(chat, options = {}) {
      return send({ type: 'generate', chat, options }).then((msg) => String(msg.text ?? ''));
    },
    dispose() {
      close('LLM client was disposed.');
    },
  };
}
