/**
 * llm-worker.js - runs a transformers.js text-generation model off the main thread.
 *
 * A module worker. Spawned by js/llm-client.js. Generic: no persona logic here.
 *
 * Protocol (main -> worker):
 *   { type: 'init', id, modelId, device: 'webgpu' | 'wasm', dtype }
 *   { type: 'generate', id, chat, options, stream? }   stream: post 'token' messages as text is produced
 *
 * Protocol (worker -> main):
 *   { type: 'progress', event: { status, progress, file } }   (no id)
 *   { type: 'ready', id }
 *   { type: 'token', id, text }         a streamed piece of the reply (issue #7)
 *   { type: 'result', id, text }        text = last assistant message content
 *   { type: 'error', id, message }
 */

// Vendored by scripts/vendor.mjs (see vendor.lock.json); served from this origin.
const TRANSFORMERS_URL = new URL('../../vendor/transformers/transformers.min.js', import.meta.url).href;
// onnxruntime's wasm and its loader sit side by side in vendor/onnxruntime/. A string
// prefix (not an object of URLs) stops transformers re-fetching them as blob: URLs,
// which the page's CSP does not allow.
const ORT_WASM_PATHS = new URL('../../vendor/onnxruntime/', import.meta.url).href;

let tj = null;          // the transformers.js module, loaded on init
let runChat = null;     // async (chat, options, onText) => string
let queue = Promise.resolve(); // serializes generate calls

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

/**
 * Loads the model. Preferred path: the standard text-generation pipeline.
 * Fallback: drive the multimodal Gemma 4 class directly with text-only input.
 * Mirrors the loadTransformers() fallback in js/ai.js.
 */
async function load(modelId, opts) {
  try {
    const pipe = await tj.pipeline('text-generation', modelId, {
      ...opts,
      progress_callback: forwardProgress,
    });
    return async (chat, gen, onText) => {
      const streamer = streamerFor(pipe.tokenizer, onText);
      const out = await pipe(chat, streamer ? { ...gen, streamer } : gen);
      const generated = out?.[0]?.generated_text;
      const lastTurn = Array.isArray(generated) ? generated.at(-1) : null;
      return typeof lastTurn?.content === 'string' ? lastTurn.content : '';
    };
  } catch (err) {
    console.warn('[llm-worker] pipeline load failed, trying Gemma4ForConditionalGeneration.', err);
    const tokenizer = await tj.AutoTokenizer.from_pretrained(modelId, { progress_callback: forwardProgress });
    const model = await tj.Gemma4ForConditionalGeneration.from_pretrained(modelId, {
      ...opts,
      progress_callback: forwardProgress,
    });
    return async (chat, gen, onText) => {
      const inputs = tokenizer.apply_chat_template(chat, { add_generation_prompt: true, return_dict: true });
      const streamer = streamerFor(tokenizer, onText);
      const out = await model.generate({ ...inputs, ...gen, ...(streamer ? { streamer } : {}) });
      const start = inputs.input_ids.dims.at(-1);
      const [text] = tokenizer.batch_decode(out.slice(null, [start, null]), { skip_special_tokens: true });
      return typeof text === 'string' ? text : '';
    };
  }
}

// A TextStreamer that forwards decoded text pieces as they are produced.
function streamerFor(tokenizer, onText) {
  if (!onText || !tj?.TextStreamer || !tokenizer) return null;
  try {
    return new tj.TextStreamer(tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text) => { if (text) onText(text); },
    });
  } catch {
    return null; // streaming is a nicety; generation still works without it
  }
}

async function loadTransformers() {
  const mod = await import(TRANSFORMERS_URL);
  mod.env.backends.onnx.wasm.wasmPaths = ORT_WASM_PATHS;
  mod.env.allowLocalModels = false; // models come from the Hub only, never from the page's own files
  return mod;
}

async function handleInit(msg) {
  tj = tj ?? await loadTransformers();
  const device = msg.device === 'webgpu' ? 'webgpu' : 'wasm';
  runChat = await load(msg.modelId, { device, dtype: msg.dtype });
  self.postMessage({ type: 'ready', id: msg.id });
}

function handleGenerate(msg) {
  const run = queue.then(async () => {
    if (!runChat) throw new Error('Model not initialised.');
    const onText = msg.stream ? (text) => self.postMessage({ type: 'token', id: msg.id, text }) : null;
    const text = await runChat(Array.isArray(msg.chat) ? msg.chat : [], msg.options ?? {}, onText);
    self.postMessage({ type: 'result', id: msg.id, text: String(text ?? '') });
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
    } else if (msg.type === 'generate') {
      await handleGenerate(msg);
    } else {
      throw new Error(`Unknown message type: ${msg.type}`);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id, message: describeError(err) });
  }
};
