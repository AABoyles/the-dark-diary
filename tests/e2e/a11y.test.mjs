// Accessibility (issue #41): axe scans, keyboard-only use, focus, touch targets,
// visible focus, zoom, text spacing, reduced motion, toggles and heading structure.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  startServer, launch, newPage, openBook, newEntry, say, backToContents,
  pageTurned, openEntry,
} from './helpers.mjs';

const AXE_PATH = fileURLToPath(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url));
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
const VIEWPORTS = [['desktop 1280x800', DESKTOP], ['phone 390x844', PHONE]];
const SHORT = 'Two Cups of Tea';
const LONG = 'Concerning Your Dinner Plans';

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

// ---------- helpers ----------

/** Runs `fn` on a fresh page and always closes its context. */
async function withPage(opts, fn) {
  const page = await newPage(browser, opts);
  try {
    await fn(page);
    assert.deepEqual(page.errors, [], `page errors: ${page.errors.join('; ')}`);
  } finally {
    await page.context().close();
  }
}

/** Seeds one short and one long entry, then reloads so the contents list renders them. */
async function seedEntries(page) {
  await page.evaluate(async ({ short, long }) => {
    const db = await import('./js/db.js');
    const now = Date.now();
    const a = await db.createSession();
    a.title = short;
    a.messages.push(
      { role: 'user', text: 'I had two cups of tea and nothing else all day.', ts: now },
      { role: 'diary', text: 'Tea is a poor substitute for a confession.', ts: now },
    );
    await db.saveSession(a);
    const b = await db.createSession();
    b.title = long;
    for (let i = 0; i < 8; i++) {
      b.messages.push(
        { role: 'user', text: 'I keep thinking about the dinner party and who I should invite, and whether anyone will come at all.', ts: now },
        { role: 'diary', text: 'Guests are a delicate ingredient. Invite only those who will be missed, and only a little.', ts: now },
      );
    }
    await db.saveSession(b);
  }, { short: SHORT, long: LONG });
  await page.reload();
}

/** Opens the contents page with the seeded entries. */
async function openSeeded(page) {
  await page.goto(server.url);
  await seedEntries(page);
  await openBook(page);
}

/** Clicks a contents row by its title and waits for the page to turn. */
async function openTitled(page, title) {
  await page.locator('#toc-list li', { hasText: title }).click();
  await page.waitForSelector('#flow-view', { state: 'visible' });
  await pageTurned(page);
}

/** Waits for a page turn to finish, including the moment the book accepts the next key. */
async function turnDone(page) {
  // the leaf is inserted a frame after the change, so give it a moment to appear first
  await page.waitForSelector('.page-turn', { timeout: 300 }).catch(() => {});
  await pageTurned(page);
  await page.waitForTimeout(100);
}

/** Presses Tab until the focused element matches `selector` (and, if given, contains `text`). */
async function tabUntil(page, selector, text = '', max = 30) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const hit = await page.evaluate(([s, t]) => {
      const el = document.activeElement;
      return !!el && el.matches(s) && (!t || el.textContent.includes(t));
    }, [selector, text]);
    if (hit) return true;
  }
  return false;
}

async function describeFocus(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    return el ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className ? `.${String(el.className).split(' ').join('.')}` : ''}` : 'nothing';
  });
}

/** Waits briefly for focus to reach `selector`, then asserts it is there (never on body). */
async function assertFocus(page, selector, label, text = '') {
  const ok = await page.waitForFunction(([s, t]) => {
    const el = document.activeElement;
    return !!el && el.matches(s) && (!t || el.textContent.includes(t));
  }, [selector, text], { timeout: 3000 }).then(() => true, () => false);
  assert.ok(ok, `focus should be on ${label}, got ${await describeFocus(page)}`);
}

/** Replies to a line typed with the keyboard, waiting until the reply has finished writing. */
async function typeAndWait(page, text) {
  const before = await page.locator('#entries .entry.diary').count();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await page.waitForFunction((n) => document.querySelectorAll('#entries .entry.diary').length > n, before, { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('#entry-input').disabled, null, { timeout: 30000 });
  await page.waitForFunction(() => {
    const inks = document.querySelectorAll('#entries .entry.diary .ink');
    return inks.length > 0 && inks[inks.length - 1].classList.contains('done');
  }, null, { timeout: 30000 });
}

/** Runs axe on the current page and returns its violations (id, impact, help, targets). */
async function axeViolations(page, options = { runOnly: { type: 'tag', values: WCAG_TAGS } }) {
  await page.addScriptTag({ path: AXE_PATH });
  return page.evaluate(async (opts) => {
    const r = await window.axe.run({ exclude: ['.page-turn'] }, opts);
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      targets: v.nodes.map((n) => n.target.join(' ')),
    }));
  }, options);
}

function formatViolations(violations) {
  return violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.targets.join('\n    ')}`).join('\n');
}

async function assertNoAxeViolations(page, label) {
  const violations = await axeViolations(page);
  assert.equal(violations.length, 0, `${label}: axe violations\n${formatViolations(violations)}`);
}

/** Every listed control (that is shown) is at least 24x24 CSS px. */
async function assertTargets(page, selectors) {
  const problems = [];
  for (const sel of selectors) {
    const boxes = await page.locator(sel).evaluateAll((els) => els.map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { w: r.width, h: r.height, shown: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 };
    }));
    assert.ok(boxes.some((b) => b.shown), `${sel} is shown`);
    boxes.forEach((b, i) => {
      if (b.shown && (b.w < 24 || b.h < 24)) problems.push(`${sel}[${i}] is ${b.w.toFixed(1)}x${b.h.toFixed(1)}`);
    });
  }
  assert.deepEqual(problems, [], 'controls smaller than 24x24 CSS px');
}

/** The box of each selector lies fully inside the visible viewport. */
async function assertInsideViewport(page, selectors) {
  const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  for (const sel of selectors) {
    const box = await page.locator(sel).boundingBox();
    assert.ok(box, `${sel} has a box`);
    const inside = box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.w && box.y + box.height <= vp.h;
    assert.ok(inside, `${sel} fully inside the viewport: ${JSON.stringify(box)} vs ${JSON.stringify(vp)}`);
  }
}

async function assertNoHorizontalScroll(page, label) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  assert.ok(sw <= iw, `${label}: scrollWidth ${sw} exceeds innerWidth ${iw}`);
}

// ---------- axe scans ----------

for (const [label, viewport] of VIEWPORTS) {
  test(`axe: closed cover, ${label}`, { timeout: 120000 }, async () => {
    await withPage({ viewport }, async (page) => {
      await page.goto(server.url);
      await page.waitForSelector('#cover');
      await assertNoAxeViolations(page, 'closed cover');
    });
  });

  test(`axe: contents with the model-choice note, ${label}`, { timeout: 120000 }, async () => {
    await withPage({ viewport }, async (page) => {
      await page.goto(server.url);
      await openBook(page);
      await page.waitForSelector('#mind-slip:not([hidden])');
      await assertNoAxeViolations(page, 'contents with model-choice note');
    });
  });

  test(`axe: contents with two entries, ${label}`, { timeout: 120000 }, async () => {
    await withPage({ viewport, mindChoice: 'none' }, async (page) => {
      await openSeeded(page);
      await assertNoAxeViolations(page, 'contents with two entries');
    });
  });

  test(`axe: an entry after two exchanges, ${label}`, { timeout: 120000 }, async () => {
    await withPage({ viewport, mindChoice: 'none' }, async (page) => {
      await page.goto(server.url);
      await openBook(page);
      await newEntry(page);
      await say(page, 'Hello');
      await say(page, 'Why does nobody write back?');
      await assertNoAxeViolations(page, 'entry after two exchanges');
    });
  });
}

// ---------- keyboard-only walkthrough ----------

test('keyboard only: cover, new entry, reply, contents, reopen, turn pages, burn', { timeout: 180000 }, async () => {
  await withPage({ mindChoice: 'none' }, async (page) => {
    await page.goto(server.url);
    await seedEntries(page); // a short and a long entry, for the later steps

    assert.ok(await tabUntil(page, '#cover'), 'Tab reaches the cover');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#toc-page', { state: 'visible' });
    await assertFocus(page, '#new-session', '#new-session after opening the cover');

    // a new entry, typed and sent from the keyboard
    await page.keyboard.press('Enter');
    await page.waitForSelector('#flow-view', { state: 'visible' });
    await turnDone(page);
    await page.waitForSelector('#entry-input:not([disabled])');
    await assertFocus(page, '#entry-input', 'the entry textarea');
    await typeAndWait(page, 'Hello');
    await turnDone(page);

    // back to the contents, the entry just left is focused
    assert.ok(await tabUntil(page, '#back-to-toc'), 'Tab reaches the back button');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#flow-view', { state: 'hidden' });
    await turnDone(page);
    await assertFocus(page, '.toc-entry', 'the .toc-entry of the entry just left', '');
    assert.equal(
      await page.evaluate(() => document.activeElement.closest('#toc-list li')?.classList.contains('active')),
      true,
      'focused contents entry is the one just left',
    );

    // Enter reopens it
    await page.keyboard.press('Enter');
    await page.waitForSelector('#flow-view', { state: 'visible' });
    await turnDone(page);
    await assertFocus(page, '#entry-input', 'the textarea of the reopened entry');

    // the long entry: arrow keys turn its pages when focus is outside the textarea
    assert.ok(await tabUntil(page, '#back-to-toc'), 'Tab back to the contents button');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#flow-view', { state: 'hidden' });
    await turnDone(page);
    assert.ok(await tabUntil(page, '.toc-entry', LONG), 'Tab reaches the long entry');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#flow-view', { state: 'visible' });
    await turnDone(page);
    await assertFocus(page, '#entry-input', 'the textarea of the long entry');

    assert.ok(await tabUntil(page, '#back-to-toc'), 'focus leaves the textarea');
    // opening an entry lands on its last spread, so there is an earlier one to turn back to
    const first = await page.textContent('#spread-label');
    assert.equal(await page.locator('#prev-spread').isDisabled(), false, 'the long entry has several spreads');
    await page.keyboard.press('ArrowLeft');
    await turnDone(page);
    const second = await page.textContent('#spread-label');
    assert.notEqual(second, first, 'ArrowLeft turns to the previous spread');
    await page.keyboard.press('ArrowRight');
    await turnDone(page);
    assert.equal(await page.textContent('#spread-label'), first, 'ArrowRight turns forward again');

    // burn the entry from the keyboard
    assert.ok(await tabUntil(page, '#delete-session'), 'Tab reaches Burn entry');
    page.once('dialog', (d) => d.accept());
    await page.keyboard.press('Enter');
    await page.waitForSelector('#flow-view', { state: 'hidden' });
    await assertFocus(page, '#new-session', '#new-session after burning');
  });
});

// ---------- item 1: contents entries are buttons ----------

test('contents entries are buttons that Enter and Space open', { timeout: 120000 }, async () => {
  await withPage({ mindChoice: 'none' }, async (page) => {
    await openSeeded(page);

    const rows = page.locator('#toc-list li');
    assert.equal(await rows.count(), 2, 'two contents rows');
    for (let i = 0; i < 2; i++) {
      const entry = rows.nth(i).locator('> button.toc-entry');
      assert.equal(await entry.count(), 1, `row ${i} holds a button.toc-entry`);
      assert.equal(await entry.locator('.toc-title').count(), 1, 'title inside the button');
      assert.equal(await entry.locator('.toc-leader').count(), 1, 'leader inside the button');
      assert.equal(await entry.locator('.toc-date').count(), 1, 'date inside the button');
    }

    await page.locator('#toc-list .toc-entry').nth(0).focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('#flow-view', { state: 'visible' });
    await turnDone(page);
    await page.click('#back-to-toc');
    await page.waitForSelector('#flow-view', { state: 'hidden' });
    await turnDone(page);

    await page.locator('#toc-list .toc-entry').nth(1).focus();
    await page.keyboard.press('Space');
    await page.waitForSelector('#flow-view', { state: 'visible' });
    await turnDone(page);
  });
});

// ---------- item 2: focus management ----------

test('focus lands on New entry after opening the cover', { timeout: 120000 }, async () => {
  await withPage({ mindChoice: 'none' }, async (page) => {
    await page.goto(server.url);
    await openBook(page);
    await assertFocus(page, '#new-session', '#new-session');
  });
});

test('focus returns to the entry just left after ⟵ Contents', { timeout: 120000 }, async () => {
  await withPage({ mindChoice: 'none' }, async (page) => {
    await page.goto(server.url);
    await openBook(page);
    await newEntry(page);
    await say(page, 'Hello');
    await backToContents(page);
    await assertFocus(page, '.toc-entry', 'the .toc-entry of the entry just left');
    assert.equal(
      await page.evaluate(() => document.activeElement.closest('#toc-list li')?.classList.contains('active')),
      true,
      'focused row is the active entry',
    );
  });
});

test('focus lands on New entry after burning an entry', { timeout: 120000 }, async () => {
  await withPage({ mindChoice: 'none' }, async (page) => {
    await openSeeded(page);
    await openTitled(page, LONG);
    page.once('dialog', (d) => d.accept());
    await page.click('#delete-session');
    await page.waitForSelector('#flow-view', { state: 'hidden' });
    await assertFocus(page, '#new-session', '#new-session after burning');
  });
});

// ---------- item 4: page-turn overlay is hidden from assistive tech ----------

test('the page-turn overlay is aria-hidden', { timeout: 120000 }, async () => {
  await withPage({ mindChoice: 'none' }, async (page) => {
    await openSeeded(page);
    await page.locator('#toc-list li', { hasText: LONG }).click();
    await page.waitForSelector('.page-turn', { timeout: 3000 });
    assert.equal(await page.getAttribute('.page-turn', 'aria-hidden'), 'true');
    await pageTurned(page);
  });
});

// ---------- item 5: diary replies carry full text for screen readers ----------

test('a diary reply has visually hidden full text and an aria-hidden ink paragraph', { timeout: 120000 }, async () => {
  await withPage({ mindChoice: 'none' }, async (page) => {
    await page.goto(server.url);
    await openBook(page);
    await newEntry(page);
    await say(page, 'Hello');

    const info = await page.evaluate(() => {
      const d = [...document.querySelectorAll('#entries .entry.diary')].at(-1);
      const sr = d?.querySelector('.sr-only');
      const ink = d?.querySelector('.ink');
      return {
        hasSr: !!sr,
        srText: sr?.textContent ?? null,
        inkText: ink?.textContent ?? null,
        inkHidden: ink?.getAttribute('aria-hidden') ?? null,
      };
    });
    const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
    assert.equal(info.hasSr, true, 'the reply holds a .sr-only element');
    assert.ok(norm(info.srText).length > 0, 'the .sr-only text is not empty');
    assert.equal(norm(info.srText), norm(info.inkText), 'the .sr-only text equals the visible reply');
    assert.equal(info.inkHidden, 'true', 'the decorative .ink is aria-hidden once written');
  });
});

// ---------- item 6: reduced motion writes nothing out letter by letter ----------

test('with reduced motion a reply appears in full at once', { timeout: 120000 }, async () => {
  await withPage({ mindChoice: 'none' }, async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(server.url);
    await openBook(page);
    await newEntry(page);

    const before = await page.locator('#entries .entry.diary').count();
    await page.fill('#entry-input', 'Hello');
    await page.press('#entry-input', 'Enter');
    await page.waitForFunction((n) => document.querySelectorAll('#entries .entry.diary').length > n, before, { timeout: 30000 });

    const full = await page.waitForFunction(() => {
      const d = [...document.querySelectorAll('#entries .entry.diary')].at(-1);
      const ink = d?.querySelector('.ink');
      return !!ink && !ink.classList.contains('writing') && ink.textContent.trim().length > 0;
    }, null, { timeout: 300, polling: 10 }).then(() => true, () => false);
    assert.ok(full, 'the full reply is present within 300 ms of arriving, and not still writing');

    await page.waitForTimeout(250);
    assert.equal(await page.locator('#entries .ink.writing').count(), 0, 'no .ink.writing state lingers');
  });
});

// ---------- item 7: toggles on the contents page ----------

test('the Sound, Candle and Plain ink toggles have static names and toggle aria-pressed', { timeout: 120000 }, async () => {
  await withPage({ mindChoice: 'none' }, async (page) => {
    await page.goto(server.url);
    await openBook(page);
    for (const name of ['Sound', 'Candle', 'Plain ink']) {
      const toggle = page.getByRole('button', { name, exact: true });
      assert.equal(await toggle.count(), 1, `a button named "${name}"`);
      const before = await toggle.getAttribute('aria-pressed');
      assert.ok(before === 'true' || before === 'false', `"${name}" has aria-pressed`);
      await toggle.click();
      assert.notEqual(await toggle.getAttribute('aria-pressed'), before, `"${name}" aria-pressed flips on click`);
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-pressed'), before, `"${name}" flips back`);
    }
  });
});

test('Candle off stops the candle flicker', { timeout: 120000 }, async () => {
  await withPage({ mindChoice: 'none' }, async (page) => {
    await page.goto(server.url);
    await openBook(page);
    const candle = page.getByRole('button', { name: 'Candle', exact: true });
    if ((await candle.getAttribute('aria-pressed')) === 'true') await candle.click();
    assert.equal(await candle.getAttribute('aria-pressed'), 'false');

    const off = await page.evaluate(() => {
      const el = document.getElementById('candle');
      return !el || el.classList.contains('off') || getComputedStyle(el).display === 'none';
    });
    assert.equal(off, true, '#candle is off (class "off", hidden or removed)');

    const sample = () => page.evaluate(() => document.getElementById('candle')?.style.getPropertyValue('--candle-intensity') ?? '');
    const first = await sample();
    await page.waitForTimeout(1500);
    assert.equal(await sample(), first, 'the candle intensity no longer changes');
  });
});

test('Plain ink is on the html element and persists across reloads', { timeout: 120000 }, async () => {
  await withPage({ mindChoice: 'none' }, async (page) => {
    await page.goto(server.url);
    await openBook(page);
    const plain = page.getByRole('button', { name: 'Plain ink', exact: true });
    const initial = await plain.getAttribute('aria-pressed');
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('plain-ink')), initial === 'true');

    if (initial !== 'true') await plain.click();
    assert.equal(await plain.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('plain-ink')), true);

    await page.reload();
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('plain-ink')), true, 'plain ink survives a reload');
    await openBook(page);
    assert.equal(await page.getByRole('button', { name: 'Plain ink', exact: true }).getAttribute('aria-pressed'), 'true');
  });
});

// ---------- item 8: touch targets at phone width ----------

test('every control is at least 24x24 CSS px at 390x844', { timeout: 120000 }, async () => {
  await withPage({ viewport: PHONE, mindChoice: 'none' }, async (page) => {
    await page.goto(server.url);
    await assertTargets(page, ['#cover']);
    await seedEntries(page);
    await openBook(page);
    await page.waitForSelector('#mind-control:not([hidden])');
    await assertTargets(page, [
      '#new-session', '#toc-list .toc-entry', '#mind-control',
      '#sound-toggle', '#candle-toggle', '#plain-toggle',
    ]);
    await openTitled(page, LONG);
    await assertTargets(page, ['#back-to-toc', '#prev-spread', '#next-spread', '#delete-session']);
  });
});

// ---------- item 9: visible keyboard focus ----------

async function focusStyle(page) {
  return page.evaluate(() => {
    const s = getComputedStyle(document.activeElement);
    return { outline: s.outlineStyle, shadow: s.boxShadow, deco: s.textDecorationLine };
  });
}

async function assertVisibleFocus(page, selector, label, text = '') {
  await page.evaluate(() => document.activeElement?.blur());
  const before = await page.evaluate((s) => {
    const el = document.querySelector(s);
    const cs = el ? getComputedStyle(el) : null;
    return cs ? { outline: cs.outlineStyle, shadow: cs.boxShadow, deco: cs.textDecorationLine } : null;
  }, selector);
  assert.ok(before, `${label} exists`);
  assert.ok(await tabUntil(page, selector, text), `Tab reaches ${label}`);
  const after = await focusStyle(page);
  const indicated = after.outline !== 'none' || after.shadow !== 'none' || after.deco !== 'none';
  const changed = after.outline !== before.outline || after.shadow !== before.shadow || after.deco !== before.deco;
  assert.ok(indicated && changed, `${label} shows a focus indicator (before ${JSON.stringify(before)}, focused ${JSON.stringify(after)})`);
}

test('keyboard focus is visible on every key control', { timeout: 120000 }, async () => {
  await withPage({ mindChoice: 'none' }, async (page) => {
    await openSeeded(page);
    await assertVisibleFocus(page, '.toc-entry', '.toc-entry');
    await assertVisibleFocus(page, '#new-session', '#new-session');

    await openTitled(page, LONG);
    await assertVisibleFocus(page, '#entry-input', '#entry-input');
    await assertVisibleFocus(page, '#back-to-toc', '#back-to-toc');

    // an entry opens on its last spread, so prev-spread is enabled and focusable
    await assertVisibleFocus(page, '#prev-spread', '#prev-spread');
  });
});

// ---------- item 10: heading structure ----------

test('exactly one h1 and no heading-order violations', { timeout: 120000 }, async () => {
  await withPage({ mindChoice: 'none' }, async (page) => {
    await openSeeded(page);
    const headingOrder = { runOnly: { type: 'rule', values: ['heading-order'] } };
    assert.equal(await page.locator('h1').count(), 1, 'contents view: one h1');
    assert.deepEqual(await axeViolations(page, headingOrder), [], 'contents view: heading-order');

    await openTitled(page, LONG);
    assert.equal(await page.locator('h1').count(), 1, 'entry view: one h1');
    assert.deepEqual(await axeViolations(page, headingOrder), [], 'entry view: heading-order');
  });
});

// ---------- 200% text ----------

for (const [label, viewport] of VIEWPORTS) {
  test(`200% text: contents and entry views scroll nothing sideways and keep controls on screen, ${label}`, { timeout: 120000 }, async () => {
    await withPage({ viewport, mindChoice: 'none' }, async (page) => {
      await openSeeded(page);
      await page.addStyleTag({ content: 'html { font-size: 200% !important }' });
      await assertNoHorizontalScroll(page, 'contents at 200%');
      await assertInsideViewport(page, ['#new-session']);

      await page.click('#new-session');
      await page.waitForSelector('#flow-view', { state: 'visible' });
      await pageTurned(page);
      await assertNoHorizontalScroll(page, 'entry at 200%');
      await assertInsideViewport(page, ['#entry-input', '#back-to-toc']);
    });
  });
}

// ---------- text spacing (WCAG 1.4.12) ----------

for (const [label, viewport] of VIEWPORTS) {
  test(`text spacing: a reply survives extra spacing without overflow, ${label}`, { timeout: 120000 }, async () => {
    await withPage({ viewport, mindChoice: 'none' }, async (page) => {
      await page.goto(server.url);
      await openBook(page);
      await newEntry(page);
      await say(page, 'Hello');

      await page.addStyleTag({
        content: `* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }`,
      });
      await assertNoHorizontalScroll(page, 'entry with text spacing');
      await page.waitForSelector('#spread-label');
      const srText = await page.evaluate(() => {
        const d = [...document.querySelectorAll('#entries .entry.diary')].at(-1);
        return d?.querySelector('.sr-only')?.textContent?.trim() ?? '';
      });
      assert.ok(srText.length > 0, 'the last reply’s full text is present');
    });
  });
}
