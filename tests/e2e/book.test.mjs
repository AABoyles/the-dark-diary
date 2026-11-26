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

test('closed cover opens the book to the contents and the endpaper', { timeout: 60000 }, async () => {
  const page = await newPage(browser);
  await page.goto(server.url);

  assert.equal(await page.locator('#cover').isVisible(), true, 'cover is visible');
  assert.equal(await page.locator('#pages').isVisible(), false, 'pages hidden while closed');

  await openBook(page);
  assert.equal(await page.locator('#book').evaluate((el) => el.classList.contains('open')), true);

  // Contents on the right-hand page, endpaper with the bookplate on the left.
  assert.equal(await page.locator('#toc-page .toc-heading').textContent(), 'Contents');
  const toc = await page.locator('#toc-page').boundingBox();
  const left = await page.locator('#left-page').boundingBox();
  assert.ok(toc && left, 'both pages have boxes');
  assert.ok(toc.x > left.x + left.width / 2, 'contents sit on the right of the book');
  assert.ok(left.x + left.width <= toc.x + 1, 'endpaper sits on the left');
  assert.equal(await page.locator('#left-page .bookplate').isVisible(), true, 'bookplate on the endpaper');

  assert.equal(page.errors.length, 0, `page errors: ${page.errors.join('; ')}`);
  await page.context().close();
});

test('with no stored choice the mind slip asks, and offers small and none', { timeout: 60000 }, async () => {
  const page = await newPage(browser);
  await page.goto(server.url);
  await openBook(page);

  await page.waitForSelector('#mind-slip:not([hidden])');
  const choices = await page.locator('#mind-options [data-choice]').evaluateAll((els) => els.map((e) => e.dataset.choice));
  assert.ok(choices.includes('small'), `small offered (got ${choices})`);
  assert.ok(choices.includes('none'), `none offered (got ${choices})`);
  assert.equal(await page.locator('#mind-options .mind-advised').count(), 1, 'exactly one advised option');

  assert.equal(page.errors.length, 0, `page errors: ${page.errors.join('; ')}`);
  await page.context().close();
});

test('choosing none hides the slip, keeps the choice across reloads, and reopens the slip', { timeout: 60000 }, async () => {
  const page = await newPage(browser);
  await page.goto(server.url);
  await openBook(page);

  await page.waitForSelector('#mind-slip:not([hidden])');
  await page.click('#mind-options [data-choice="none"]');
  await page.waitForSelector('#mind-slip', { state: 'hidden' });
  assert.equal(
    await page.locator('#mind-control').textContent(),
    'The diary keeps its old habits · grow a mind',
  );

  // Reload: the saved choice means no slip on the next visit.
  await page.reload();
  await openBook(page);
  await page.waitForSelector('#mind-control:not([hidden])');
  assert.equal(await page.locator('#mind-slip').isHidden(), true, 'no slip after reload');
  assert.equal(
    await page.locator('#mind-control').textContent(),
    'The diary keeps its old habits · grow a mind',
  );

  // The control reopens the slip.
  await page.click('#mind-control');
  await page.waitForSelector('#mind-slip:not([hidden])');
  assert.equal(await page.locator('#mind-slip').isVisible(), true);

  assert.equal(page.errors.length, 0, `page errors: ${page.errors.join('; ')}`);
  await page.context().close();
});
