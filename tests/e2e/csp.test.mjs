// Self-hosting (issue #42): the page's Content-Security-Policy is never violated,
// every request goes to this origin, and the vendored libraries and fonts load.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer, launch, newPage, openBook, newEntry, say, backToContents, openEntry,
} from './helpers.mjs';

const HUB = /^(huggingface\.co|(.+\.)?huggingface\.co|(.+\.)?hf\.co)$/;

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

test('the app runs under its CSP with no violations and no off-origin requests', { timeout: 120000 }, async () => {
  const page = await newPage(browser, { mindChoice: 'none' });

  // Record every securitypolicyviolation the document fires, from the first script onward.
  await page.addInitScript(() => {
    window.__csp = [];
    window.addEventListener('securitypolicyviolation', (e) => {
      window.__csp.push(`${e.violatedDirective} -> ${e.blockedURI || '(inline)'}`);
    }, true);
  });

  const origin = new URL(server.url).origin;
  const offOrigin = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return;
    if (url.origin !== origin) offOrigin.push(req.url());
  });

  await page.goto(server.url);
  await openBook(page);
  await newEntry(page);
  await say(page, 'I could not sleep again last night.');
  await say(page, 'The house creaks, and I keep thinking it is someone at the door.');
  await backToContents(page);
  await openEntry(page, 0);
  await backToContents(page);

  const violations = await page.evaluate(() => window.__csp);
  assert.deepEqual(violations, [], 'no Content-Security-Policy violations');
  // The only off-origin traffic allowed is the model Hub (the embedder's config.json etc.).
  // Those requests are aborted by the test helpers, so the app stays offline here.
  const stray = offOrigin.filter((u) => !HUB.test(new URL(u).hostname));
  assert.deepEqual(stray, [], 'off-origin requests go only to the model Hub');
  assert.deepEqual(offOrigin.filter((u) => /jsdelivr|googleapis|gstatic/.test(u)), [], 'no CDN or font-host requests');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('compromise loads from vendor/ and the book faces load from vendor/fonts/', { timeout: 60000 }, async () => {
  const page = await newPage(browser, { mindChoice: 'none' });
  const compromiseRequests = [];
  page.on('request', (req) => {
    if (req.url().includes('compromise')) compromiseRequests.push(req.url());
  });

  await page.goto(server.url);
  const nlpReady = await page.evaluate(async () => {
    const nlp = await import('./js/nlp.js');
    return nlp.loadNlp();
  });
  assert.equal(nlpReady, true, 'loadNlp() resolves true');
  assert.ok(compromiseRequests.some((u) => u.startsWith(`${server.url}vendor/compromise/`)),
    `compromise is fetched from vendor/ (saw ${compromiseRequests.join(', ') || 'nothing'})`);

  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    await document.fonts.load('16px "IM Fell English"');
    await document.fonts.load('italic 16px "IM Fell English"');
    await document.fonts.load('16px "Homemade Apple"');
    await document.fonts.load('16px "Pinyon Script"');
    await document.fonts.load('600 16px "Cormorant Garamond"');
    return {
      imFell: document.fonts.check('16px "IM Fell English"'),
      homemade: document.fonts.check('16px "Homemade Apple"'),
      pinyon: document.fonts.check('16px "Pinyon Script"'),
      cormorant: document.fonts.check('600 16px "Cormorant Garamond"'),
      loadedFromFile: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family),
    };
  });
  assert.equal(fonts.imFell, true);
  assert.equal(fonts.homemade, true);
  assert.equal(fonts.pinyon, true);
  assert.equal(fonts.cormorant, true);
  assert.ok(fonts.loadedFromFile.includes('IM Fell English'), 'IM Fell English face loaded');
  await page.context().close();
});
