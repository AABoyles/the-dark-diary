// Issue #22: the diary's script looks hand-written. Letters carry their own
// tilt, bob and weight; words never break across lines; strike-throughs still
// render; a blot appears for some messages.
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

async function handPage(opts = {}) {
  const page = await newPage(browser, { mindChoice: 'none', ...opts });
  await page.goto(server.url);
  await page.addStyleTag({ url: 'css/hand.css' });
  return page;
}

// Each letter's hand, read back from the DOM: [char, --rot, --dy, --w].
const readHand = (page, sel) => page.evaluate((s) => {
  const p = document.querySelector(s);
  return [...p.querySelectorAll('.ch')].map((c) => [
    c.textContent,
    c.style.getPropertyValue('--rot'),
    c.style.getPropertyValue('--dy'),
    c.style.getPropertyValue('--w'),
  ]);
}, sel);

test('renderInk writes one letter per non-space character, each with its own hand', { timeout: 30000 }, async () => {
  const page = await handPage();
  const result = await page.evaluate(async () => {
    const { renderInk } = await import('./js/ink.js');
    const text = 'Washing blood from a silk shirt.';
    const p = document.createElement('p');
    p.className = 'ink';
    document.body.appendChild(p);
    renderInk(p, text, { seed: 4242 });
    const chars = [...p.querySelectorAll('.ch')];
    const styled = chars.every((c) => /deg$/.test(c.style.getPropertyValue('--rot'))
      && /em$/.test(c.style.getPropertyValue('--dy'))
      && c.style.getPropertyValue('--w') !== '');
    return {
      count: chars.length,
      expected: text.replace(/ /g, '').length,
      styled,
      text: p.textContent,
      spaces: p.childNodes.length > 0,
    };
  });
  assert.equal(result.count, result.expected);
  assert.ok(result.styled, 'every letter has --rot, --dy and --w');
  assert.equal(result.text, 'Washing blood from a silk shirt.');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('the same seed gives the same hand, and different text gives a different one', { timeout: 30000 }, async () => {
  const page = await handPage();
  const result = await page.evaluate(async () => {
    const { renderInk } = await import('./js/ink.js');
    const make = (text, seed) => {
      const p = document.createElement('p');
      document.body.appendChild(p);
      renderInk(p, text, seed === undefined ? {} : { seed });
      return [...p.querySelectorAll('.ch')].map((c) => c.getAttribute('style'));
    };
    return {
      same: JSON.stringify(make('Hold the door.', 77)) === JSON.stringify(make('Hold the door.', 77)),
      // without a seed the hand comes from the text, so different text gives a different hand
      otherText: JSON.stringify(make('Hold the door.')) === JSON.stringify(make('Shut the door.')),
      otherSeed: JSON.stringify(make('Hold the door.', 77)) === JSON.stringify(make('Hold the door.', 78)),
      defaultStable: JSON.stringify(make('Hold the door.')) === JSON.stringify(make('Hold the door.')),
    };
  });
  assert.equal(result.same, true);
  assert.equal(result.otherSeed, false, 'a different seed should give different letters');
  assert.equal(result.otherText, false, 'different text, different hand');
  assert.equal(result.defaultStable, true, 'without a seed, the seed comes from the text');
  await page.context().close();
});

test('letters keep their hand from streaming to the final render', { timeout: 30000 }, async () => {
  const page = await handPage();
  const result = await page.evaluate(async () => {
    const { InkWriter } = await import('./js/ink.js');
    const p = document.createElement('p');
    p.className = 'ink';
    document.body.appendChild(p);
    const final = 'I would ~~devour~~ enjoy hearing more about the silver knives.';
    const w = new InkWriter(p, { charDelay: 2 });
    for (const piece of ['I would ~~dev', 'our~~ enjoy hear', 'ing more about the sil', 'ver knives.']) w.append(piece);
    // wait until every character is on the page (the last writing frame)
    await new Promise((resolve) => {
      const check = () => (w.queue.length === 0 ? resolve() : setTimeout(check, 2));
      check();
    });
    const before = [...p.querySelectorAll('.ch')].map((c) => [
      c.textContent, c.style.getPropertyValue('--rot'), c.style.getPropertyValue('--dy'), c.style.getPropertyValue('--w'),
    ]);
    await w.finish(final);
    const after = [...p.querySelectorAll('.ch')].map((c) => [
      c.textContent, c.style.getPropertyValue('--rot'), c.style.getPropertyValue('--dy'), c.style.getPropertyValue('--w'),
    ]);
    return { before, after, classes: p.className };
  });
  assert.ok(result.before.length > 40);
  assert.deepEqual(result.after, result.before);
  assert.match(result.classes, /\bdone\b/);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('words never break across lines', { timeout: 30000 }, async () => {
  const page = await handPage();
  const result = await page.evaluate(async () => {
    const { renderInk } = await import('./js/ink.js');
    const wrap = document.createElement('div');
    wrap.className = 'entry diary';
    wrap.style.width = '220px';
    const p = document.createElement('p');
    p.className = 'ink';
    wrap.appendChild(p);
    document.body.appendChild(wrap);
    renderInk(p, 'Extraordinarily considerate of you to remember the anniversaries of all the people you have failed, incidentally, unforgettably, and with such dreadful persistence.', { seed: 9 });
    const words = [...p.querySelectorAll('.w')];
    const lineHeight = parseFloat(getComputedStyle(p).lineHeight) || 20;
    return {
      words: words.length,
      split: words.filter((w) => w.getClientRects().length !== 1).map((w) => w.textContent),
      lines: Math.round(p.getBoundingClientRect().height / lineHeight),
    };
  });
  assert.ok(result.words > 15);
  assert.ok(result.lines > 3, `the text should wrap onto several lines (got ${result.lines})`);
  assert.deepEqual(result.split, []);
  await page.context().close();
});

test('strike-throughs still render, with their letters inside', { timeout: 30000 }, async () => {
  const page = await handPage();
  const result = await page.evaluate(async () => {
    const { renderInk } = await import('./js/ink.js');
    const p = document.createElement('p');
    p.className = 'ink';
    document.body.appendChild(p);
    renderInk(p, 'I would ~~devour~~ enjoy hearing more.', { seed: 3 });
    const s = p.querySelector('s.struck.lined');
    return {
      struck: s?.textContent,
      letters: s ? s.querySelectorAll('.ch').length : 0,
      text: p.textContent,
    };
  });
  assert.deepEqual(result, { struck: 'devour', letters: 6, text: 'I would devour enjoy hearing more.' });
  await page.context().close();
});

test('aria-label is the visible text, struck word included', { timeout: 30000 }, async () => {
  const page = await handPage();
  const result = await page.evaluate(async () => {
    const { renderInk, InkWriter } = await import('./js/ink.js');
    const text = 'I would ~~devour~~ enjoy hearing more.';
    const a = document.createElement('p');
    document.body.appendChild(a);
    renderInk(a, text);
    const b = document.createElement('p');
    document.body.appendChild(b);
    const w = new InkWriter(b, { charDelay: 2 });
    w.append(text);
    await w.finish(text);
    return {
      rendered: a.getAttribute('aria-label'),
      renderedText: a.textContent,
      streamed: b.getAttribute('aria-label'),
      streamedText: b.textContent,
    };
  });
  assert.equal(result.rendered, 'I would devour enjoy hearing more.');
  assert.equal(result.rendered, result.renderedText);
  assert.equal(result.streamed, result.streamedText);
  await page.context().close();
});

test('an ink blot appears for some messages and not others, and fades in after writing', { timeout: 30000 }, async () => {
  const page = await handPage();
  const result = await page.evaluate(async () => {
    const { renderInk, InkWriter, blotFor } = await import('./js/ink.js');
    const withBlot = [];
    const without = [];
    for (let seed = 1; seed <= 40; seed++) {
      const p = document.createElement('p');
      document.body.appendChild(p);
      renderInk(p, 'Hello.', { seed });
      (p.querySelector('.blot') ? withBlot : without).push(seed);
    }
    const blotSeed = withBlot[0];
    const plainSeed = without[0];
    // a streamed message with a blot: none while writing, one blot-in after the last letter
    const p = document.createElement('p');
    document.body.appendChild(p);
    const w = new InkWriter(p, { charDelay: 2, seed: blotSeed });
    w.append('Hello there, ');
    await new Promise((r) => setTimeout(r, 30));
    const duringWriting = p.querySelectorAll('.blot').length;
    await w.finish('Hello there, friend.');
    const blotIn = p.querySelectorAll('.blot.blot-in').length;
    return {
      some: withBlot.length > 0,
      not: without.length > 0,
      blotCheck: blotFor(blotSeed) !== null,
      plainBlot: blotFor(plainSeed),
      duringWriting,
      blotIn,
      text: p.textContent,
    };
  });
  assert.ok(result.some, 'some seeds get a blot');
  assert.ok(result.not, 'other seeds do not');
  assert.equal(result.blotCheck, true);
  assert.equal(result.plainBlot, null);
  assert.equal(result.duringWriting, 0, 'no blot while the words are still being written');
  assert.equal(result.blotIn, 1, 'the blot fades in once the message is written');
  assert.equal(result.text, 'Hello there, friend.', 'the blot is not part of the text');
  await page.context().close();
});
