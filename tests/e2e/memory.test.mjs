import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, newPage, openBook, newEntry, say, backToContents } from './helpers.mjs';

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

// The memories table in IndexedDB, read through the app's own module.
const listMemories = (page) => page.evaluate(async () => {
  const db = await import('./js/db.js');
  return db.listMemories();
});

test('the diary remembers a sister across entries, and burning an entry forgets what it learned there', { timeout: 150000 }, async () => {
  const page = await newPage(browser, { mindChoice: 'none' });
  await page.goto(server.url);
  await openBook(page);

  // Entry 1: the sister is mentioned for the first time.
  await newEntry(page);
  const firstId = await page.locator('#toc-list li.active').getAttribute('data-id');
  await say(page, 'My sister keeps lying to me about everything');
  await backToContents(page);

  // Entry 2: the diary brings her up again.
  await newEntry(page);
  const reply = await say(page, 'My sister called me again today');
  assert.match(reply, /sister/i, `the second reply mentions the sister (got "${reply}")`);

  // Each entry contributed its own sister memory.
  await page.waitForFunction(async () => {
    const db = await import('./js/db.js');
    const all = await db.listMemories();
    return all.filter((m) => m.topic === 'sister').length >= 2;
  }, null, { timeout: 15000 });
  const sisters = (await listMemories(page)).filter((m) => m.topic === 'sister');
  assert.ok(sisters.length >= 2, `at least two sister memories (got ${sisters.length})`);
  assert.ok(sisters.some((m) => m.sessionId === firstId), 'one memory belongs to entry 1');

  // Burning entry 1 removes its memories and keeps entry 2's.
  await backToContents(page);
  await page.click(`#toc-list li[data-id="${firstId}"]`);
  await page.waitForSelector('#flow-view', { state: 'visible' });
  page.once('dialog', (d) => d.accept());
  await page.click('#delete-session');
  await page.waitForSelector('#flow-view', { state: 'hidden' });

  const after1 = await listMemories(page);
  assert.equal(after1.filter((m) => m.sessionId === firstId).length, 0, 'entry 1 memories are gone');
  assert.ok(after1.filter((m) => m.topic === 'sister').length >= 1, 'entry 2 memories remain');

  assert.equal(page.errors.length, 0, `page errors: ${page.errors.join('; ')}`);
  await page.context().close();
});
