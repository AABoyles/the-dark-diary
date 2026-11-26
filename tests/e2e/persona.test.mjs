// Issues #10, #13, #14, #17: crisis replies, strike-throughs, the diary
// speaking first, and revised titles, end to end.
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

const DAY = 86400000;

async function freshBook(opts = {}) {
  const page = await newPage(browser, { mindChoice: 'none', ...opts });
  await page.goto(server.url);
  await openBook(page);
  return page;
}

// Seeds IndexedDB with a past session (as if written `daysAgo` days ago) and reloads.
async function seedOldSession(page, daysAgo) {
  await page.evaluate(async (ts) => {
    const db = await import('./js/db.js');
    const s = await db.createSession();
    s.createdAt = ts;
    s.title = 'An Old and Tedious Matter';
    s.messages = [
      { role: 'user', text: 'I had a long day at the office', ts },
      { role: 'diary', text: 'Offices are where ambition goes to be filed.', ts: ts + 1000 },
    ];
    await db.saveSession(s);
    // saveSession stamps updatedAt; the message timestamps are what count
  }, Date.now() - daysAgo * DAY);
  await page.reload();
  await openBook(page);
}

const lastDiary = (page) => page.locator('#entries .entry.diary .ink').last().textContent();

// ---------- #10 crisis ----------

test('self-harm language gets the kind reply, with no menace and no question', { timeout: 60000 }, async () => {
  const page = await freshBook();
  await newEntry(page);
  const answer = await say(page, 'honestly everyone would be better off without me');
  assert.match(answer, /crisis line|emergency/i);
  assert.ok(!answer.includes('?'), answer);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('a crisis message never reaches the language model', { timeout: 60000 }, async () => {
  const page = await newPage(browser, { mindChoice: 'small' });
  await page.route('**/js/llm-client.js', (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript; charset=utf-8',
    body: `export async function createLlm() {
      globalThis.__llmCalls = [];
      return {
        async generate(chat) { globalThis.__llmCalls.push(chat.at(-1).content); return 'A Title Of No Consequence'; },
        dispose() {},
      };
    }`,
  }));
  await page.goto(server.url);
  await openBook(page);
  await page.waitForFunction(async () => (await import('./js/ai.js')).getBackend() === 'transformers');
  await newEntry(page);
  const crisisText = 'I want to kill myself';
  const answer = await say(page, crisisText);
  assert.match(answer, /crisis line|emergency/i);
  const calls = await page.evaluate(() => globalThis.__llmCalls || []);
  assert.ok(!calls.includes(crisisText), `the model was asked to answer: ${JSON.stringify(calls)}`);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

// ---------- #13 strike-throughs ----------

test('the ink crosses out a word, then writes the gentler one', { timeout: 30000 }, async () => {
  const page = await freshBook();
  const result = await page.evaluate(async () => {
    const { InkWriter } = await import('./js/ink.js');
    const p = document.createElement('p');
    p.className = 'ink';
    document.body.appendChild(p);
    const w = new InkWriter(p, { charDelay: 5 });
    w.append('I would ~~dev');      // streamed in pieces, split inside the markup
    w.append('our~~ enjoy');
    await w.finish('I would ~~devour~~ enjoy hearing more.');
    const s = p.querySelector('s.struck');
    return { text: p.textContent, struck: s?.textContent, lined: s?.classList.contains('lined') };
  });
  assert.deepEqual(result, { text: 'I would devour enjoy hearing more.', struck: 'devour', lined: true });
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('a saved strike-through is redrawn when the entry is reopened', { timeout: 30000 }, async () => {
  const page = await freshBook();
  await page.evaluate(async () => {
    const db = await import('./js/db.js');
    const s = await db.createSession();
    s.title = 'Concerning Your Dinner Plans';
    s.messages = [
      { role: 'user', text: 'I am cooking for friends', ts: Date.now() },
      { role: 'diary', text: 'How lovely. I would ~~devour~~ enjoy the details.', ts: Date.now() },
    ];
    await db.saveSession(s);
  });
  await page.reload();
  await openBook(page);
  await page.click('#toc-list li');
  await page.waitForSelector('.entry.diary s.struck.lined');
  assert.equal(await page.locator('.entry.diary s.struck').textContent(), 'devour');
  assert.equal(await lastDiary(page), 'How lovely. I would devour enjoy the details.');
  await page.context().close();
});

// ---------- #14 the diary speaks first ----------

test('the very first entry opens with a note from the diary, and only once a day', { timeout: 60000 }, async () => {
  const page = await freshBook();
  await newEntry(page);
  await page.waitForSelector('#entries .entry.diary .ink.done');
  assert.equal(await page.locator('#entries .entry.user').count(), 0);
  const saved = await page.evaluate(async () => {
    const db = await import('./js/db.js');
    const [s] = await db.listSessions();
    return s.messages.map((m) => [m.role, m.overture || null]);
  });
  assert.deepEqual(saved, [['diary', 'first']]);

  await say(page, 'Hello, then.');
  await backToContents(page);
  await newEntry(page);
  await page.waitForTimeout(800);
  assert.equal(await page.locator('#entries .entry').count(), 0, 'no second overture the same day');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('after days away, a new entry opens with a remark on the absence', { timeout: 60000 }, async () => {
  const page = await freshBook();
  await seedOldSession(page, 5);
  await newEntry(page);
  await page.waitForSelector('#entries .entry.diary .ink.done');
  const kind = await page.evaluate(async () => {
    const db = await import('./js/db.js');
    const [s] = await db.listSessions();
    return s.messages[0]?.overture;
  });
  assert.equal(kind, 'absence');
  assert.ok((await lastDiary(page)).length > 5);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

// ---------- #17 revised titles ----------

test('after a few exchanges the title is revised and the old one struck out in the contents', { timeout: 90000 }, async () => {
  const page = await freshBook();
  await newEntry(page);
  await say(page, 'My boss keeps giving me impossible deadlines');
  const first = await page.textContent('#session-title');
  await say(page, 'I stay late every night to finish everything');
  await say(page, 'Nobody notices any of it');
  await say(page, 'I am starting to think I should quit');
  const revised = await page.textContent('#session-title');
  assert.notEqual(revised, first);
  const history = await page.evaluate(async () => {
    const db = await import('./js/db.js');
    const [s] = await db.listSessions();
    return s.titleHistory;
  });
  assert.deepEqual(history, [first]);
  await backToContents(page);
  assert.equal(await page.locator('#toc-list s.toc-old').first().textContent(), first);
  assert.equal(await page.locator('#toc-list .toc-current').first().textContent(), revised);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});
