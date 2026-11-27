// The service worker in a real browser: it controls the page, serves the shell
// from its cache on the second load, keeps one shell cache, and stores only
// complete responses. This context allows service workers (helpers.newPage blocks them).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch } from './helpers.mjs';

// Same offline rule as helpers.mjs: CDN, Hugging Face and Google Fonts requests are aborted.
const BLOCKED_HOST = /^(cdn\.jsdelivr\.net|huggingface\.co|(.+\.)?hf\.co|fonts\.googleapis\.com|fonts\.gstatic\.com)$/;

let server;
let browser;

before(async () => {
  server = await startServer();
  browser = await launch();
});

after(async () => {
  await browser?.close();
  await server?.close();
});

async function swContext() {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    serviceWorkers: 'allow',
  });
  await context.route((url) => BLOCKED_HOST.test(url.hostname), (route) => route.abort());
  return context;
}

test('the service worker controls the page and serves the shell from its cache on the second load', { timeout: 90000 }, async () => {
  const context = await swContext();
  try {
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // First load: the worker installs, precaches the shell and claims the page.
    await page.goto(server.url);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20000 });

    const shellCaches = async () => (await page.evaluate(() => caches.keys()))
      .filter((name) => name.startsWith('dark-diary-shell-'));
    assert.equal((await shellCaches()).length, 1, 'exactly one shell cache after the first load');

    // Second load: the document and app.js both come from the worker.
    const appResponse = page.waitForResponse((r) => /\/js\/app\.js$/.test(new URL(r.url()).pathname));
    const documentResponse = await page.goto(server.url);
    const appJs = await appResponse;

    assert.equal(documentResponse.fromServiceWorker(), true, 'index.html served by the service worker');
    assert.equal(appJs.fromServiceWorker(), true, 'js/app.js served by the service worker');
    assert.equal((await shellCaches()).length, 1, 'still exactly one shell cache after the second load');

    await page.waitForSelector('#cover', { state: 'attached' });
    assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('; ')}`);
  } finally {
    await context.close();
  }
});

test('the caches hold only complete 200 responses of basic or cors type', { timeout: 90000 }, async () => {
  const context = await swContext();
  try {
    const page = await context.newPage();
    await page.goto(server.url);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20000 });
    await page.goto(server.url);

    const audit = await page.evaluate(async () => {
      const bad = [];
      const urls = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          urls.push(request.url);
          const response = await cache.match(request);
          if (!response || response.status !== 200 || !['basic', 'cors'].includes(response.type)) {
            bad.push(`${name} ${request.url} status=${response?.status} type=${response?.type}`);
          }
        }
      }
      return { bad, urls };
    });

    assert.deepEqual(audit.bad, [], 'no opaque or non-200 responses cached');
    assert.ok(audit.urls.some((u) => /\/index\.html$|\/$/.test(new URL(u).pathname)), 'index.html is cached');
    assert.ok(audit.urls.some((u) => /\/js\/app\.js$/.test(new URL(u).pathname)), 'js/app.js is cached');
  } finally {
    await context.close();
  }
});
