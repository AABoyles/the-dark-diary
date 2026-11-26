import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, newPage, openBook } from './helpers.mjs';

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

test('with data saver on, the diary stays on old habits without asking, and says why when asked', { timeout: 60000 }, async () => {
  const page = await newPage(browser, { saveData: true });
  await page.goto(server.url);
  await openBook(page);

  // The control appears once the decision is made; the slip never shows.
  await page.waitForSelector('#mind-control:not([hidden])');
  assert.equal(await page.locator('#mind-slip').isHidden(), true, 'no slip under data saver');

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dd-mind')));
  assert.equal(saved.choice, 'none');
  assert.equal(saved.auto, true, 'the choice was made automatically');
  assert.equal(await page.locator('#mind-control').isVisible(), true);

  // Opening the slip explains the decision.
  await page.click('#mind-control');
  await page.waitForSelector('#mind-slip:not([hidden])');
  const note = await page.locator('#mind-note').textContent();
  assert.match(note, /saving data/i, `data-saver sentence in the note (got "${note}")`);

  assert.equal(page.errors.length, 0, `page errors: ${page.errors.join('; ')}`);
  await page.context().close();
});
