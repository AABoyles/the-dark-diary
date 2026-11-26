import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, newPage, openBook, newEntry, say, backToContents } from './helpers.mjs';

const UNTITLED = 'An Entry Not Yet Mocked';
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

test('a conversation gets a reply, a title, a contents line, and can be burned', { timeout: 120000 }, async () => {
  const page = await newPage(browser, { mindChoice: 'none' });
  await page.goto(server.url);
  await openBook(page);
  await newEntry(page);

  assert.equal(await page.locator('#session-title').textContent(), UNTITLED);

  const reply = await say(page, 'Hello');
  assert.ok(reply.trim().length > 0, 'the diary replies with text');

  // The diary titles the entry after the first exchange.
  await page.waitForFunction((t) => document.querySelector('#session-title').textContent !== t, UNTITLED);
  const title = await page.locator('#session-title').textContent();
  assert.notEqual(title, UNTITLED);

  // User text is solid, not faded.
  assert.equal(await page.locator('.entry.user .ink').first().evaluate((el) => getComputedStyle(el).opacity), '1');

  // The diary's reply is left-aligned with the user's text.
  const userX = (await page.locator('.entry.user .ink').first().boundingBox()).x;
  const diaryX = (await page.locator('.entry.diary .ink').first().boundingBox()).x;
  assert.ok(Math.abs(userX - diaryX) <= 4, `reply left edge ${diaryX} vs user ${userX}`);

  // The contents list shows the title with a date.
  await backToContents(page);
  const row = page.locator('#toc-list li.active');
  assert.equal(await row.locator('.toc-title').textContent(), title);
  assert.ok((await row.locator('.toc-date').textContent()).trim().length > 0, 'the entry has a date');

  // Burning the entry (after confirming) removes it from the contents.
  await row.click();
  await page.waitForSelector('#flow-view', { state: 'visible' });
  page.once('dialog', (d) => d.accept());
  await page.click('#delete-session');
  await page.waitForSelector('#flow-view', { state: 'hidden' });
  assert.equal(await page.locator('#toc-list li').count(), 0, 'burned entry is gone from the contents');
  assert.equal(await page.locator('#toc-list').getByText(title).count(), 0);

  assert.equal(page.errors.length, 0, `page errors: ${page.errors.join('; ')}`);
  await page.context().close();
});
