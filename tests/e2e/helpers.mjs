// Shared helpers for the browser end-to-end tests.
//
// The app is static and build-free, so the tests serve the repo root with a
// tiny node:http server and drive it with Playwright's Chromium. Every page is
// kept offline (CDN, Hugging Face and Google Fonts requests are aborted), so the
// diary always falls back to its scripted ELIZA engine and the tests are deterministic.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

// Hosts the app would fetch models, fonts or libraries from. Aborting them keeps tests offline.
const BLOCKED_HOST = /^(cdn\.jsdelivr\.net|huggingface\.co|(.+\.)?hf\.co|fonts\.googleapis\.com|fonts\.gstatic\.com)$/;

/** Serves the repo root on an ephemeral port. Resolves to { url, close() }. */
export function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      let rel = decodeURIComponent(pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const file = resolve(ROOT, '.' + rel);
      if (file !== ROOT && !file.startsWith(ROOT + sep)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      ok({
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise((done) => {
          server.closeAllConnections?.();
          server.close(() => done());
        }),
      });
    });
  });
}

/** Launches Chromium. Locally it resolves through NODE_PATH; in CI through node_modules. */
export async function launch() {
  const { chromium } = require('playwright');
  return chromium.launch();
}

/**
 * A fresh context and page. Options:
 *   viewport    { width, height }, default 1280x800
 *   saveData    true makes navigator.connection report data saver (issue #6)
 *   mindChoice  pre-seeds the saved choice in localStorage 'dd-mind' (only if none is stored yet)
 * Page errors are collected in page.errors (an array of messages).
 */
export async function newPage(browser, { viewport, saveData = false, mindChoice = null } = {}) {
  const context = await browser.newContext({
    viewport: viewport ?? { width: 1280, height: 800 },
    serviceWorkers: 'block',
  });
  await context.route((url) => BLOCKED_HOST.test(url.hostname), (route) => route.abort());

  if (saveData) {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'connection', {
        configurable: true,
        get: () => ({ saveData: true, effectiveType: '4g' }),
      });
    });
  }
  if (mindChoice) {
    await context.addInitScript((choice) => {
      try {
        if (!localStorage.getItem('dd-mind')) {
          localStorage.setItem('dd-mind', JSON.stringify({ choice, at: Date.now(), auto: false }));
        }
      } catch { /* storage blocked: nothing to seed */ }
    }, mindChoice);
  }

  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (err) => page.errors.push(err.message));
  return page;
}

/** Waits for CSS transitions and animations that are running to finish (best effort). */
export async function settle(page, timeout = 3000) {
  await page.waitForFunction(
    () => document.getAnimations().every((a) => a.playState !== 'running'),
    null,
    { timeout },
  ).catch(() => {});
}

/** Opens the closed book by clicking the cover, and waits until the contents page shows. */
export async function openBook(page) {
  await page.click('#cover');
  await page.waitForSelector('#book.open');
  await page.waitForSelector('#toc-page', { state: 'visible' });
  await settle(page);
}

/** Starts a new entry from the contents page and waits for the writing area. */
export async function newEntry(page) {
  await page.click('#new-session');
  await page.waitForSelector('#flow-view', { state: 'visible' });
  await page.waitForSelector('#entry-input:not([disabled])');
}

/**
 * Writes one line and waits for the diary to answer. Returns the reply text.
 * With settle (default), also waits for the reply's ink to finish writing itself.
 */
export async function say(page, text, { settle: wait = true } = {}) {
  const before = await page.locator('#entries .entry.diary').count();
  await page.fill('#entry-input', text);
  await page.press('#entry-input', 'Enter');
  await page.waitForFunction(
    (n) => document.querySelectorAll('#entries .entry.diary').length > n,
    before,
    { timeout: 30000 },
  );
  await page.waitForFunction(() => !document.querySelector('#entry-input').disabled, null, { timeout: 30000 });
  if (wait) {
    await page.waitForFunction(() => {
      const inks = document.querySelectorAll('#entries .entry.diary .ink');
      return inks.length > 0 && inks[inks.length - 1].classList.contains('done');
    }, null, { timeout: 30000 });
  }
  // textContent is the full reply whether or not the ink has finished writing.
  return page.locator('#entries .entry.diary .ink').last().textContent();
}

/** Returns from an entry to the contents page. */
export async function backToContents(page) {
  await page.click('#back-to-toc');
  await page.waitForSelector('#flow-view', { state: 'hidden' });
  await page.waitForSelector('#toc-page', { state: 'visible' });
}
