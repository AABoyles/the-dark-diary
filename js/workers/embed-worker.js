/**
 * embed-worker.js - sentence embeddings via transformers.js, off the main thread.
 *
 * A module worker. Spawned by js/embed.js.
 *
 * Model: EMBED_MODEL_ID below (all-MiniLM-L6-v2, 384 dims, mean pooling, normalized).
 *
 * Protocol (main -> worker):
 *   { type: 'init', id }
 *   { type: 'embed', id, texts: [string, ...] }
 *
 * Protocol (worker -> main):
 *   { type: 'progress', event: { status, progress, file } }   (no id)
 *   { type: 'ready', id }
 *   { type: 'result', id, vectors: [[number, ...], ...] }     one per text, in order
 *   { type: 'error', id, message }
 */

const EMBED_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
// Vendored by scripts/vendor.mjs (see vendor.lock.json); served from this origin.
const TRANSFORMERS_URL = new URL('../../vendor/transformers/transformers.min.js', import.meta.url).href;
// onnxruntime's wasm and its loader sit side by side in vendor/onnxruntime/. A string
// prefix (not an object of URLs) stops transformers re-fetching them as blob: URLs,
// which the page's CSP does not allow.
const ORT_WASM_PATHS = new URL('../../vendor/onnxruntime/', import.meta.url).href;

let tj = null;          // transformers.js module
let extractor = null;   // feature-extraction pipeline
let queue = Promise.resolve();

function describeError(err) {
  return String(err?.message ?? err ?? 'unknown error');
}

function forwardProgress(ev) {
  if (!ev || typeof ev !== 'object') return;
  self.postMessage({
    type: 'progress',
    event: {
      status: ev.status,
      progress: Number.isFinite(ev.progress) ? ev.progress : undefined,
      file: ev.file,
    },
  });
}

function preferredDevice() {
  return self.navigator?.gpu ? 'webgpu' : 'wasm';
}

// Quantized (q8) weights first: smaller download, and the same embeddings closely enough.
// fp32 is the fallback if the q8 files cannot be loaded.
async function build(device) {
  const common = { device, progress_callback: forwardProgress };
  try {
    return await tj.pipeline('feature-extraction', EMBED_MODEL_ID, { ...common, dtype: 'q8' });
  } catch (err) {
    console.warn('[embed-worker] q8 model failed to load, falling back to fp32.', err);
    return tj.pipeline('feature-extraction', EMBED_MODEL_ID, { ...common, dtype: 'fp32' });
  }
}

async function loadTransformers() {
  const mod = await import(TRANSFORMERS_URL);
  mod.env.backends.onnx.wasm.wasmPaths = ORT_WASM_PATHS;
  mod.env.allowLocalModels = false; // models come from the Hub only, never from the page's own files
  return mod;
}

async function handleInit(msg) {
  if (extractor) {
    self.postMessage({ type: 'ready', id: msg.id });
    return;
  }
  tj = tj ?? await loadTransformers();
  const first = preferredDevice();
  try {
    extractor = await build(first);
  } catch (err) {
    if (first === 'wasm') throw err;
    console.warn('[embed-worker] WebGPU init failed, retrying on WASM.', err);
    extractor = await build('wasm');
  }
  self.postMessage({ type: 'ready', id: msg.id });
}

function toPlainVectors(output, count) {
  // A batch of n texts gives an [n, d] tensor; tolist() yields n arrays.
  const list = typeof output?.tolist === 'function' ? output.tolist() : output;
  if (!Array.isArray(list)) throw new Error('Unexpected embedding output.');
  const vectors = Array.isArray(list[0]) ? list : [list];
  if (vectors.length !== count) throw new Error('Embedding count mismatch.');
  return vectors.map((v) => Array.from(v, Number));
}

function handleEmbed(msg) {
  const run = queue.then(async () => {
    if (!extractor) throw new Error('Embedder not initialised.');
    const texts = (Array.isArray(msg.texts) ? msg.texts : []).map((t) => String(t ?? ''));
    if (texts.length === 0) {
      self.postMessage({ type: 'result', id: msg.id, vectors: [] });
      return;
    }
    const output = await extractor(texts, { pooling: 'mean', normalize: true });
    const vectors = toPlainVectors(output, texts.length);
    self.postMessage({ type: 'result', id: msg.id, vectors });
  });
  queue = run.catch(() => {});
  return run;
}

self.onmessage = async (e) => {
  const msg = e.data ?? {};
  const id = msg.id;
  try {
    if (msg.type === 'init') {
      await handleInit(msg);
    } else if (msg.type === 'embed') {
      await handleEmbed(msg);
    } else {
      throw new Error(`Unknown message type: ${msg.type}`);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id, message: describeError(err) });
  }
};
