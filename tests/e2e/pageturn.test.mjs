// Issue #20: page turns between the contents and an entry, and between spreads.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, newPage, openBook, pageTurned, openEntry, backToContents } from './helpers.mjs';

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

// A long entry, so there are several spreads to turn through.
async function seedLongEntry(page) {
  await page.evaluate(async () => {
    const db = await import('./js/db.js');
    const s = await db.createSession();
    s.title = 'Concerning Your Dinner Plans';
    for (let i = 0; i < 8; i++) {
      s.messages.push({ role: 'user', text: 'I keep thinking about the dinner party and who I should invite, and whether anyone will come at all.', ts: Date.now() });
      s.messages.push({ role: 'diary', text: 'Guests are a delicate ingredient. Invite only those who will be missed, and only a little.', ts: Date.now() });
    }
    await db.saveSession(s);
  });
  await page.reload();
  await openBook(page);
}

const overlayFaces = (page) => page.evaluate(() => document.querySelector('.page-turn')?.querySelectorAll('.page-turn-face').length ?? 0);

test('opening an entry turns a leaf over the gutter, then leaves nothing behind', { timeout: 60000 }, async () => {
  const page = await newPage(browser, { mindChoice: 'none' });
  await page.goto(server.url);
  await openBook(page);
  await seedLongEntry(page);

  await page.locator('#toc-list li').first().click();
  await page.waitForSelector('.page-turn', { timeout: 3000 });
  // a static half plus a leaf with a front and a back
  assert.equal(await overlayFaces(page), 3);
  // snapshots live in closed shadow roots: no duplicate ids leak into the document
  assert.equal(await page.locator('#entries').count(), 1);
  assert.equal(await page.locator('#toc-list').count(), 1);
  await pageTurned(page);
  assert.equal(await page.locator('.page-turn').count(), 0);
  assert.equal(await page.getAttribute('#book', 'data-view'), 'session');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('turning back through spreads animates and lands on the right pages', { timeout: 60000 }, async () => {
  const page = await newPage(browser, { mindChoice: 'none' });
  await page.goto(server.url);
  await openBook(page);
  await seedLongEntry(page);
  await openEntry(page);

  const last = await page.textContent('#spread-label');
  await page.click('#prev-spread');
  await page.waitForSelector('.page-turn', { timeout: 3000 });
  await pageTurned(page);
  assert.notEqual(await page.textContent('#spread-label'), last);
  await page.click('#next-spread');
  await pageTurned(page);
  assert.equal(await page.textContent('#spread-label'), last);

  await backToContents(page);
  assert.equal(await page.getAttribute('#book', 'data-view'), 'toc');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('with reduced motion there is no turning leaf at all', { timeout: 60000 }, async () => {
  const page = await newPage(browser, { mindChoice: 'none' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(server.url);
  await openBook(page);
  await seedLongEntry(page);
  await page.evaluate(() => {
    window.__sawTurn = false;
    new MutationObserver(() => { if (document.querySelector('.page-turn')) window.__sawTurn = true; })
      .observe(document.body, { childList: true, subtree: true });
  });
  await page.locator('#toc-list li').first().click();
  await page.waitForSelector('#flow-view', { state: 'visible' });
  await page.click('#prev-spread');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__sawTurn), false);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});
