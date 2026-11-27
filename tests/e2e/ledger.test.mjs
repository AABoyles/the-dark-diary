// The ledger of moods (issue #50).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer, launch, newPage, openBook, newEntry, say, backToContents, pageTurned } from './helpers.mjs';
import { menaceIn } from '../../eval/menace.mjs';

const AXE = fileURLToPath(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url));

let server;
let browser;
before(async () => { server = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await server?.close(); });

const DAY = 86400000;

/** Seeds `weeks` weeks of entries, heavier on Sundays; with crisis, one recent hard day. */
async function seed(page, { weeks = 16, crisis = false } = {}) {
  await page.evaluate(async ({ weeks, crisis, DAY }) => {
    const db = await import('./js/db.js');
    const now = Date.now();
    const s = await db.createSession();
    s.title = 'A Long Record of Small Complaints';
    for (let d = weeks * 7; d >= 1; d -= 1) {
      const ts = now - d * DAY;
      const sunday = new Date(ts).getDay() === 0;
      if (!sunday && d % 3) continue;
      const emotion = sunday ? 'grief' : ['delight', 'boredom', 'neutral'][d % 3];
      s.messages.push({ role: 'user', text: `day ${d}`, ts, emotion, mood: sunday ? 0.8 : 0.4 });
      s.messages.push({ role: 'diary', text: 'Noted.', ts });
    }
    if (crisis) s.messages.push({ role: 'user', text: 'a very hard night', ts: now - 2 * DAY, emotion: 'grief', mood: 0.9, crisis: true });
    await db.saveSession(s, { touch: false });
  }, { weeks, crisis, DAY });
  await page.reload();
}

async function openLedger(page) {
  await page.click('#ledger-open');
  await page.waitForSelector('#ledger-view', { state: 'visible' });
  await pageTurned(page);
}

test('the ledger shows remarks, a week-by-week table of marks, and a key', { timeout: 120000 }, async () => {
  const page = await newPage(browser, { mindChoice: 'none' });
  await page.goto(server.url);
  await seed(page);
  await openBook(page);
  await openLedger(page);

  assert.equal(await page.evaluate(() => document.activeElement.id), 'ledger-heading', 'focus on the heading');
  const remarks = await page.locator('.ledger-remark').allTextContents();
  assert.ok(remarks.length >= 2 && remarks.length <= 3, `2-3 remarks (got ${remarks.length})`);
  assert.equal(await page.locator('#ledger-weeks tr').count(), 12, 'twelve weeks to a page');
  assert.ok(await page.locator('#ledger-weeks .ledger-mark').count() > 10);
  assert.ok(await page.locator('#ledger-weeks .mark-grief').count() >= 10, 'Sundays are marked with grief');
  const words = await page.locator('#ledger-weeks td .sr-only').allTextContents();
  assert.ok(words.includes('grief, strongly'), 'each mark is also said in words');
  assert.equal(await page.locator('#ledger-key li').count(), 7);

  // older weeks are a page back; the later page returns
  assert.equal(await page.locator('#ledger-earlier').isDisabled(), false);
  const range = await page.locator('#ledger-range').textContent();
  await page.click('#ledger-earlier');
  await page.waitForFunction((r) => document.querySelector('#ledger-range').textContent !== r, range);
  assert.equal(await page.locator('#ledger-later').isDisabled(), false);

  // axe, on the ledger
  await page.evaluate(readFileSync(AXE, 'utf8'));
  const violations = await page.evaluate(async () => (await window.axe.run({ exclude: ['.page-turn'] }, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`));
  assert.deepEqual(violations, []);

  await page.click('#ledger-back');
  await page.waitForSelector('#toc-page', { state: 'visible' });
  await pageTurned(page);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'ledger-open', 'focus returns to the link');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('after a hard day the ledger only speaks gently', { timeout: 120000 }, async () => {
  const page = await newPage(browser, { mindChoice: 'none' });
  await page.goto(server.url);
  await seed(page, { crisis: true });
  await openBook(page);
  await openLedger(page);
  const remarks = await page.locator('.ledger-remark').allTextContents();
  assert.ok(remarks.length > 0);
  for (const r of remarks) {
    assert.equal(menaceIn(r), null, `no menace: ${r}`);
    assert.ok(!r.includes('?'), `no questions: ${r}`);
  }
  assert.match(remarks.join(' '), /crisis line|emergency/i);
  assert.ok(await page.locator('#ledger-remarks.gentle').count());
  await page.context().close();
});

test('what the writer types is read for feeling, kept with the entry, and the ledger can be hidden', { timeout: 120000 }, async () => {
  const page = await newPage(browser, { mindChoice: 'none' });
  await page.goto(server.url);
  await openBook(page);
  await newEntry(page);
  await say(page, 'I am so happy today, what a wonderful day.');
  const saved = await page.evaluate(async () => {
    const db = await import('./js/db.js');
    const [s] = await db.listSessions();
    return s.messages.find((m) => m.role === 'user');
  });
  assert.equal(saved.emotion, 'delight');
  assert.ok(saved.mood >= 0 && saved.mood <= 1);
  await backToContents(page);

  // an entry written before the ledger is read when the ledger opens
  await page.evaluate(async () => {
    const db = await import('./js/db.js');
    const s = await db.createSession();
    s.messages.push({ role: 'user', text: 'I am furious, absolutely furious with them.', ts: Date.now() - 86400000 });
    await db.saveSession(s);
  });
  await openLedger(page);
  const old = await page.evaluate(async () => {
    const db = await import('./js/db.js');
    const all = await db.listSessions();
    return all.flatMap((s) => s.messages).find((m) => /furious/.test(m.text));
  });
  assert.equal(old.emotion, 'anger');
  await page.click('#ledger-back');
  await page.waitForSelector('#toc-page', { state: 'visible' });
  await pageTurned(page);

  await page.click('#ledger-toggle');
  assert.equal(await page.locator('#ledger-open').isVisible(), false, 'the link goes');
  await page.reload();
  await openBook(page);
  assert.equal(await page.locator('#ledger-open').isVisible(), false, 'and stays gone');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('a clasped ledger keeps its marks sealed and clears them on lock', { timeout: 120000 }, async () => {
  const page = await newPage(browser, { mindChoice: 'none' });
  await page.goto(server.url);
  await seed(page, { weeks: 3 });
  await openBook(page);
  await page.click('#binding-open');
  await page.fill('#clasp-new', 'ledger lock word');
  await page.fill('#clasp-again', 'ledger lock word');
  await page.check('#clasp-understood');
  await page.click('#clasp-set button[type="submit"]');
  await page.waitForSelector('#clasp-on:not([hidden])', { timeout: 20000 });
  await page.keyboard.press('Escape');
  const raw = await page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('dark-diary');
    req.onsuccess = () => {
      const tx = req.result.transaction('sessions', 'readonly');
      tx.objectStore('sessions').getAll().onsuccess = (e) => resolve(JSON.stringify(e.target.result));
    };
  }));
  assert.ok(!/grief|delight|emotion/.test(raw), 'feelings are sealed with the entry');
  await openLedger(page);
  assert.ok(await page.locator('#ledger-weeks .ledger-mark').count() > 0);
  await page.click('#ledger-back');
  await pageTurned(page);
  await page.click('#close-book');
  await page.waitForSelector('#book.closed.clasped');
  assert.equal(await page.locator('#ledger-weeks tr').count(), 0);
  assert.equal(await page.locator('.ledger-remark').count(), 0);
  await page.context().close();
});
