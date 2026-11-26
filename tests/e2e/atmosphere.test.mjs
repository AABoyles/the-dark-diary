// js/candle.js (issue #23) and js/sound.js (issue #21) in a real page.
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

async function openWithAtmosphere(page) {
  await page.goto(server.url);
  await page.addStyleTag({ url: new URL('css/atmosphere.css', server.url).href });
}

// Samples --candle-intensity every 100 ms for `ms`, returning the distinct values seen.
function sampleIntensity(page, ms = 1500) {
  return page.evaluate((duration) => new Promise((resolve) => {
    const seen = [];
    const read = () => {
      const el = document.getElementById('candle');
      seen.push(el ? getComputedStyle(el).getPropertyValue('--candle-intensity').trim() : '');
    };
    read();
    const id = setInterval(read, 100);
    setTimeout(() => {
      clearInterval(id);
      resolve([...new Set(seen)]);
    }, duration);
  }), ms);
}

test('startCandle creates one #candle, which flickers, never blocks clicks, pauses while hidden, and stops', { timeout: 60000 }, async () => {
  const page = await newPage(browser);
  await openWithAtmosphere(page);

  const count = await page.evaluate(async () => {
    const m = await import('/js/candle.js');
    m.startCandle();
    m.startCandle();
    return document.querySelectorAll('#candle').length;
  });
  assert.equal(count, 1);

  const flicker = await sampleIntensity(page, 1500);
  assert.ok(flicker.length > 1, `intensity should change, saw ${JSON.stringify(flicker)}`);
  for (const v of flicker) {
    const n = Number(v);
    assert.ok(n >= 0.85 && n <= 1, `intensity ${v} is within 0.85–1.0`);
  }

  const hit = await page.evaluate(() => {
    const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return el?.id ?? el?.tagName;
  });
  assert.notEqual(hit, 'candle');

  // Hidden page: the flicker must stop.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(150); // let any in-flight transition settle
  const frozenAt = await page.evaluate(() => getComputedStyle(document.getElementById('candle')).getPropertyValue('--candle-intensity').trim());
  const whileHidden = await sampleIntensity(page, 800);
  assert.deepEqual(whileHidden, [frozenAt], 'no change while the page is hidden');

  // Visible again: it resumes.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const resumed = await sampleIntensity(page, 1200);
  assert.ok(resumed.length > 1, 'flicker resumes when visible');

  // Thinking toggles a class.
  const thinking = await page.evaluate(async () => {
    const m = await import('/js/candle.js');
    m.setThinking(true);
    const on = document.getElementById('candle').classList.contains('thinking');
    m.setThinking(false);
    const off = document.getElementById('candle').classList.contains('thinking');
    m.setThinking(true);
    return { on, off };
  });
  assert.deepEqual(thinking, { on: true, off: false });

  // stopCandle removes the element and its timers.
  await page.evaluate(async () => {
    const m = await import('/js/candle.js');
    m.stopCandle();
  });
  assert.equal(await page.locator('#candle').count(), 0);

  await page.close();
});

test('under reduced motion the candle is static', async () => {
  const page = await newPage(browser);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openWithAtmosphere(page);
  await page.evaluate(async () => {
    const m = await import('/js/candle.js');
    m.startCandle();
  });
  assert.equal(await page.locator('#candle').count(), 1);
  const seen = await sampleIntensity(page, 1500);
  assert.equal(seen.length, 1, `intensity should not change, saw ${JSON.stringify(seen)}`);
  await page.close();
});

test('the sound toggle turns sound on and the synthesized sounds play without throwing', async () => {
  // the app mounts the real toggle on the contents page (js/app.js)
  const page = await newPage(browser, { mindChoice: 'none' });
  await openWithAtmosphere(page);
  await page.click('#cover');
  await page.waitForSelector('#sound-toggle', { state: 'visible' });

  assert.equal(await page.getAttribute('#sound-toggle', 'aria-pressed'), 'false');
  await page.click('#sound-toggle'); // a real user gesture, so the AudioContext may start
  assert.equal(await page.getAttribute('#sound-toggle', 'aria-pressed'), 'true');
  assert.equal(await page.textContent('#sound-toggle'), '♪ Sound: on');
  assert.equal(await page.evaluate(() => localStorage.getItem('dd-sound')), 'on');

  const errors = await page.evaluate(async () => {
    const m = await import('/js/sound.js');
    const failures = [];
    for (const [name, fn] of [
      ['scratch', () => m.scratch()],
      ['strokeSound', () => m.strokeSound(1200)],
      ['rustle', () => m.rustle()],
      ['coverCreak', () => m.coverCreak()],
    ]) {
      try { fn(); } catch (err) { failures.push(`${name}: ${err.message}`); }
    }
    return failures;
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(page.errors, []);

  await page.close();
});
