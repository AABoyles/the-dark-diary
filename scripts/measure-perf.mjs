#!/usr/bin/env node
// Performance measurements for the diary (issues #44 candle repaints, #45 DOM cost).
//
//   NODE_PATH=$(npm root -g) node scripts/measure-perf.mjs [repoDir] [--out file.json]
//
// repoDir defaults to the repository this file lives in. --out defaults to
// ./perf-results.json in the current directory. The app is served from repoDir
// with a small static server, every page is kept offline, and the diary always
// falls back to its scripted engine, so runs are comparable.
//
// The measurement functions are exported so tests/e2e/perf.test.mjs can reuse them.
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

// Model, font and CDN hosts are aborted so every run is offline and deterministic.
const BLOCKED_HOST = /^(cdn\.jsdelivr\.net|huggingface\.co|(.+\.)?hf\.co|fonts\..+)$/;

const TRACE_CATEGORIES = ['devtools.timeline', 'disabled-by-default-devtools.timeline'];
const THROTTLE_RATE = 4;
const IDLE_MS = 5000;

/** Serves a directory on an ephemeral port. Resolves to { url, close() }. */
export function serveDir(root) {
  const base = resolve(root);
  const server = createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      let rel = decodeURIComponent(pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const file = resolve(base, '.' + rel);
      if (file !== base && !file.startsWith(base + sep)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      ok({
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise((done) => {
          server.closeAllConnections?.();
          server.close(() => done());
        }),
      });
    });
  });
}

/** A fresh context and page with the offline routes and a 'none' mind pre-chosen. */
export async function newPage(browser, { viewport = { width: 1280, height: 800 } } = {}) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  await context.route((url) => BLOCKED_HOST.test(url.hostname), (route) => route.abort());
  await context.addInitScript(() => {
    try {
      if (!localStorage.getItem('dd-mind')) {
        localStorage.setItem('dd-mind', JSON.stringify({ choice: 'none', at: Date.now(), auto: false }));
      }
    } catch { /* storage blocked */ }
  });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (err) => page.errors.push(err.message));
  return page;
}

async function openBook(page, baseUrl) {
  await page.goto(baseUrl);
  await page.click('#cover');
  await page.waitForSelector('#book.open');
  await page.waitForSelector('#toc-page', { state: 'visible' });
  await waitTurnDone(page);
}

async function waitTurnDone(page) {
  await page.waitForFunction(
    () => !document.querySelector('.page-turn') && !document.querySelector('#book[data-navigating]'),
    null,
    { timeout: 30000 },
  );
}

/** Turns the page with the given button and returns the wall time from click until no leaf is mid-turn. */
async function turnAndTime(page, selector) {
  const t0 = performance.now(); // Node clock: the click's round trip is part of the wall time
  await page.click(selector);
  await page.waitForFunction(() => !document.querySelector('.page-turn'), null, { timeout: 30000 });
  const wallMs = performance.now() - t0;
  await waitTurnDone(page);
  return wallMs;
}

// Long-task and event-timing observers, kept on window so each phase can filter by its start time.
async function installObservers(page) {
  await page.evaluate(() => {
    window.__longtasks = [];
    window.__events = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__longtasks.push({ start: e.startTime, dur: e.duration });
    }).observe({ type: 'longtask', buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.name === 'keydown' || e.name === 'input') window.__events.push({ name: e.name, start: e.startTime, dur: e.duration });
      }
    }).observe({ type: 'event', durationThreshold: 16, buffered: false });
  });
}

async function longTasksSince(page, mark) {
  return page.evaluate((t) => window.__longtasks.filter((x) => x.start >= t).map((x) => x.dur), mark);
}

async function now(page) {
  return page.evaluate(() => performance.now());
}

function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const median = n === 0 ? 0 : n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  return { n, max: n ? sorted[n - 1] : 0, median };
}

function metricMap(result) {
  return Object.fromEntries(result.metrics.map((m) => [m.name, m.value]));
}

/**
 * (a) Idle candle cost. Opens the book, waits 1.5 s, then traces 5 s of idle.
 * Counts Paint, style recalc (UpdateLayoutTree) and Layout events from the page's renderer,
 * and reads LayoutCount / RecalcStyleCount over the same window via CDP.
 */
export async function measureIdleCandle(browser, baseUrl, { idleMs = IDLE_MS } = {}) {
  const page = await newPage(browser);
  try {
    await openBook(page, baseUrl);
    await page.waitForTimeout(1500);

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const before = metricMap(await cdp.send('Performance.getMetrics'));

    await browser.startTracing(page, { categories: TRACE_CATEGORIES });
    await page.waitForTimeout(idleMs);
    const traceBuffer = await browser.stopTracing();

    const after = metricMap(await cdp.send('Performance.getMetrics'));
    const parsed = JSON.parse(traceBuffer.toString());
    let events = Array.isArray(parsed) ? parsed : parsed.traceEvents;
    // keep only the page's renderer process (the browser and GPU processes also trace)
    const renderer = events.find((e) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain');
    if (renderer) events = events.filter((e) => e.pid === renderer.pid);

    const count = (name) => events.filter((e) => e.name === name && (e.ph === 'X' || e.ph === 'B')).length;
    const ms = (name) => events.filter((e) => e.name === name && e.dur).reduce((sum, e) => sum + e.dur, 0) / 1000;

    return {
      idleMs,
      paintEvents: count('Paint'),
      styleRecalcEvents: count('UpdateLayoutTree'),
      layoutEvents: count('Layout'),
      paintMs: ms('Paint'),
      rasterMs: ms('RasterTask'),
      layoutCountDelta: after.LayoutCount - before.LayoutCount,
      recalcStyleCountDelta: after.RecalcStyleCount - before.RecalcStyleCount,
      pageErrors: page.errors.length,
    };
  } finally {
    await page.context().close();
  }
}

// A 40-exchange conversation with realistic lengths; every 4th diary line has strike markup.
const USER_LINES = [
  'I keep thinking about the dinner party and who I should invite, and whether anyone will come at all.',
  'My sister says I am overthinking it, but she always says that about everything I care about.',
  'The table is too small and the chairs do not match, and I am embarrassed about the whole arrangement.',
  'What if nobody talks to each other and the evening is just a long stretch of polite nodding?',
  'I bought far too much cheese, which is either generous or a sign that I am anxious about the guests.',
  'Maybe I should cancel and say I am unwell, though that would be a small lie told to avoid a large fear.',
  'Honestly I just want one evening where the people I love sit together and forget their phones.',
  'I cannot decide between the lamb and the lentils, and every time I choose one I doubt the other.',
];
const DIARY_LINES = [
  'Guests are a delicate ingredient, so invite only those whose absence would be noticed, and keep the number small enough to hear one another across the table.',
  'You speak of the meal as though it were a duty; try instead to ~~devour~~ enjoy it, one course at a time, with the lamps lit and nobody checking the clock.',
  'Worry is a guest that never leaves its coat on the hook. Notice it, offer it a chair, and then go back to the cooking you actually care about.',
  'The silence you dread is only the sound of people chewing and thinking, which is among the more pleasant noises a room can make on an ordinary evening.',
  'Remember that the table does not need to be perfect; it needs to be warm, and a cracked plate served with honesty is worth more than a set of matching ones.',
  'Ask yourself who you would call at midnight if the soup boiled over, and then invite that person first, before the list grows long and the question becomes a burden.',
  'Some evenings the kindest thing is to ~~devour~~ enjoy a quiet meal alone with a book, and let the dinner party wait for a season when your heart is lighter.',
  'Your hands are restless because your mind is already at the door, counting arrivals. Put the knife down, pour a glass of water, and let the first knock surprise you.',
];

/** The seeded conversation: 40 user and 40 diary messages, stored the way the app stores them. */
export function buildMessages(exchanges = 40) {
  const messages = [];
  const start = Date.now() - exchanges * 120000;
  for (let i = 0; i < exchanges; i++) {
    messages.push({ role: 'user', text: USER_LINES[i % USER_LINES.length], ts: start + i * 120000 });
    messages.push({ role: 'diary', text: DIARY_LINES[i % DIARY_LINES.length], ts: start + i * 120000 + 60000 });
  }
  return messages;
}

/**
 * Opens a seeded 40-exchange entry with CPU throttled 4x, then calls fn(page, cdp).
 * Seeding goes through the app's own IndexedDB module, as tests/e2e/pageturn.test.mjs does.
 */
export async function withSeededEntry(browser, baseUrl, fn) {
  const page = await newPage(browser);
  try {
    await openBook(page, baseUrl);
    const messages = buildMessages();
    await page.evaluate(async (msgs) => {
      const db = await import('./js/db.js');
      const s = await db.createSession();
      s.title = 'The Dinner Party, Again';
      s.messages = msgs;
      await db.saveSession(s);
    }, messages);
    await page.reload();
    await openBook(page, baseUrl);

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE_RATE });

    await page.locator('#toc-list li').first().click();
    await page.waitForSelector('#flow-view', { state: 'visible' });
    await waitTurnDone(page);
    return await fn(page, cdp);
  } finally {
    await page.context().close();
  }
}

/** (b) DOM size of the opened 40-exchange entry. */
export async function measureEntryDom(page) {
  return page.evaluate(() => ({
    domNodes: document.getElementsByTagName('*').length,
    chNodes: document.querySelectorAll('.ch').length,
    wNodes: document.querySelectorAll('.w').length,
  }));
}

/**
 * (b) Page turn and typing cost on the 40-exchange entry (CPU 4x).
 * Longest long task during a page turn back a spread; wall time of the turn;
 * keydown and input event durations while typing 20 characters.
 */
export async function measureTurnAndTyping(page) {
  await installObservers(page);

  const turnMark = await now(page);
  const turnWallMs = await turnAndTime(page, '#prev-spread');
  const turnTasks = await longTasksSince(page, turnMark);

  // the writing box sits at the end of the entry: turn back to the last spread to type
  await turnAndTime(page, '#next-spread');
  const typed = 'I keep thinking of it'.slice(0, 20);
  await page.focus('#entry-input');
  const typeMark = await now(page);
  await page.keyboard.type(typed, { delay: 50 });
  await page.waitForTimeout(500); // event timing entries arrive asynchronously
  const typeTasks = await longTasksSince(page, typeMark);
  const events = await page.evaluate((t) => window.__events.filter((e) => e.start >= t), typeMark);
  await page.fill('#entry-input', '');

  const keydown = summary(events.filter((e) => e.name === 'keydown').map((e) => e.dur));
  const input = summary(events.filter((e) => e.name === 'input').map((e) => e.dur));
  return {
    turnWallMs,
    turnLongestTaskMs: Math.max(0, ...turnTasks),
    turnLongTaskCount: turnTasks.length,
    typedChars: typed.length,
    keydown,
    input,
    typingLongestTaskMs: Math.max(0, ...typeTasks),
    typingLongTaskCount: typeTasks.length,
    pageErrors: page.errors.length,
  };
}

/**
 * (c) Desktop, no throttle. A new entry, then 'hello there' + Enter: the longest task and the
 * total long-task time from submit until the reply's ink is done.
 */
export async function measureReply(browser, baseUrl) {
  const page = await newPage(browser);
  try {
    await openBook(page, baseUrl);
    await page.click('#new-session');
    await page.waitForSelector('#flow-view', { state: 'visible' });
    await page.waitForSelector('#entry-input:not([disabled])');
    await waitTurnDone(page);
    await installObservers(page);

    const t0 = await now(page);
    await page.fill('#entry-input', 'hello there');
    await page.press('#entry-input', 'Enter');
    await page.waitForSelector('#entries .entry.diary .ink.done', { timeout: 60000 });
    const t1 = await now(page);
    const tasks = await longTasksSince(page, t0);
    return {
      wallMs: t1 - t0,
      longestTaskMs: Math.max(0, ...tasks),
      totalLongTaskMs: tasks.reduce((a, b) => a + b, 0),
      longTaskCount: tasks.length,
      pageErrors: page.errors.length,
    };
  } finally {
    await page.context().close();
  }
}

/** Runs every measurement against a served app. */
export async function measureAll(browser, baseUrl) {
  const idleCandle = await measureIdleCandle(browser, baseUrl);
  const entry = await withSeededEntry(browser, baseUrl, async (page) => ({
    ...(await measureEntryDom(page)),
    ...(await measureTurnAndTyping(page)),
  }));
  const reply = await measureReply(browser, baseUrl);
  return { idleCandle, entry, reply };
}

function gitHead(repoDir) {
  try {
    return execFileSync('git', ['-C', repoDir, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function printTable(results) {
  const { idleCandle: a, entry: b, reply: c } = results.measurements;
  const rows = [
    ['(a) idle 5 s: Paint events', a.paintEvents],
    ['(a) idle 5 s: style recalc events (UpdateLayoutTree)', a.styleRecalcEvents],
    ['(a) idle 5 s: Layout events', a.layoutEvents],
    ['(a) idle 5 s: Paint + RasterTask ms', `${a.paintMs.toFixed(1)} + ${a.rasterMs.toFixed(1)}`],
    ['(a) idle 5 s: LayoutCount delta (CDP)', a.layoutCountDelta],
    ['(a) idle 5 s: RecalcStyleCount delta (CDP)', a.recalcStyleCountDelta],
    ['(b) DOM elements, 40-exchange entry', b.domNodes],
    ['(b) .ch elements', b.chNodes],
    ['(b) .w elements', b.wNodes],
    ['(b) page turn wall ms (CPU 4x)', b.turnWallMs.toFixed(0)],
    ['(b) page turn longest task ms (CPU 4x)', b.turnLongestTaskMs.toFixed(0)],
    ['(b) keydown event max / median ms (n)', `${b.keydown.max.toFixed(0)} / ${b.keydown.median.toFixed(0)} (${b.keydown.n})`],
    ['(b) input event max / median ms (n)', `${b.input.max.toFixed(0)} / ${b.input.median.toFixed(0)} (${b.input.n})`],
    ['(b) longest task while typing ms (CPU 4x)', b.typingLongestTaskMs.toFixed(0)],
    ['(c) reply wall ms (submit to ink done)', c.wallMs.toFixed(0)],
    ['(c) reply longest task ms', c.longestTaskMs.toFixed(0)],
    ['(c) reply total long-task ms', c.totalLongTaskMs.toFixed(0)],
  ];
  const width = Math.max(...rows.map(([k]) => k.length));
  console.log(`\nDiary perf, ${results.repo} @ ${results.head ?? 'unknown'} (chromium ${results.chromium})`);
  console.log('-'.repeat(width + 16));
  for (const [k, v] of rows) console.log(`${k.padEnd(width)}  ${String(v).padStart(14)}`);
  console.log('');
}

async function main() {
  const args = process.argv.slice(2);
  let repoDir = REPO_ROOT;
  let out = resolve('perf-results.json');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') out = resolve(args[++i]);
    else repoDir = resolve(args[i]);
  }

  const { chromium } = require('playwright');
  const server = await serveDir(repoDir);
  const browser = await chromium.launch();
  let measurements;
  const chromiumVersion = browser.version();
  try {
    measurements = await measureAll(browser, server.url);
  } finally {
    await browser.close();
    await server.close();
  }

  const results = {
    timestamp: new Date().toISOString(),
    repo: repoDir,
    head: gitHead(repoDir),
    node: process.version,
    chromium: chromiumVersion,
    cpuThrottle: THROTTLE_RATE,
    measurements,
  };
  printTable(results);
  await writeFile(out, JSON.stringify(results, null, 2) + '\n');
  console.log(`JSON written to ${out}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
