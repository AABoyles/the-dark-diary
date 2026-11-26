// Issue #7: a streamed reply starts writing at the first token; the doodle
// stops then; stage directions, labels and quotes never reach the page.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, newPage, openBook, newEntry } from './helpers.mjs';

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

// A stand-in for js/llm-client.js: no model, just a slow, token-by-token reply.
const FAKE_LLM = (firstTokenMs) => `
export async function createLlm({ onProgress }) {
  onProgress?.({ status: 'progress', progress: 100 });
  return {
    async generate(chat, options, { onToken } = {}) {
      const isTitle = /title/i.test(chat.at(-1).content);
      const full = isTitle
        ? 'A Weekend Wasted, Predictably'
        : 'Diary: "Washing blood from a silk shirt (it never quite comes out). And you, I suspect, spent yours hoping no one would ask."';
      if (isTitle) return full;
      await new Promise((r) => setTimeout(r, ${firstTokenMs}));
      let out = '';
      for (const t of full.match(/\\S+\\s*/g)) {
        out += t;
        onToken?.(t);
        await new Promise((r) => setTimeout(r, 120));
      }
      return out;
    },
    dispose() {},
  };
}`;

const FINAL = 'Washing blood from a silk shirt. And you, I suspect, spent yours hoping no one would ask.';
// the streamed reply is the diary entry that follows the user's message (a first entry may open with a note)
const REPLY = '#entries .entry.user ~ .entry.diary .ink';
const diaryText = (page) => page.evaluate((sel) => document.querySelector(sel)?.textContent ?? null, REPLY);

async function streamingPage(firstTokenMs) {
  const page = await newPage(browser, { mindChoice: 'small' });
  await page.route('**/js/llm-client.js', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: FAKE_LLM(firstTokenMs) }));
  await page.goto(server.url);
  await openBook(page);
  await page.waitForFunction(() => /modest/.test(document.querySelector('#mind-control')?.textContent || ''));
  // let the (fake) model finish booting before writing
  await page.waitForFunction(async () => (await import('./js/ai.js')).getBackend() === 'transformers');
  await newEntry(page);
  return page;
}

test('a streamed reply appears while it is still being generated, cleaned as it goes', { timeout: 60000 }, async () => {
  const page = await streamingPage(500);
  await page.fill('#entry-input', 'How was your weekend?');
  await page.press('#entry-input', 'Enter');

  // ink starts long before the ~2.5 s generation finishes
  await page.waitForFunction((sel) => (document.querySelector(sel)?.textContent || '').length > 0, REPLY, { timeout: 5000 });
  const early = await diaryText(page);
  assert.ok(FINAL.startsWith(early), `partial text ${JSON.stringify(early)} must be a prefix of the final reply`);
  assert.ok(early.length < FINAL.length, 'text should still be arriving');

  await page.waitForSelector(`${REPLY}.done`, { timeout: 30000 });
  assert.equal(await diaryText(page), FINAL);
  assert.equal(await page.getAttribute('#entries', 'aria-busy'), 'false');
  assert.equal(await page.locator('.doodle path').count(), 0, 'a quick first token means no doodle');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('a slow first token starts the doodle, which stops (and is kept) when text arrives', { timeout: 60000 }, async () => {
  const page = await streamingPage(4500);
  await page.fill('#entry-input', 'How was your weekend?');
  await page.press('#entry-input', 'Enter');

  await page.waitForSelector('.doodle path', { timeout: 6000 });
  await page.waitForFunction((sel) => (document.querySelector(sel)?.textContent || '').length > 0, REPLY, { timeout: 10000 });
  await page.waitForSelector(`${REPLY}.done`, { timeout: 30000 });
  const strokes = await page.locator('.doodle path').count();
  assert.ok(strokes >= 1 && strokes <= 4, `pen should stop soon after the first token (got ${strokes} strokes)`);
  const saved = await page.evaluate(async () => {
    const db = await import('./js/db.js');
    const [s] = await db.listSessions();
    return s.messages.find((m) => m.role === 'user').doodle?.length ?? 0;
  });
  assert.equal(saved, strokes, 'the doodle is saved with the message');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});
