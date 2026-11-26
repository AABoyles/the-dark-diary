import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, newPage, openBook, newEntry, say } from './helpers.mjs';

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

// Long enough to fill a page or two per exchange.
const LONG = [
  'I have been thinking about the long winter, the way the light leaves the kitchen by four o\'clock,',
  'and how every small errand becomes a small grievance when nobody is there to hear it complained about.',
  'My neighbour waves at me each morning as though we were friends, and I wave back out of pure habit.',
];

test('an entry starts on a right-hand page and turns page by page', { timeout: 150000 }, async () => {
  const page = await newPage(browser, { mindChoice: 'none', viewport: { width: 1280, height: 800 } });
  await page.goto(server.url);
  await openBook(page);
  await newEntry(page);

  assert.equal(await page.locator('#leaf-spacer').isVisible(), true, 'blank spacer column exists');
  const book = await page.locator('#book').boundingBox();
  const header = await page.locator('#session-header').boundingBox();
  assert.ok(header.x > book.x + book.width / 2, `entry header (x=${header.x}) starts on the right page`);

  // Enough long exchanges to run past the first spread.
  for (let i = 0; i < 8; i++) {
    await say(page, `${LONG[i % LONG.length]} Entry number ${i + 1}, and still no one has answered.`, { settle: false });
  }
  await page.waitForFunction(() => document.querySelector('#prev-spread') && !document.querySelector('#prev-spread').disabled, null, { timeout: 15000 });

  const label = await page.locator('#spread-label').textContent();
  assert.ok(parseInt(label, 10) > 1, `after many pages the label shows a later page (got "${label}")`);
  assert.equal(await page.locator('#prev-spread').isDisabled(), false, 'can turn back');

  await page.click('#prev-spread');
  await page.waitForFunction((old) => document.querySelector('#spread-label').textContent !== old, label);
  assert.notEqual(await page.locator('#spread-label').textContent(), label, 'turning the page changes the label');

  assert.equal(page.errors.length, 0, `page errors: ${page.errors.join('; ')}`);
  await page.context().close();
});

test('on a phone-width screen there is one page and no endpaper', { timeout: 60000 }, async () => {
  const page = await newPage(browser, { mindChoice: 'none', viewport: { width: 420, height: 800 } });
  await page.goto(server.url);
  await openBook(page);
  await newEntry(page);

  assert.equal(await page.locator('#left-page').isVisible(), false, 'no endpaper on a phone');
  assert.equal(await page.locator('#leaf-spacer').isVisible(), false, 'no spacer column on a phone');

  assert.equal(page.errors.length, 0, `page errors: ${page.errors.join('; ')}`);
  await page.context().close();
});
