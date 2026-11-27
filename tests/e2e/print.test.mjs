// Print / Save as PDF (js/print.js, css/print.css): the printable bound copy of
// the diary is built from session data without HTML injection, shows only when
// printing, and is removed again after printing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, newPage } from './helpers.mjs';

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

const DOODLE = ['M10 40 C30 10 50 70 70 40 S100 20 110 45', 'M20 20 L60 60'];

// Newest first, as db.listSessions returns them.
const SESSIONS = [
  {
    id: 'b',
    title: '',
    createdAt: Date.UTC(2024, 2, 9, 8, 30),
    messages: [
      { role: 'user', text: 'Second entry, nothing to report.', ts: Date.UTC(2024, 2, 9, 8, 30) },
      { role: 'diary', text: 'I would ~~cruel~~ kind hear more.', ts: Date.UTC(2024, 2, 9, 8, 31) },
    ],
  },
  {
    id: 'a',
    title: 'The first night',
    createdAt: Date.UTC(2024, 0, 5, 20, 0),
    messages: [
      { role: 'user', text: 'I cannot sleep again.', ts: Date.UTC(2024, 0, 5, 20, 0), doodle: DOODLE },
      { role: 'diary', text: 'The house creaks, and you listen.', ts: Date.UTC(2024, 0, 5, 20, 1) },
    ],
  },
];

test('buildPrintBook: title page, contents, entries oldest first, classes, strike, doodle', { timeout: 60000 }, async () => {
  const page = await newPage(browser, { mindChoice: 'none' });
  await page.goto(server.url);

  const summary = await page.evaluate(async (sessions) => {
    const { buildPrintBook } = await import('./js/print.js');
    const book = buildPrintBook(sessions);
    const articles = [...book.querySelectorAll('article.print-entry')];
    const toc = [...book.querySelectorAll('.print-contents ol li')];
    const first = articles[0];
    const second = articles[1];
    const strike = second.querySelector('p.print-diary s');
    return {
      id: book.id,
      detached: book.isConnected === false,
      titlePage: book.querySelector('section.print-title')?.textContent ?? null,
      titleText: [...book.querySelectorAll('.print-title h1, .print-title p')].map((n) => n.textContent),
      contentsHeading: book.querySelector('.print-contents h2')?.textContent ?? null,
      tocTitles: toc.map((li) => li.querySelector('.print-toc-title').textContent),
      tocDates: toc.map((li) => li.querySelector('time').textContent),
      articleCount: articles.length,
      firstTitle: first.querySelector('h2').textContent,
      firstTimeText: first.querySelector('time').textContent,
      firstClasses: [...first.querySelectorAll('p')].map((p) => p.className),
      secondTitle: second.querySelector('h2').textContent,
      secondClasses: [...second.querySelectorAll('p')].map((p) => p.className),
      strikeText: strike?.textContent ?? null,
      strikeParentText: strike?.parentElement.textContent ?? null,
      doodleSvg: !!first.querySelector('.print-doodle svg.doodle'),
      doodlePaths: first.querySelectorAll('svg path').length,
      userDoodleInP: first.querySelector('p.print-user .print-doodle') !== null,
    };
  }, SESSIONS);

  assert.equal(summary.id, 'print-book');
  assert.equal(summary.detached, true, 'the copy is built detached');
  assert.deepEqual(summary.titleText, ['Property of', 'The Diary', 'of nobody in particular'], 'title page text');
  assert.equal(summary.contentsHeading, 'Contents');
  assert.equal(summary.tocTitles.length, 2, 'contents lists both entries');
  assert.deepEqual(summary.tocTitles, ['The first night', 'An Entry Not Yet Mocked']);
  assert.equal(summary.tocDates.length, 2, 'each contents item has a date');
  assert.match(summary.tocDates[0], /January 5, 2024/, 'long-form date');
  assert.equal(summary.articleCount, 2);
  assert.equal(summary.firstTitle, 'The first night', 'the oldest entry is printed first');
  assert.match(summary.firstTimeText, /2024/);
  assert.deepEqual(summary.firstClasses, ['print-user', 'print-diary']);
  assert.equal(summary.secondTitle, 'An Entry Not Yet Mocked', 'an untitled entry gets the fallback title');
  assert.deepEqual(summary.secondClasses, ['print-user', 'print-diary']);
  assert.equal(summary.strikeText, 'cruel', 'strike markup becomes an <s>');
  assert.equal(summary.strikeParentText, 'I would cruel kind hear more.', 'the rest stays as text');
  assert.equal(summary.doodleSvg, true, 'the doodle is drawn in the margin');
  assert.equal(summary.doodlePaths, DOODLE.length, 'one path per doodle stroke');
  assert.equal(summary.userDoodleInP, true, 'the doodle sits in its own message paragraph');

  assert.deepEqual(page.errors, [], `page errors: ${page.errors.join('; ')}`);
  await page.context().close();
});

test('session text is never parsed as HTML', { timeout: 60000 }, async () => {
  const page = await newPage(browser, { mindChoice: 'none' });
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
  await page.goto(server.url);

  const evil = [{
    id: 'x',
    title: '<img src=x onerror=alert(1)>',
    createdAt: Date.UTC(2024, 5, 1),
    messages: [
      { role: 'user', text: '<img src=x onerror=alert(1)>', ts: Date.UTC(2024, 5, 1) },
      { role: 'diary', text: '<img src=x onerror=alert(1)> ~~<b>bold</b>~~ <i>x</i>', ts: Date.UTC(2024, 5, 1) },
    ],
  }];

  const result = await page.evaluate(async (sessions) => {
    const { buildPrintBook } = await import('./js/print.js');
    const book = buildPrintBook(sessions);
    document.body.append(book);
    const out = {
      imgs: book.querySelectorAll('img').length,
      tags: [...book.querySelectorAll('*')].map((n) => n.tagName).filter((t) => !['SECTION', 'ARTICLE', 'H1', 'H2', 'P', 'TIME', 'OL', 'LI', 'SPAN', 'S', 'SVG', 'PATH'].includes(t)),
      userText: book.querySelector('p.print-user').textContent,
      diaryText: book.querySelector('p.print-diary').textContent,
      titleText: book.querySelector('article h2').textContent,
    };
    book.remove();
    return out;
  }, evil);

  assert.equal(result.imgs, 0, 'no img element is created from session text');
  assert.deepEqual(result.tags, [], 'no unexpected elements are created');
  assert.equal(result.userText, '<img src=x onerror=alert(1)>', 'shown as literal text');
  assert.equal(result.diaryText, '<img src=x onerror=alert(1)> <b>bold</b> <i>x</i>', 'diary text is literal');
  assert.equal(result.titleText, '<img src=x onerror=alert(1)>');
  assert.deepEqual(dialogs, [], 'no script ran');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('the copy is shown only when printing, and the desk is hidden then', { timeout: 60000 }, async () => {
  const page = await newPage(browser, { mindChoice: 'none' });
  await page.goto(server.url);
  await page.evaluate(async (sessions) => {
    const { buildPrintBook } = await import('./js/print.js');
    document.body.append(buildPrintBook(sessions));
  }, SESSIONS);

  const display = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? getComputedStyle(el).display : null;
  }, sel);

  await page.emulateMedia({ media: 'screen' });
  assert.equal(await display('#print-book'), 'none', 'on screen the copy is not displayed');
  assert.notEqual(await display('#desk'), 'none', 'on screen the desk is shown');

  await page.emulateMedia({ media: 'print' });
  assert.notEqual(await display('#print-book'), 'none', 'printing shows the copy');
  assert.equal(await display('#desk'), 'none', 'printing hides the desk');
  const pageSize = await page.evaluate(() => getComputedStyle(document.body).overflow);
  assert.equal(pageSize, 'visible', 'the printed document is not clipped to one viewport');

  await page.emulateMedia({ media: 'screen' });
  assert.equal(await display('#print-book'), 'none', 'back on screen it is hidden again');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('printBook prints once and removes the copy after afterprint', { timeout: 60000 }, async () => {
  const page = await newPage(browser, { mindChoice: 'none' });
  await page.goto(server.url);

  const result = await page.evaluate(async (sessions) => {
    const { printBook } = await import('./js/print.js');
    const win = new EventTarget();
    let calls = 0;
    win.print = () => { calls += 1; };
    printBook(sessions, { win });
    const during = !!document.getElementById('print-book');
    const callsBefore = calls;
    win.dispatchEvent(new Event('afterprint'));
    return {
      callsBefore,
      calls,
      during,
      after: !!document.getElementById('print-book'),
    };
  }, SESSIONS);

  assert.equal(result.callsBefore, 1, 'win.print() is called once');
  assert.equal(result.calls, 1, 'win.print() is not called again by afterprint');
  assert.equal(result.during, true, 'the copy is in the document while printing');
  assert.equal(result.after, false, 'the copy is removed after afterprint');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('no page errors and no CSP violations while printing', { timeout: 60000 }, async () => {
  const page = await newPage(browser, { mindChoice: 'none' });
  await page.addInitScript(() => {
    window.__csp = [];
    window.addEventListener('securitypolicyviolation', (e) => {
      window.__csp.push(`${e.violatedDirective} -> ${e.blockedURI || '(inline)'}`);
    }, true);
  });
  await page.goto(server.url);

  await page.evaluate(async (sessions) => {
    const { printBook } = await import('./js/print.js');
    const win = new EventTarget();
    win.print = () => {};
    printBook(sessions, { win });
    win.dispatchEvent(new Event('afterprint'));
  }, SESSIONS);
  await page.emulateMedia({ media: 'print' });
  await page.emulateMedia({ media: 'screen' });

  const violations = await page.evaluate(() => window.__csp);
  assert.deepEqual(violations, [], 'no Content-Security-Policy violations');
  assert.deepEqual(page.errors, [], `page errors: ${page.errors.join('; ')}`);
  await page.context().close();
});
