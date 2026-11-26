// js/mind.js: device profiles, which model to offer, the plan for a choice,
// download sizes (with fetch stubbed), byte formatting, the saved choice and
// the blocked-storage path. Browser globals are stubbed and restored.

import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIERS, recommend, autoDecision, options, plan, formatBytes, assessDevice,
  downloadSize, getChoice, setChoice, wasAutomatic,
} from '../../js/mind.js';

// ---------------------------------------------------------------------------
// Browser globals
// ---------------------------------------------------------------------------

const originals = {
  localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'),
  navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
  fetch: Object.getOwnPropertyDescriptor(globalThis, 'fetch'),
};

const store = new Map();
const fakeLocalStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let nav = {};
let fetchImpl = async () => { throw new Error('no fetch stub'); };

function setStorage(value) {
  Object.defineProperty(globalThis, 'localStorage', { value, configurable: true, writable: true });
}
function setNavigator(value) {
  nav = value;
  Object.defineProperty(globalThis, 'navigator', { get: () => nav, configurable: true });
}
function setFetch(fn) {
  fetchImpl = fn;
}

function restoreGlobal(name, descriptor) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}

setStorage(fakeLocalStorage);
setNavigator({});
Object.defineProperty(globalThis, 'fetch', {
  value: (...args) => fetchImpl(...args),
  configurable: true,
  writable: true,
});

beforeEach(() => {
  store.clear();
  setStorage(fakeLocalStorage);
  setNavigator({});
  setFetch(async () => { throw new Error('no fetch stub'); });
});

after(() => {
  restoreGlobal('localStorage', originals.localStorage);
  restoreGlobal('navigator', originals.navigator);
  restoreGlobal('fetch', originals.fetch);
});

// ---------------------------------------------------------------------------
// Device profiles
// ---------------------------------------------------------------------------

const D = {
  desktopGpu8:   { webgpu: true,  memoryGB: 8,    saveData: false, slowNetwork: false, storageFreeBytes: 5e10 },
  laptopNoGpu8:  { webgpu: false, memoryGB: 8,    saveData: false, slowNetwork: false, storageFreeBytes: 5e10 },
  phone4NoGpu:   { webgpu: false, memoryGB: 4,    saveData: false, slowNetwork: false, storageFreeBytes: 5e10 },
  phoneSaveData: { webgpu: true,  memoryGB: 4,    saveData: true,  slowNetwork: false, storageFreeBytes: 5e10 },
  slow2g:        { webgpu: true,  memoryGB: 8,    saveData: false, slowNetwork: true,  storageFreeBytes: 5e10 },
  lowStor500:    { webgpu: true,  memoryGB: 8,    saveData: false, slowNetwork: false, storageFreeBytes: 5e8 },
  lowStor900:    { webgpu: true,  memoryGB: 8,    saveData: false, slowNetwork: false, storageFreeBytes: 9e8 },
  unknownMemGpu: { webgpu: true,  memoryGB: null, saveData: false, slowNetwork: false, storageFreeBytes: null },
  memory1NoGpu:  { webgpu: false, memoryGB: 1,    saveData: false, slowNetwork: false, storageFreeBytes: null },
  gpu4:          { webgpu: true,  memoryGB: 4,    saveData: false, slowNetwork: false, storageFreeBytes: null },
};

describe('recommend', () => {
  const cases = [
    ['desktopGpu8', 'none', 'large'],
    ['laptopNoGpu8', 'none', 'small'],
    ['phone4NoGpu', 'none', 'small'],
    ['phoneSaveData', 'none', 'none'],
    ['slow2g', 'none', 'none'],
    ['lowStor500', 'none', 'none'],       // under 6e8 free: none
    ['lowStor900', 'none', 'small'],      // 6e8 to 1.2e9 free: small only
    ['unknownMemGpu', 'none', 'large'],
    ['desktopGpu8', 'available', 'builtin'],
    ['desktopGpu8', 'downloadable', 'builtin'],
    ['laptopNoGpu8', 'downloading', 'builtin'],
    ['phoneSaveData', 'downloadable', 'none'], // data saver beats a built-in download
    ['memory1NoGpu', 'none', 'none'],
    ['gpu4', 'none', 'small'],
  ];
  for (const [profile, status, expected] of cases) {
    test(`${profile} with built-in ${status} recommends ${expected}`, () => {
      assert.equal(recommend(D[profile], status), expected);
    });
  }
});

describe('autoDecision', () => {
  const cases = [
    ['desktopGpu8', 'available', 'builtin'],
    ['phoneSaveData', 'none', 'none'],
    ['slow2g', 'downloadable', 'none'],
    ['desktopGpu8', 'none', null],
    ['desktopGpu8', 'downloadable', null],
  ];
  for (const [profile, status, expected] of cases) {
    test(`${profile} with built-in ${status} decides ${expected}`, () => {
      assert.equal(autoDecision(D[profile], status), expected);
    });
  }
});

describe('options', () => {
  test('a desktop with no built-in model offers large, small, none', () => {
    assert.deepEqual(options(D.desktopGpu8, 'none'), ['large', 'small', 'none']);
  });
  test('a laptop without WebGPU offers small and none only', () => {
    assert.deepEqual(options(D.laptopNoGpu8, 'none'), ['small', 'none']);
  });
  test('a downloadable built-in model is offered first, with the tiers after it', () => {
    assert.deepEqual(options(D.desktopGpu8, 'downloadable'), ['builtin', 'large', 'small', 'none']);
  });
  test('an available built-in model is offered first, with the tiers after it', () => {
    assert.deepEqual(options(D.desktopGpu8, 'available'), ['builtin', 'large', 'small', 'none']);
  });
  test('an unavailable built-in model is not offered', () => {
    assert.deepEqual(options(D.laptopNoGpu8, 'unavailable'), ['small', 'none']);
  });
  test('a slow connection still offers the large tier on a GPU device', () => {
    assert.deepEqual(options(D.slow2g, 'none'), ['large', 'small', 'none']);
  });
  test('with little free space the small tier is recommended first', () => {
    assert.deepEqual(options(D.lowStor900, 'none'), ['small', 'large', 'none']);
  });
  test('none is always last, for every profile and built-in status', () => {
    for (const profile of Object.keys(D)) {
      for (const status of ['none', 'available', 'downloadable']) {
        assert.equal(options(D[profile], status).at(-1), 'none', `${profile}/${status}`);
      }
    }
  });
});

describe('plan', () => {
  test('large on a GPU device uses webgpu and q4f16', () => {
    assert.deepEqual(plan('large', D.desktopGpu8), { key: 'large', modelId: TIERS.large.modelId, device: 'webgpu', dtype: 'q4f16' });
  });
  test('large without a GPU has no plan', () => {
    assert.equal(plan('large', D.laptopNoGpu8), null);
  });
  test('small on a GPU device uses webgpu and q4f16', () => {
    assert.deepEqual(plan('small', D.desktopGpu8), { key: 'small', modelId: TIERS.small.modelId, device: 'webgpu', dtype: 'q4f16' });
  });
  test('small without a GPU uses wasm and q4', () => {
    assert.deepEqual(plan('small', D.phone4NoGpu), { key: 'small', modelId: TIERS.small.modelId, device: 'wasm', dtype: 'q4' });
  });
  test('an unknown tier has no plan', () => {
    assert.equal(plan('huge', D.desktopGpu8), null);
  });
});

describe('formatBytes', () => {
  test('null and non-numbers give null', () => {
    assert.equal(formatBytes(null), null);
    assert.equal(formatBytes(NaN), null);
  });
  test('megabytes round to the nearest ten', () => {
    assert.equal(formatBytes(270e6), 'about 270 MB');
    assert.equal(formatBytes(265e6), 'about 270 MB');
  });
  test('gigabytes get one decimal place', () => {
    assert.equal(formatBytes(2.9e9), 'about 2.9 GB');
    assert.equal(formatBytes(1234.5e6), 'about 1.2 GB');
  });
  test('a value just under a gigabyte is shown in GB, not "1000 MB"', () => {
    assert.equal(formatBytes(999.6e6), 'about 1.0 GB');
  });
});

// ---------------------------------------------------------------------------
// Saved choice
// ---------------------------------------------------------------------------

describe('saved choice', () => {
  test('unset reads as null', () => {
    assert.equal(getChoice(), null);
  });
  test('an invalid choice is refused and not stored', () => {
    assert.equal(setChoice('gpt'), false);
    assert.equal(getChoice(), null);
  });
  test('a manual choice is stored and is not marked automatic', () => {
    assert.equal(setChoice('small'), true);
    assert.equal(getChoice(), 'small');
    assert.equal(wasAutomatic(), false);
  });
  test('an automatic choice is stored and marked automatic', () => {
    setChoice('builtin', { auto: true });
    assert.equal(getChoice(), 'builtin');
    assert.equal(wasAutomatic(), true);
  });
  test('"none" can be chosen manually', () => {
    setChoice('none');
    assert.equal(getChoice(), 'none');
    assert.equal(wasAutomatic(), false);
  });
  test('a stored timestamp is kept with the choice', () => {
    setChoice('large');
    assert.equal(typeof JSON.parse(store.get('dd-mind')).at, 'number');
  });
  test('garbage in storage reads as no choice', () => {
    store.set('dd-mind', '{not json');
    assert.equal(getChoice(), null);
    assert.equal(wasAutomatic(), false);
  });
  test('an unknown stored choice reads as no choice', () => {
    store.set('dd-mind', JSON.stringify({ choice: 'huge' }));
    assert.equal(getChoice(), null);
  });
  test('blocked storage: reads are null and writes report false, without throwing', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      get() { throw new Error('blocked'); },
      configurable: true,
    });
    assert.equal(getChoice(), null);
    assert.equal(wasAutomatic(), false);
    assert.equal(setChoice('small'), false);
    setStorage(fakeLocalStorage);
  });
});

// ---------------------------------------------------------------------------
// assessDevice
// ---------------------------------------------------------------------------

describe('assessDevice', () => {
  test('reads every signal the browser exposes', async () => {
    setNavigator({
      gpu: { requestAdapter: async () => ({}) },
      deviceMemory: 8,
      connection: { saveData: true, effectiveType: '2g' },
      storage: { estimate: async () => ({ quota: 100, usage: 30 }) },
    });
    assert.deepEqual(await assessDevice(), {
      webgpu: true, memoryGB: 8, saveData: true, slowNetwork: true, storageFreeBytes: 70,
    });
  });
  test('an empty navigator gives the conservative defaults', async () => {
    setNavigator({});
    assert.deepEqual(await assessDevice(), {
      webgpu: false, memoryGB: null, saveData: false, slowNetwork: false, storageFreeBytes: null,
    });
  });
  test('a null adapter means no WebGPU', async () => {
    setNavigator({ gpu: { requestAdapter: async () => null } });
    assert.equal((await assessDevice()).webgpu, false);
  });
  test('a failing adapter and a failing storage estimate are each isolated', async () => {
    setNavigator({
      gpu: { requestAdapter: async () => { throw new Error('x'); } },
      storage: { estimate: async () => { throw new Error('y'); } },
      deviceMemory: 4,
    });
    const d = await assessDevice();
    assert.equal(d.webgpu, false);
    assert.equal(d.storageFreeBytes, null);
    assert.equal(d.memoryGB, 4);
  });
  test('a throwing connection getter is treated as unknown', async () => {
    setNavigator({});
    Object.defineProperty(nav, 'connection', { get() { throw new Error('no'); } });
    const d = await assessDevice();
    assert.equal(d.saveData, false);
    assert.equal(d.slowNetwork, false);
  });
  test('a 4g connection is not slow', async () => {
    setNavigator({ connection: { effectiveType: '4g' } });
    assert.equal((await assessDevice()).slowNetwork, false);
  });
});

// ---------------------------------------------------------------------------
// downloadSize
// ---------------------------------------------------------------------------

const TREE = [
  { type: 'directory', path: 'onnx/sub', size: 0 },
  { type: 'file', path: 'onnx/decoder_model_merged_q4f16.onnx', size: 1000 },
  { type: 'file', path: 'onnx/decoder_model_merged_q4f16.onnx_data', size: 0, lfs: { size: 2000 } },
  { type: 'file', path: 'onnx/decoder_model_merged_q4f16.onnx_data_1', size: 0, lfs: { size: 3000 } },
  { type: 'file', path: 'onnx/embed_tokens_q4f16.onnx', size: 40 },
  { type: 'file', path: 'onnx/model_q4.onnx', size: 500000 },
  { type: 'file', path: 'onnx/model_q4f16.onnx', size: 700000 },
  { type: 'file', path: 'onnx/vision_encoder_q4f16.onnx_data', size: 9 },
];
const GPU_LARGE_EXPECT = 1000 + 2000 + 3000 + 40 + 700000 + 9; // q4f16 files, LFS size preferred
const CPU_SMALL_EXPECT = 500000;                                  // q4 only, never q4f16

describe('downloadSize', () => {
  test('a GPU tier sums its q4f16 files, preferring the LFS size', async () => {
    const urls = [];
    setFetch(async (url) => { urls.push(url); return { ok: true, json: async () => TREE }; });
    assert.equal(await downloadSize('large', D.desktopGpu8), GPU_LARGE_EXPECT);
    assert.equal(urls[0], `https://huggingface.co/api/models/${TIERS.large.modelId}/tree/main/onnx`);
  });

  test('a second request for the same size is served from storage', async () => {
    let calls = 0;
    setFetch(async () => { calls++; return { ok: true, json: async () => TREE }; });
    assert.equal(await downloadSize('large', D.desktopGpu8), GPU_LARGE_EXPECT);
    assert.equal(await downloadSize('large', D.desktopGpu8), GPU_LARGE_EXPECT);
    assert.equal(calls, 1);
    assert.ok(store.has(`dd-size:${TIERS.large.modelId}:q4f16`));
  });

  test('a CPU tier counts q4 files only', async () => {
    setFetch(async () => ({ ok: true, json: async () => TREE }));
    assert.equal(await downloadSize('small', D.phone4NoGpu), CPU_SMALL_EXPECT);
  });

  test('a GPU-only tier on a device without a GPU returns null without fetching', async () => {
    let calls = 0;
    setFetch(async () => { calls++; return { ok: true, json: async () => TREE }; });
    assert.equal(await downloadSize('large', D.laptopNoGpu8), null);
    assert.equal(calls, 0);
  });

  test('no matching files returns null', async () => {
    setFetch(async () => ({ ok: true, json: async () => [{ type: 'file', path: 'onnx/model_fp16.onnx', size: 5 }] }));
    assert.equal(await downloadSize('small', D.desktopGpu8), null);
  });

  test('an HTTP error returns null', async () => {
    setFetch(async () => ({ ok: false, status: 500 }));
    assert.equal(await downloadSize('small', D.phone4NoGpu), null);
  });

  test('a non-array body returns null', async () => {
    setFetch(async () => ({ ok: true, json: async () => ({ error: 'x' }) }));
    assert.equal(await downloadSize('small', D.phone4NoGpu), null);
  });

  test('a network failure returns null', async () => {
    setFetch(async () => { throw new TypeError('Failed to fetch'); });
    assert.equal(await downloadSize('small', D.phone4NoGpu), null);
  });

  test('a request that never answers is aborted after six seconds, returning null', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    setFetch((url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('AbortError')));
    }));
    const pending = downloadSize('small', D.phone4NoGpu);
    t.mock.timers.tick(5999);
    t.mock.timers.tick(1);
    assert.equal(await pending, null);
  });
});
