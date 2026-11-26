// The Dark Diary service worker (classic script).
// Caches the app shell, vendor assets (transformers.js, fonts) and model weights.
// Model weights share the 'transformers-cache' store that transformers.js uses,
// so multi-GB files are never stored twice.

const VERSION = 'v3';
const SHELL_CACHE = `dark-diary-shell-${VERSION}`;
const SHELL_PREFIX = 'dark-diary-shell-';
const VENDOR_CACHE = 'dark-diary-vendor';
const MODEL_CACHE = 'transformers-cache';

const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/ai.js',
  'js/db.js',
  'js/fallback.js',
  'js/pwa.js',
  'js/doodle.js',
  'js/eliza.js',
  'js/nlp.js',
  'js/embed.js',
  'js/intents.js',
  'js/memory.js',
  'js/llm-client.js',
  'js/workers/llm-worker.js',
  'js/workers/embed-worker.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

const shellUrl = (p) => new URL(p, self.registration.scope).href;

const VENDOR_HOSTS = new Set(['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com']);
const MODEL_HOSTS = new Set(['huggingface.co', 'cdn-lfs.huggingface.co', 'cdn-lfs-us-1.hf.co', 'cas-bridge.xethub.hf.co']);

const isVendor = (url) => VENDOR_HOSTS.has(url.hostname);
const isModel = (url) =>
  MODEL_HOSTS.has(url.hostname) ||
  url.hostname.endsWith('.hf.co') ||
  url.hostname.endsWith('.huggingface.co');

const inScope = (url) => url.href.startsWith(self.registration.scope);

// Write to a cache without ever letting a storage error break the response.
async function safePut(cache, request, response) {
  try {
    await cache.put(request, response);
  } catch (err) {
    // Quota exceeded or similar: serve the response uncached.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL.map((p) => new Request(shellUrl(p), { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith(SHELL_PREFIX) && k !== SHELL_CACHE)
        .map((k) => caches.delete(k)),
    );
    await self.clients.claim();
  })());
});

// Same-origin shell and navigations: stale-while-revalidate.
async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response.ok && response.status === 200) {
        event.waitUntil(safePut(cache, request, response.clone()));
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(network);
    return cached;
  }

  const fresh = await network;
  if (fresh) return fresh;

  if (request.mode === 'navigate') {
    const fallback = await cache.match(shellUrl('index.html'));
    if (fallback) return fallback;
  }
  return Response.error();
}

// Vendor assets: cache-first. Opaque (no-cors) responses are cached too,
// since font stylesheets and files are fetched that way.
async function vendorCacheFirst(event, request) {
  const cache = await caches.open(VENDOR_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') {
    event.waitUntil(safePut(cache, request, response.clone()));
  }
  return response;
}

// Model weights: cache-first against transformers.js's own cache.
async function modelCacheFirst(event, request) {
  const hasRange = request.headers.has('Range');

  if (hasRange) {
    // Partial requests bypass the cache entirely and are never stored.
    return fetch(request);
  }

  const cache = await caches.open(MODEL_CACHE);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;

  const response = await fetch(request);
  if (response.ok && response.status === 200) {
    event.waitUntil(safePut(cache, request, response.clone()));
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (inScope(url)) event.respondWith(staleWhileRevalidate(event, request));
    return;
  }

  if (isVendor(url)) {
    event.respondWith(vendorCacheFirst(event, request));
  } else if (isModel(url)) {
    event.respondWith(modelCacheFirst(event, request));
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
      const caches_ = {};
      for (const name of names) {
        try {
          caches_[name] = (await (await caches.open(name)).keys()).length;
        } catch (err) {
          caches_[name] = null;
        }
      }

      if (event.source && typeof event.source.postMessage === 'function') {
        event.source.postMessage({
          type: 'CACHE_STATUS',
          version: VERSION,
          usage,
          quota,
          caches: caches_,
        });
      }
    })());
  }
});
