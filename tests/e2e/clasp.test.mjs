// The clasp (issue #12) and backups (issue #11), against real IndexedDB.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, launch, newPage, openBook, newEntry, say, backToContents } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await server?.close(); });

const WORD = 'brass hinges creak';
const SECRET = 'marmalade';

/** Every record in both stores, as text, with sealed bytes decoded so plaintext would show. */
const rawStorage = (page) => page.evaluate(() => new Promise((resolve, reject) => {
  const req = indexedDB.open('dark-diary');
  req.onerror = () => reject(req.error);
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction(['sessions', 'memories'], 'readonly');
    const out = [];
    const dump = (v) => JSON.stringify(v, (k, x) => (x instanceof Uint8Array || x instanceof ArrayBuffer
      ? new TextDecoder('latin1').decode(x) : x));
    for (const name of ['sessions', 'memories']) {
      tx.objectStore(name).getAll().onsuccess = (e) => { out.push(...e.target.result.map(dump)); };
    }
    tx.oncomplete = () => { db.close(); resolve(out.join('\n')); };
  };
}));

async function openBinding(page) {
  await page.click('#binding-open');
  await page.waitForSelector('#binding[open]');
}

async function fasten(page, word = WORD) {
  await openBinding(page);
  await page.fill('#clasp-new', word);
  await page.fill('#clasp-again', word);
  await page.check('#clasp-understood');
  await page.click('#clasp-set button[type="submit"]');
  await page.waitForFunction(() => /fastened/.test(document.querySelector('#clasp-status').textContent), null, { timeout: 20000 });
}

async function unlock(page, word) {
  await page.fill('#clasp-input', word);
  await page.click('#clasp-open');
}

async function writeSecret(page) {
  await openBook(page);
  await newEntry(page);
  await say(page, `My sister hides the ${SECRET} in the pantry.`);
  await backToContents(page);
}

test('fastening the clasp seals what is stored; closing locks; only the word opens it', { timeout: 120000 }, async () => {
  const page = await newPage(browser, { mindChoice: 'none' });
  await page.goto(server.url);
  await writeSecret(page);
  assert.ok((await rawStorage(page)).includes(SECRET), 'readable before the clasp');

  await fasten(page);
  const raw = await rawStorage(page);
  assert.ok(!raw.includes(SECRET) && !raw.includes('sister'), 'nothing readable once clasped');
  await page.click('#binding-close');

  // closing the book locks it and takes every word off the page
  await page.click('#close-book');
  await page.waitForSelector('#book.closed.clasped');
  await page.waitForSelector('#clasp-form', { state: 'visible' });
  assert.equal(await page.locator('#toc-list li').count(), 0, 'the contents are cleared');
  assert.ok(!(await page.content()).includes(SECRET), 'no decrypted text left in the document');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'clasp-input', 'focus goes to the word');

  // touching the cover doesn't open a clasped book
  await page.click('#cover', { position: { x: 30, y: 30 } });
  assert.ok(await page.locator('#book.closed').count());

  // a wrong word is refused, in character
  await unlock(page, 'not the word at all');
  await page.waitForFunction(() => document.querySelector('#clasp-refusal').textContent.length > 0, null, { timeout: 20000 });
  assert.ok(await page.locator('#book.closed').count(), 'still shut');

  await unlock(page, WORD);
  await page.waitForSelector('#book.open', { timeout: 20000 });
  await page.waitForSelector('#toc-list li');
  await page.click('#toc-list .toc-entry');
  await page.waitForSelector('#flow-view', { state: 'visible' });
  assert.ok((await page.locator('#entries').textContent()).includes(SECRET), 'the entry reads again');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('a clasped diary asks for the word after a reload, and removing the clasp stores it readable again', { timeout: 120000 }, async () => {
  const page = await newPage(browser, { mindChoice: 'none' });
  await page.goto(server.url);
  await writeSecret(page);
  await fasten(page);
  await page.reload();
  await page.waitForSelector('#clasp-form', { state: 'visible' });
  assert.equal(await page.locator('#toc-list li').count(), 0, 'nothing listed before the word');

  await unlock(page, WORD);
  await page.waitForSelector('#book.open', { timeout: 20000 });
  await openBinding(page);
  assert.equal(await page.locator('#clasp-on').isVisible(), true);
  await page.fill('#clasp-current', 'wrong word here');
  await page.click('#clasp-remove button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#clasp-status').dataset.tone === 'error', null, { timeout: 20000 });
  await page.fill('#clasp-current', WORD);
  await page.click('#clasp-remove button[type="submit"]');
  await page.waitForFunction(() => /clasp is off/.test(document.querySelector('#clasp-status').textContent), null, { timeout: 20000 });
  assert.ok((await rawStorage(page)).includes(SECRET), 'readable again');

  // without a clasp, closing the book doesn't lock it
  await page.click('#binding-close');
  await page.click('#close-book');
  await page.waitForSelector('#book.closed');
  assert.equal(await page.locator('#clasp-form').isVisible(), false);
  await openBook(page);
  assert.ok(await page.locator('#toc-list li').count() > 0);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('ten idle minutes lock a clasped book', { timeout: 120000 }, async () => {
  const page = await newPage(browser, { mindChoice: 'none' });
  await page.clock.install();
  await page.goto(server.url);
  await writeSecret(page);
  await fasten(page);
  await page.click('#binding-close');
  await page.clock.runFor(9 * 60 * 1000);
  assert.ok(await page.locator('#book.open').count(), 'still open after nine minutes');
  await page.clock.runFor(2 * 60 * 1000);
  await page.waitForSelector('#book.closed.clasped');
  assert.equal(await page.locator('#toc-list li').count(), 0);
  await page.context().close();
});

test('a copy can be taken and restored, adding to or replacing the diary', { timeout: 120000 }, async () => {
  const page = await newPage(browser, { mindChoice: 'none' });
  await page.goto(server.url);
  await writeSecret(page);

  await openBinding(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-backup')]);
  assert.match(download.suggestedFilename(), /^dark-diary-\d{4}-\d{2}-\d{2}\.json$/);
  const file = join(tmpdir(), `dd-backup-${Date.now()}.json`);
  await download.saveAs(file);
  const backup = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(backup.format, 'the-dark-diary');
  assert.ok(JSON.stringify(backup.sessions).includes(SECRET));
  assert.ok(backup.memories.every((m) => !('vec' in m)), 'no embedding vectors');
  await page.click('#binding-close');

  // burn the entry, then bring it back
  page.on('dialog', (d) => d.accept());
  await page.click('#toc-list .toc-entry');
  await page.waitForSelector('#flow-view', { state: 'visible' });
  await page.click('#delete-session');
  await page.waitForFunction(() => document.querySelectorAll('#toc-list li').length === 0);

  await openBinding(page);
  await page.setInputFiles('#import-file', file);
  await page.waitForSelector('#import-choice', { state: 'visible' });
  assert.match(await page.locator('#import-summary').textContent(), /1 entry/);
  await page.click('#import-merge');
  await page.waitForFunction(() => /brought in/.test(document.querySelector('#keep-status').textContent));
  assert.equal(await page.locator('#toc-list li').count(), 1, 'restored');

  // adding the same copy again changes nothing; replacing keeps only the copy
  await page.setInputFiles('#import-file', file);
  await page.click('#import-merge');
  await page.waitForFunction(() => /^0 entries/.test(document.querySelector('#keep-status').textContent));
  await page.click('#binding-close');
  await newEntry(page);
  await say(page, 'Another day.');
  await backToContents(page);
  assert.equal(await page.locator('#toc-list li').count(), 2);
  await openBinding(page);
  await page.setInputFiles('#import-file', file);
  await page.click('#import-replace');
  await page.waitForFunction(() => /replacing/.test(document.querySelector('#keep-status').textContent));
  assert.equal(await page.locator('#toc-list li').count(), 1, 'only the copy remains');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('a copy taken under the clasp is sealed, and opens elsewhere only with the word', { timeout: 150000 }, async () => {
  const page = await newPage(browser, { mindChoice: 'none' });
  await page.goto(server.url);
  await writeSecret(page);
  await fasten(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-backup')]);
  const file = join(tmpdir(), `dd-sealed-${Date.now()}.json`);
  await download.saveAs(file);
  const text = await readFile(file, 'utf8');
  assert.ok(!text.includes(SECRET) && !text.includes('sister'), 'nothing readable in the file');
  assert.ok(JSON.parse(text).locked);
  await page.context().close();

  // a fresh browser profile: no diary, no clasp
  const other = await newPage(browser, { mindChoice: 'none' });
  await other.goto(server.url);
  await openBook(other);
  await openBinding(other);
  await other.setInputFiles('#import-file', file);
  await other.waitForSelector('#import-unlock', { state: 'visible' });
  await other.fill('#import-pass', 'wrong wrong wrong');
  await other.click('#import-unlock button[type="submit"]');
  await other.waitForFunction(() => document.querySelector('#keep-status').dataset.tone === 'error', null, { timeout: 20000 });
  await other.fill('#import-pass', WORD);
  await other.click('#import-unlock button[type="submit"]');
  await other.waitForSelector('#import-choice', { state: 'visible', timeout: 20000 });
  await other.click('#import-merge');
  await other.waitForFunction(() => /brought in/.test(document.querySelector('#keep-status').textContent));
  await other.click('#binding-close');
  await other.click('#toc-list .toc-entry');
  await other.waitForSelector('#flow-view', { state: 'visible' });
  assert.ok((await other.locator('#entries').textContent()).includes(SECRET));
  assert.deepEqual(other.errors, []);
  await other.context().close();
});

test('a hostile backup is read as text, and junk files are refused', { timeout: 60000 }, async () => {
  const page = await newPage(browser, { mindChoice: 'none' });
  await page.goto(server.url);
  await openBook(page);
  const evil = join(tmpdir(), `dd-evil-${Date.now()}.json`);
  await writeFile(evil, JSON.stringify({
    format: 'the-dark-diary', version: 1,
    sessions: [{ id: 'x1', title: '<img src=x onerror="window.__pwned=1">', createdAt: 1, updatedAt: 1,
      messages: [{ role: 'user', text: '<script>window.__pwned=1</script>', ts: 1, doodle: ['url(javascript:1)'] }] }],
    memories: [],
  }));
  await openBinding(page);
  await page.setInputFiles('#import-file', evil);
  await page.click('#import-merge');
  await page.waitForFunction(() => /brought in/.test(document.querySelector('#keep-status').textContent));
  await page.click('#binding-close');
  assert.equal(await page.locator('#toc-list img').count(), 0);
  assert.match(await page.locator('#toc-list').textContent(), /<img src=x/);
  await page.click('#toc-list .toc-entry');
  await page.waitForSelector('#flow-view', { state: 'visible' });
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.equal(await page.locator('#entries script, #entries .doodle').count(), 0);

  const junk = join(tmpdir(), `dd-junk-${Date.now()}.json`);
  await writeFile(junk, '{"hello": "world"}');
  await backToContents(page);
  await openBinding(page);
  await page.setInputFiles('#import-file', junk);
  await page.waitForFunction(() => document.querySelector('#keep-status').dataset.tone === 'error');
  assert.match(await page.locator('#keep-status').textContent(), /not a diary backup/);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});
