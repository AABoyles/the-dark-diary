// mind.js: decides which in-browser language model the diary's "mind" should use.
//
// Three questions are answered here, all without loading any model:
//   1. What can this device do?           -> assessDevice()
//   2. What should it use by default?     -> recommend() / autoDecision() / options()
//   3. How big is the download, and what did the user pick last time?
//                                         -> downloadSize(), getChoice(), setChoice()
//
// Choices: 'builtin' (Chrome's Prompt API model), 'large', 'small', 'none'
// ('none' keeps the scripted ELIZA engine). Nothing here throws: every browser
// probe is wrapped, so the diary keeps working on browsers that expose nothing.

// Model tiers. dtype is picked per device by plan(): gpuDtype on WebGPU,
// cpuDtype on WASM (null means the tier cannot run without WebGPU).
export const TIERS = {
  large: { key: 'large', modelId: 'onnx-community/gemma-4-E2B-it-ONNX', needsGpu: true, gpuDtype: 'q4f16', cpuDtype: null, approx: 'a few gigabytes' },
  small: { key: 'small', modelId: 'onnx-community/gemma-3-270m-it-ONNX', needsGpu: false, gpuDtype: 'q4f16', cpuDtype: 'q4', approx: 'a few hundred megabytes' },
};

const CHOICE_KEY = 'dd-mind';          // localStorage key for the saved choice
const SIZE_CACHE_PREFIX = 'dd-size:';  // localStorage prefix for cached download sizes
const VALID_CHOICES = ['builtin', 'large', 'small', 'none'];
const SIZE_TIMEOUT_MS = 6000;

// Thresholds from the decision rules (bytes).
const LOW_STORAGE_BYTES = 1.2e9;   // below this, free space is a real constraint
const SMALL_FITS_BYTES = 6e8;      // the small tier needs at least this much free

// ---------------------------------------------------------------------------
// Storage helpers. Accessing localStorage itself can throw (blocked site data).
// ---------------------------------------------------------------------------
function getStore() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Device assessment
// ---------------------------------------------------------------------------

// Probes the browser. Every probe is isolated, so one failing never affects the rest.
export async function assessDevice() {
  const nav = (typeof navigator !== 'undefined' && navigator) || {};

  // WebGPU is only usable if an adapter actually comes back.
  let webgpu = false;
  try {
    if (nav.gpu && typeof nav.gpu.requestAdapter === 'function') {
      webgpu = !!(await nav.gpu.requestAdapter());
    }
  } catch {
    webgpu = false;
  }

  // navigator.deviceMemory is in GB and Chrome caps it at 8. Absent means unknown.
  let memoryGB = null;
  try {
    if (typeof nav.deviceMemory === 'number') memoryGB = nav.deviceMemory;
  } catch {
    memoryGB = null;
  }

  // Network Information API. Not available on every browser, so both fields are optional.
  let saveData = false;
  let slowNetwork = false;
  try {
    const conn = nav.connection;
    saveData = conn?.saveData === true;
    slowNetwork = ['slow-2g', '2g', '3g'].includes(conn?.effectiveType);
  } catch {
    saveData = false;
    slowNetwork = false;
  }

  // Free space = quota minus usage, from the storage estimate.
  let storageFreeBytes = null;
  try {
    const est = await nav.storage.estimate();
    if (typeof est?.quota === 'number' && typeof est?.usage === 'number') {
      storageFreeBytes = Math.max(0, est.quota - est.usage);
    }
  } catch {
    storageFreeBytes = null;
  }

  return { webgpu, memoryGB, saveData, slowNetwork, storageFreeBytes };
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

// Returns the model and dtype a tier would use on this device, or null when it can't run.
export function plan(tierKey, device) {
  const tier = TIERS[tierKey];
  if (!tier) return null;
  if (tier.needsGpu && !device?.webgpu) return null;

  if (device?.webgpu) {
    return { key: tier.key, modelId: tier.modelId, device: 'webgpu', dtype: tier.gpuDtype };
  }
  if (!tier.cpuDtype) return null;
  return { key: tier.key, modelId: tier.modelId, device: 'wasm', dtype: tier.cpuDtype };
}

// Picks the best default choice for this device. Rules are applied in order.
export function recommend(device, builtinStatus) {
  const d = device || {};

  // Chrome already has the model: nothing to download.
  if (builtinStatus === 'available') return 'builtin';

  // Issue #6: on metered or slow connections, don't pull a model unasked.
  if (d.saveData || d.slowNetwork) return 'none';

  // Little free space: small only if it still fits.
  if (typeof d.storageFreeBytes === 'number' && d.storageFreeBytes < LOW_STORAGE_BYTES) {
    return d.storageFreeBytes >= SMALL_FITS_BYTES ? 'small' : 'none';
  }

  // Chrome's model is available to download, so prefer it over our own downloads.
  if (builtinStatus === 'downloadable' || builtinStatus === 'downloading') return 'builtin';

  // Big model: needs WebGPU and enough memory (unknown memory is given the benefit of the doubt).
  if (d.webgpu && (d.memoryGB === null || d.memoryGB >= 8)) return 'large';

  // Small model runs on WASM, so it only needs modest memory.
  if (d.memoryGB === null || d.memoryGB >= 2) return 'small';

  return 'none';
}

// Returns the choice to apply without asking the user, or null when we should ask.
export function autoDecision(device, builtinStatus) {
  if (builtinStatus === 'available') return 'builtin';
  // Issue #6: stay on ELIZA on metered or slow connections, without asking.
  if (device?.saveData || device?.slowNetwork) return 'none';
  return null;
}

// Returns the choices the user may pick from, recommended first, 'none' always last.
export function options(device, builtinStatus) {
  const d = device || {};
  const list = [];
  if (['available', 'downloadable', 'downloading'].includes(builtinStatus)) list.push('builtin');
  if (d.webgpu) list.push('large');
  list.push('small');

  // 'none' is always the final option, so it stays out of the reordering.
  const rec = recommend(d, builtinStatus);
  const ordered = list.includes(rec) ? [rec, ...list.filter((c) => c !== rec)] : list;
  ordered.push('none');
  return ordered;
}

// ---------------------------------------------------------------------------
// Download size
// ---------------------------------------------------------------------------

// Returns the bytes the tier's ONNX files add up to for its dtype, or null on any failure.
// Results are cached in localStorage per model and dtype.
export async function downloadSize(tierKey, device) {
  const p = plan(tierKey, device);
  if (!p) return null;

  const cacheKey = `${SIZE_CACHE_PREFIX}${p.modelId}:${p.dtype}`;
  const store = getStore();
  try {
    const cached = store?.getItem(cacheKey);
    if (cached != null && Number.isFinite(Number(cached))) return Number(cached);
  } catch {
    // Unreadable cache: fall through to the network.
  }

  const url = `https://huggingface.co/api/models/${p.modelId}/tree/main/onnx`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SIZE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const tree = await res.json();
    if (!Array.isArray(tree)) return null;

    // Matches e.g. "_q4f16.onnx", "_q4f16.onnx_data" and "_q4f16.onnx_data_1".
    // The leading underscore and anchoring stop "_q4.onnx" from matching "_q4f16.onnx".
    const re = new RegExp(`_${p.dtype}\\.onnx(_data(_\\d+)?)?$`);
    let total = 0;
    let matched = 0;
    for (const f of tree) {
      if (!f || f.type === 'directory' || typeof f.path !== 'string') continue;
      const base = f.path.split('/').pop();
      if (!re.test(base)) continue;
      const size = typeof f.lfs?.size === 'number' ? f.lfs.size : f.size;
      if (typeof size !== 'number') continue;
      total += size;
      matched++;
    }
    if (matched === 0) return null;

    try {
      store?.setItem(cacheKey, String(total));
    } catch {
      // Storage full or blocked: the size is still correct, just not cached.
    }
    return total;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Formats bytes for display: 'about 270 MB' or 'about 2.9 GB'. null in, null out.
export function formatBytes(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const mb = Math.max(10, Math.round(n / 1e7) * 10); // nearest 10 MB
  if (mb < 1000) return `about ${mb} MB`;
  return `about ${(n / 1e9).toFixed(1)} GB`;
}

// ---------------------------------------------------------------------------
// Saved choice
// ---------------------------------------------------------------------------

// Reads the stored record. Returns null when unset, unreadable or invalid.
function readRecord() {
  try {
    const raw = getStore()?.getItem(CHOICE_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw);
    return rec && VALID_CHOICES.includes(rec.choice) ? rec : null;
  } catch {
    return null;
  }
}

// Returns the saved choice, or null.
export function getChoice() {
  return readRecord()?.choice ?? null;
}

// Saves a choice. Invalid choices are rejected. Returns true when stored.
export function setChoice(choice, { auto = false } = {}) {
  if (!VALID_CHOICES.includes(choice)) return false;
  const store = getStore();
  if (!store) return false;
  try {
    store.setItem(CHOICE_KEY, JSON.stringify({ choice, at: Date.now(), auto: !!auto }));
    return true;
  } catch {
    return false;
  }
}

// True if the saved choice was applied automatically rather than picked by the user.
export function wasAutomatic() {
  return readRecord()?.auto === true;
}
