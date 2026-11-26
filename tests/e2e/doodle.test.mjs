import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, newPage, openBook, newEntry, say, openEntry } from './helpers.mjs';

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

const SLOW_MS = 7000;

// Holds back every scripted reply: js/ai.js awaits matchIntent() from js/embed.js before answering.
async function slowDiary(page, ms) {
  await page.route('**/js/embed.js', async (route) => {
    const res = await route.fetch();
    const original = await res.text();
    const needle = 'export async function matchIntent(';
    if (!original.includes(needle)) throw new Error('embed.js changed: matchIntent not found');
    const body = original.replace(needle, 'async function matchIntentReal(')
      + `\nexport async function matchIntent(text, opts) {\n`
      + `  await new Promise((r) => setTimeout(r, ${ms}));\n`
      + `  return matchIntentReal(text, opts);\n}\n`;
    await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body });
  });
}

const pathCount = (page) => page.locator('.doodle path').count();

test('a slow diary makes the pen doodle beside the last message, and the doodle is kept', { timeout: 120000 }, async () => {
  const page = await newPage(browser, { mindChoice: 'none' });
  await slowDiary(page, SLOW_MS);
  await page.goto(server.url);
  await openBook(page);
  await newEntry(page);

  await page.fill('#entry-input', 'I have been waiting a very long time for a reply');
  const sent = Date.now();
  await page.press('#entry-input', 'Enter');

  // The pen waits about three seconds before it starts.
  await page.waitForTimeout(2000);
  assert.equal(await pathCount(page), 0, 'no doodle yet at about 2 s');

  await page.waitForFunction(() => document.querySelectorAll('.doodle path').length > 0, null, { timeout: 5500 - (Date.now() - sent) + 500 });
  assert.ok(Date.now() - sent < 5500 + 500, 'the doodle appears by about 5.5 s');

  // The doodle sits inside the last user entry, in its right 30%.
  const entry = await page.locator('.entry.user').last().boundingBox();
  const svg = await page.locator('.entry.user').last().locator('.doodle').boundingBox();
  assert.ok(svg, 'doodle svg has a box');
  const cx = svg.x + svg.width / 2;
  const cy = svg.y + svg.height / 2;
  assert.ok(cx >= entry.x + entry.width * 0.7, `doodle centre x ${cx} in right 30% of entry (${entry.x}..${entry.x + entry.width})`);
  assert.ok(cy >= entry.y && cy <= entry.y + entry.height, 'doodle centre y within the entry');

  // The reply arrives, and the doodle stays on the page.
  await page.waitForSelector('.entry.diary');
  await page.waitForFunction(() => !document.querySelector('#entry-input').disabled, null, { timeout: 30000 });
  assert.ok(await pathCount(page) >= 1, 'doodle remains after the reply');

  // Let the pen finish and the strokes save, then count what is drawn.
  let saved = -1;
  let drawn = -1;
  for (let i = 0; i < 40; i++) {
    drawn = await pathCount(page);
    saved = await page.evaluate(async () => {
      const db = await import('/js/db.js');
      const [s] = await db.listSessions();
      const user = s.messages.filter((m) => m.role === 'user').pop();
      return user?.doodle?.length ?? 0;
    });
    if (drawn > 0 && saved === drawn) break;
    await page.waitForTimeout(250);
  }
  assert.equal(saved, drawn, 'the saved doodle matches what is drawn');
  assert.ok(drawn > 0);

  // After a reload, reopening the entry from the contents redraws the same doodle.
  await page.reload();
  await openBook(page);
  await openEntry(page);
  assert.equal(await pathCount(page), drawn, 'the same number of paths after reopening');

  assert.equal(page.errors.length, 0, `page errors: ${page.errors.join('; ')}`);
  await page.context().close();
});

test('a quick diary leaves no doodle at all', { timeout: 60000 }, async () => {
  const page = await newPage(browser, { mindChoice: 'none' });
  await page.goto(server.url);
  await openBook(page);
  await newEntry(page);

  await say(page, 'I went out for a walk this afternoon');
  await page.waitForTimeout(3500); // past the pen's start time
  assert.equal(await pathCount(page), 0, 'no doodle when the reply is quick');

  assert.equal(page.errors.length, 0, `page errors: ${page.errors.join('; ')}`);
  await page.context().close();
});
