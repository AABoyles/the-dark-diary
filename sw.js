// The Dark Diary service worker (classic script).
//
// Every deploy replaces the build placeholder below with the commit SHA
// (.github/workflows/pages.yml), so each deploy is a new worker with a new
// shell cache. A page's shell files all come from one generation's cache, so a
// load never mixes an old app.js with a new ai.js. Locally (placeholder not
// replaced) the version is 'dev' and shell files come from the network first.
//
// Caches:
//   dark-diary-shell-<version>   app shell, precached with cache:'reload'
//   dark-diary-vendor-<version>  large same-origin vendor files, cache-first at runtime
//   transformers-cache           model weights, shared with transformers.js

const VERSION = '__BUILD__';
const BUILD_PLACEHOLDER = '__' + 'BUILD__';
const SW_VERSION = VERSION === BUILD_PLACEHOLDER ? 'dev' : VERSION;

const SHELL_PREFIX = 'dark-diary-shell-';
const VENDOR_BASE = 'dark-diary-vendor'; // legacy unversioned name included in cleanup
const SHELL_CACHE = `${SHELL_PREFIX}${SW_VERSION}`;
const VENDOR_CACHE = `${VENDOR_BASE}-${SW_VERSION}`;
const MODEL_CACHE = 'transformers-cache';

// Keep in sync with the repo. tests/unit/sw.test.mjs fails if a js/, js/workers/
// or css/ file is missing from this list.
const VENDOR_FONTS = [
  'vendor/fonts/im-fell-english-400.woff2',
  'vendor/fonts/im-fell-english-400-italic.woff2',
  'vendor/fonts/homemade-apple-400.woff2',
  'vendor/fonts/pinyon-script-400.woff2',
  'vendor/fonts/cormorant-garamond-600.woff2',
  'vendor/fonts/cormorant-garamond-600-italic.woff2',
];

const SHELL = [
  'index.html',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'css/style.css',
  'css/hand.css',
  'css/effects.css',
  'css/atmosphere.css',
  'css/fonts.css',
  'css/print.css',
  'js/app.js',
  'js/ai.js',
  'js/prompt.js',
  'js/menace.js',
  'js/db.js',
  'js/fallback.js',
  'js/pwa.js',
  'js/doodle.js',
  'js/print.js',
  'js/eliza.js',
  'js/clean.js',
  'js/ink.js',
  'js/crisis.js',
  'js/strike.js',
  'js/timesense.js',
  'js/familiarity.js',
  'js/overture.js',
  'js/pageturn.js',
  'js/sound.js',
  'js/candle.js',
  'js/eggs.js',
  'js/effects.js',
  'js/engine.js',
  'js/lines.js',
  'js/retrieve.js',
  'js/understand.js',
  'js/emotion.js',
  'js/dialogue.js',
  'js/grammar.js',
  'js/bandit.js',
  'js/mind.js',
  'js/nlp.js',
  'js/embed.js',
  'js/intents.js',
  'js/memory.js',
  'js/ledger.js',
  'js/moods.js',
  'js/ledger-view.js',
  'js/clasp.js',
  'js/backup.js',
  'js/binding.js',
  'js/llm-client.js',
  'js/workers/llm-worker.js',
  'js/workers/embed-worker.js',
  'vendor/compromise/compromise-three.mjs',
  ...VENDOR_FONTS,
];
const SHELL_SET = new Set(SHELL);

// Entries that only exist after `npm ci` (scripts/vendor.mjs) or are written beside them.
// A missing one is skipped with a warning instead of failing the install.
const isOptionalShell = (path) => path.startsWith('vendor/') || path === 'css/fonts.css';

const MODEL_HOSTS = new Set(['huggingface.co', 'cdn-lfs.huggingface.co', 'cdn-lfs-us-1.hf.co', 'cas-bridge.xethub.hf.co']);
const isModelHost = (hostname) =>
  MODEL_HOSTS.has(hostname) || hostname.endsWith('.hf.co') || hostname.endsWith('.huggingface.co');

// Path of a same-origin URL relative to the scope, without query or hash.
// The scope root maps to index.html.
function shellPath(url, scopeHref) {
  let rel = new URL(url).href.slice(scopeHref.length).replace(/[?#].*$/, '');
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  return rel;
}

// Pure routing decision: 'shell' | 'vendor' | 'model' | 'network'.
// Only GET requests are ever cached.
function route(url, request, scopeUrl) {
  if (!request || request.method !== 'GET') return 'network';
  const target = new URL(url);
  const scope = new URL(scopeUrl);

  if (target.origin === scope.origin) {
    if (!target.href.startsWith(scope.href)) return 'network';
    const rel = shellPath(target.href, scope.href);
    if (SHELL_SET.has(rel) || request.mode === 'navigate') return 'shell';
    if (rel.startsWith('vendor/')) return 'vendor';
    return 'network';
  }

  return isModelHost(target.hostname) ? 'model' : 'network';
}

// Only complete, same-origin or CORS 200 responses are stored. Opaque responses
// (no-cors cross-origin), redirects and errors are never cached.
const cacheable = (response) =>
  !!response && response.status === 200 && (response.type === 'basic' || response.type === 'cors');

// Store a copy without making the served response wait on, or fail because of, the cache.
// The clone is taken synchronously, before the browser reads the body.
function keep(event, cache, request, response) {
  if (!cacheable(response)) return;
  const copy = response.clone();
  event.waitUntil(cache.put(request, copy).catch(() => {
    // Quota exceeded or similar: the response is served uncached.
  }));
}

async function serveShell(event, request, scopeHref) {
  const cache = await caches.open(SHELL_CACHE);
  const key = new Request(new URL(shellPath(request.url, scopeHref), scopeHref).href);

  if (SW_VERSION !== 'dev') {
    const hit = await cache.match(key, { ignoreSearch: true });
    if (hit) return hit;
  }

  try {
    const response = await fetch(request);
    keep(event, cache, key, response);
    return response;
  } catch (err) {
    const hit = await cache.match(key, { ignoreSearch: true });
    if (hit) return hit;
    if (request.mode === 'navigate') {
      const fallback = await cache.match(new URL('index.html', scopeHref).href, { ignoreSearch: true });
      if (fallback) return fallback;
    }
    return Response.error();
  }
}

async function serveVendor(event, request) {
  const cache = await caches.open(VENDOR_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  keep(event, cache, request, response);
  return response;
}

// Model weights: cache-first against transformers.js's own cache. Range requests are never cached.
async function serveModel(event, request) {
  if (request.headers.has('Range')) return fetch(request);

  const cache = await caches.open(MODEL_CACHE);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;

  const response = await fetch(request);
  keep(event, cache, request, response);
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const scope = self.registration.scope;
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL.map(async (path) => {
      const request = new Request(new URL(path, scope).href, { cache: 'reload' });
      try {
        const response = await fetch(request);
        if (!cacheable(response)) throw new Error(`HTTP ${response.status}`);
        await cache.put(request, response);
      } catch (err) {
        if (!isOptionalShell(path)) throw err;
        console.warn(`[dark-diary sw] precache skipped ${path}: ${err.message}`);
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const current = new Set([SHELL_CACHE, VENDOR_CACHE]);
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => !current.has(k) && (k.startsWith(SHELL_PREFIX) || k.startsWith(VENDOR_BASE)))
        .map((k) => caches.delete(k)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const scope = self.registration.scope;
  const kind = route(event.request.url, event.request, scope);
  if (kind === 'shell') {
    event.respondWith(serveShell(event, event.request, scope));
  } else if (kind === 'vendor') {
    event.respondWith(serveVendor(event, event.request));
  } else if (kind === 'model') {
    event.respondWith(serveModel(event, event.request));
  }
});

self.addEventListener('message', (event) => {
  const data = event.data || {};

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (data.type === 'CACHE_STATUS') {
    event.waitUntil((async () => {
      let usage = null;
      let quota = null;
      try {
        const estimate = await navigator.storage.estimate();
        usage = estimate.usage ?? null;
        quota = estimate.quota ?? null;
      } catch (err) {
        // Storage estimate unavailable: report nulls.
      }

      const names = await caches.keys();
      const cacheCounts = {};
      for (const name of names) {
        try {
          cacheCounts[name] = (await (await caches.open(name)).keys()).length;
        } catch (err) {
          cacheCounts[name] = null;
        }
      }

      if (event.source && typeof event.source.postMessage === 'function') {
        event.source.postMessage({
          type: 'CACHE_STATUS',
          version: SW_VERSION,
          usage,
          quota,
          caches: cacheCounts,
        });
      }
    })());
  }
});
