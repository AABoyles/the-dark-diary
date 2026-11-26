// Service worker routing, precache list and cache hygiene. sw.js is a classic
// script, so it is loaded into a vm sandbox with stub self/caches/fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCOPE = 'https://diary.example/the-dark-diary/';
const PLACEHOLDER = '__BUILD__';
const source = await readFile(ROOT + 'sw.js', 'utf8');

// Loads sw.js. Returns its exports plus the listeners it registered.
function load(text = source) {
  const listeners = {};
  const self = {
    registration: { scope: SCOPE },
    location: new URL(SCOPE),
    addEventListener(type, fn) { listeners[type] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const sandbox = { self, URL, console, caches: undefined, fetch: undefined, Request: undefined, Response: undefined, navigator: {} };
  vm.createContext(sandbox);
  const api = vm.runInContext(`${text}\n;({ route, cacheable, SHELL, SW_VERSION, VERSION, SHELL_CACHE, VENDOR_CACHE, MODEL_CACHE })`, sandbox);
  return { ...api, sandbox, listeners };
}

const GET = { method: 'GET', mode: 'no-cors', destination: 'script' };
const NAV = { method: 'GET', mode: 'navigate', destination: 'document' };

test('the placeholder appears exactly once, so the deploy sed replaces one line', () => {
  assert.equal(source.split(PLACEHOLDER).length - 1, 1);
});

test('unreplaced build placeholder means dev; a replaced one is the version', () => {
  assert.equal(load().SW_VERSION, 'dev');
  const replaced = load(source.replace(`const VERSION = '${PLACEHOLDER}'`, "const VERSION = 'abc123def456'"));
  assert.equal(replaced.SW_VERSION, 'abc123def456');
  assert.equal(replaced.SHELL_CACHE, 'dark-diary-shell-abc123def456');
  assert.equal(replaced.VENDOR_CACHE, 'dark-diary-vendor-abc123def456');
});

test('shell files, the scope root and navigations route to the shell', () => {
  const { route } = load();
  for (const path of ['index.html', 'js/app.js', 'js/workers/llm-worker.js', 'css/style.css', 'manifest.webmanifest', 'icons/icon-192.png']) {
    assert.equal(route(SCOPE + path, GET, SCOPE), 'shell', path);
  }
  assert.equal(route(SCOPE, NAV, SCOPE), 'shell', 'scope root');
  assert.equal(route(SCOPE + '?entry=2', NAV, SCOPE), 'shell', 'query on the root');
  assert.equal(route(SCOPE + 'some/unknown/page', NAV, SCOPE), 'shell', 'navigation to an unknown path');
  assert.equal(route(SCOPE + 'vendor/compromise/compromise-three.mjs', GET, SCOPE), 'shell', 'precached vendor file');
});

test('large vendor files route to the vendor cache', () => {
  const { route } = load();
  assert.equal(route(SCOPE + 'vendor/onnxruntime/ort-wasm-simd-threaded.jsep.wasm', GET, SCOPE), 'vendor');
  assert.equal(route(SCOPE + 'vendor/transformers/transformers.min.js', GET, SCOPE), 'vendor');
  assert.equal(route(SCOPE + 'vendor/transformers/ort-wasm-simd-threaded.jsep.mjs', GET, SCOPE), 'vendor');
});

test('model hosts route to the model cache; other hosts go to the network', () => {
  const { route } = load();
  for (const host of [
    'https://huggingface.co/onnx-community/gemma-3-270m-it-ONNX/resolve/main/onnx/model.onnx',
    'https://cdn-lfs.huggingface.co/x/y',
    'https://cdn-lfs-us-1.hf.co/repos/a/b',
    'https://cas-bridge.xethub.hf.co/xet-bridge-us/abc',
    'https://some.huggingface.co/x',
    'https://other.hf.co/x',
  ]) {
    assert.equal(route(host, GET, SCOPE), 'model', host);
  }
  for (const url of [
    'https://cdn.jsdelivr.net/npm/compromise@14.20.0/+esm',
    'https://fonts.googleapis.com/css2?family=Pinyon+Script',
    'https://fonts.gstatic.com/s/pinyonscript/v1.woff2',
    'https://evil.example/app.js',
    'https://huggingface.co.evil.example/x',
  ]) {
    assert.equal(route(url, GET, SCOPE), 'network', url);
  }
});

test('non-GET requests always go to the network', () => {
  const { route } = load();
  const POST = { method: 'POST', mode: 'cors' };
  assert.equal(route(SCOPE + 'js/app.js', POST, SCOPE), 'network');
  assert.equal(route(SCOPE, { method: 'POST', mode: 'navigate' }, SCOPE), 'network');
  assert.equal(route(SCOPE + 'vendor/transformers/transformers.min.js', POST, SCOPE), 'network');
  assert.equal(route('https://huggingface.co/x/resolve/main/model.onnx', { method: 'POST', mode: 'cors' }, SCOPE), 'network');
});

test('same-origin files outside the shell and outside the scope are not cached', () => {
  const { route } = load();
  assert.equal(route(SCOPE + 'eval/corpus.mjs', GET, SCOPE), 'network');
  assert.equal(route(SCOPE + 'data/unknown.json', GET, SCOPE), 'network');
  assert.equal(route('https://diary.example/other-app/js/app.js', GET, SCOPE), 'network');
});

test('only complete same-origin or CORS 200 responses are cacheable', () => {
  const { cacheable } = load();
  assert.equal(cacheable({ status: 200, type: 'basic' }), true);
  assert.equal(cacheable({ status: 200, type: 'cors' }), true);
  assert.equal(cacheable({ status: 0, type: 'opaque' }), false);
  assert.equal(cacheable({ status: 200, type: 'opaqueredirect' }), false);
  assert.equal(cacheable({ status: 206, type: 'basic' }), false);
  assert.equal(cacheable({ status: 404, type: 'basic' }), false);
  assert.equal(cacheable(undefined), false);
});

test('SHELL covers every js/, js/workers/ and css/ file, and has no duplicates', async () => {
  const { SHELL } = load();
  const list = async (dir) => (await readdir(ROOT + dir, { withFileTypes: true }))
    .filter((e) => e.isFile()).map((e) => `${dir}${e.name}`);
  const required = [
    ...(await list('js/')).filter((f) => f.endsWith('.js')),
    ...(await list('js/workers/')).filter((f) => f.endsWith('.js')),
    ...(await list('css/')).filter((f) => f.endsWith('.css')),
  ];
  assert.ok(required.length > 30, 'fs scan found the app files');
  const missing = required.filter((f) => !SHELL.includes(f));
  assert.deepEqual(missing, [], 'files missing from SHELL in sw.js');
  assert.equal(new Set(SHELL).size, SHELL.length, 'no duplicate SHELL entries');
});

test('every SHELL entry exists on disk, except generated vendor files', async () => {
  const { SHELL } = load();
  const { access } = await import('node:fs/promises');
  const absent = [];
  for (const path of SHELL) {
    if (path.startsWith('vendor/') || path === 'css/fonts.css') continue; // written by npm ci (scripts/vendor.mjs)
    try { await access(ROOT + path); } catch { absent.push(path); }
  }
  assert.deepEqual(absent, []);
});

// A Map-backed stand-in for the Cache API, enough for install and activate.
function fakeCaches(initial = {}) {
  const stores = new Map(Object.entries(initial).map(([name, urls]) => [name, new Map(urls.map((u) => [u, { status: 200, type: 'basic' }]))]));
  const api = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async put(req, res) { store.set(req.url, res); },
        async match(req) { return store.get(typeof req === 'string' ? req : req.url); },
        async keys() { return [...store.keys()].map((url) => ({ url })); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  return { api, stores };
}

class FakeRequest {
  constructor(url, init = {}) { this.url = url; this.method = 'GET'; this.cache = init.cache; }
}

// Runs install (or activate) against fake caches and a fake network that answers 200 except for `missing`.
async function runInstall(text, { missing = [], initial = {} } = {}) {
  const { api, stores } = fakeCaches(initial);
  const { listeners, sandbox } = load(text);
  const fetched = [];
  sandbox.caches = api;
  sandbox.Request = FakeRequest;
  sandbox.fetch = async (req) => {
    fetched.push(req);
    const path = req.url.slice(SCOPE.length);
    return missing.includes(path) ? { status: 404, type: 'basic' } : { status: 200, type: 'basic' };
  };
  const pending = [];
  const event = { waitUntil: (p) => pending.push(p) };
  listeners.install(event);
  await Promise.all(pending);
  return { stores, fetched };
}

test('install precaches the shell with cache:reload into the versioned cache', async () => {
  const text = source.replace(`const VERSION = '${PLACEHOLDER}'`, "const VERSION = 'v123'");
  const { stores, fetched } = await runInstall(text);
  const shell = stores.get('dark-diary-shell-v123');
  assert.ok(shell.has(SCOPE + 'js/app.js'));
  assert.ok(shell.has(SCOPE + 'index.html'));
  assert.ok(fetched.every((r) => r.cache === 'reload'));
});

test('install skips a missing vendor file with a warning, but fails on a missing app file', async () => {
  const text = source.replace(`const VERSION = '${PLACEHOLDER}'`, "const VERSION = 'v123'");
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (msg) => warnings.push(String(msg));
  try {
    const { stores } = await runInstall(text, { missing: ['vendor/compromise/compromise-three.mjs'] });
    assert.ok(!stores.get('dark-diary-shell-v123').has(SCOPE + 'vendor/compromise/compromise-three.mjs'));
    assert.ok(warnings.some((w) => w.includes('compromise-three')), 'warned about the skipped vendor file');
  } finally {
    console.warn = realWarn;
  }
  await assert.rejects(runInstall(text, { missing: ['js/app.js'] }), /404|HTTP 404/);
});

test('activate deletes other shell, vendor and legacy vendor caches, keeping the model cache', async () => {
  const text = source.replace(`const VERSION = '${PLACEHOLDER}'`, "const VERSION = 'v123'");
  const { api, stores } = fakeCaches({
    'dark-diary-shell-v9': ['https://diary.example/the-dark-diary/js/app.js'],
    'dark-diary-shell-v123': ['https://diary.example/the-dark-diary/js/app.js'],
    'dark-diary-vendor': ['https://cdn.jsdelivr.net/npm/x'],
    'dark-diary-vendor-v9': ['https://diary.example/the-dark-diary/vendor/x.wasm'],
    'dark-diary-vendor-v123': [],
    'transformers-cache': ['https://huggingface.co/a/model.onnx'],
  });
  const { listeners, sandbox } = load(text);
  sandbox.caches = api;
  const pending = [];
  listeners.activate({ waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  assert.deepEqual([...stores.keys()].sort(), ['dark-diary-shell-v123', 'dark-diary-vendor-v123', 'transformers-cache']);
});

test('every font css/fonts.css loads is precached, so the book keeps its hands offline', async () => {
  const css = await readFile(ROOT + 'css/fonts.css', 'utf8');
  const fonts = [...css.matchAll(/url\(['"]?\.\.\/(vendor\/fonts\/[^'")]+)['"]?\)/g)].map((m) => m[1]);
  assert.ok(fonts.length > 0, 'fonts.css names its woff2 files');
  const shell = new Set(load().SHELL);
  for (const f of fonts) assert.ok(shell.has(f), `${f} is in SHELL`);
});
