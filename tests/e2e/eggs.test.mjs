// js/effects.js in a real browser: the letters of a name travel into a new order
// and back, the paragraph's text is restored, and reduced motion does nothing.

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

/** Adds a visible <p class="ink"> with the given text and returns nothing. */
async function addInk(page, text) {
  await page.evaluate((t) => {
    const p = document.createElement('p');
    p.className = 'ink';
    p.id = 'probe-ink';
    p.textContent = t;
    p.style.cssText = 'position:fixed;top:20px;left:20px;font-size:28px;z-index:99999;';
    document.body.append(p);
  }, text);
}

test('the letters of a name rearrange during the animation, then the text is restored', { timeout: 60000 }, async () => {
  const page = await newPage(browser);
  await page.goto(server.url);
  await addInk(page, 'My name is Rebecca');

  // Start the animation without awaiting it; sample the letters' visual order meanwhile.
  await page.evaluate(() => {
    window.__done = false;
    window.__samples = [];
    const p = document.getElementById('probe-ink');
    const sampler = setInterval(() => {
      const spans = [...p.querySelectorAll('.anagram-ch')];
      if (spans.length === 0) return;
      const centres = spans.map((s) => {
        const r = s.getBoundingClientRect();
        return r.left + r.width / 2;
      });
      const visualOrder = spans.map((_, i) => i).sort((a, b) => centres[a] - centres[b]);
      const differs = visualOrder.some((v, i) => v !== i);
      window.__samples.push({ n: spans.length, differs, text: p.textContent });
    }, 30);
    window.__stopSampler = () => clearInterval(sampler);
    import('./js/effects.js')
      .then((m) => m.playAnagram(p, 'Rebecca', { holdMs: 300 }))
      .then(() => { window.__done = true; });
  });

  await page.waitForFunction(() => window.__done === true, null, { timeout: 30000 });
  await page.evaluate(() => window.__stopSampler());

  const result = await page.evaluate(() => ({
    samples: window.__samples,
    text: document.getElementById('probe-ink').textContent,
    spans: document.querySelectorAll('#probe-ink .anagram-ch').length,
    cls: document.getElementById('probe-ink').className,
  }));

  const during = result.samples.filter((s) => s.n === 7);
  assert.ok(during.length > 0, 'seven letter spans were seen during the animation');
  assert.ok(during.some((s) => s.differs), 'the letters were seen in an order different from the original');
  assert.ok(during.every((s) => s.text === 'My name is Rebecca' || s.text === ''), 'no stray text while moving');

  assert.equal(result.text, 'My name is Rebecca', 'the plain text is restored');
  assert.equal(result.spans, 0, 'no letter spans remain');
  assert.equal(result.cls, 'ink', 'the paragraph keeps only its ink class');
  assert.deepEqual(page.errors, [], 'no page errors');
});

test('under reduced motion the animation resolves at once and leaves no spans', { timeout: 60000 }, async () => {
  const page = await newPage(browser);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(server.url);
  await addInk(page, 'My name is Rebecca');

  const result = await page.evaluate(async () => {
    const p = document.getElementById('probe-ink');
    const { playAnagram } = await import('./js/effects.js');
    const t0 = performance.now();
    await playAnagram(p, 'Rebecca', { holdMs: 300 });
    return {
      elapsed: performance.now() - t0,
      spans: p.querySelectorAll('.anagram-ch').length,
      text: p.textContent,
    };
  });

  assert.ok(result.elapsed < 150, `resolved immediately (took ${result.elapsed.toFixed(0)} ms)`);
  assert.equal(result.spans, 0, 'no letter spans were created');
  assert.equal(result.text, 'My name is Rebecca', 'the text is unchanged');
  assert.deepEqual(page.errors, [], 'no page errors');
});

test('a name that is not in the paragraph resolves at once without changing it', { timeout: 60000 }, async () => {
  const page = await newPage(browser);
  await page.goto(server.url);
  await addInk(page, 'Nothing to see here');

  const result = await page.evaluate(async () => {
    const p = document.getElementById('probe-ink');
    const { playAnagram } = await import('./js/effects.js');
    const t0 = performance.now();
    await playAnagram(p, 'Rebecca', { holdMs: 300 });
    return { elapsed: performance.now() - t0, spans: p.querySelectorAll('.anagram-ch').length, text: p.textContent };
  });

  assert.ok(result.elapsed < 150, 'resolved immediately');
  assert.equal(result.spans, 0);
  assert.equal(result.text, 'Nothing to see here');
});
