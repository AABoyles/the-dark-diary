// Performance budgets for issues #44 (the candle repainting the page) and #45 (DOM cost).
// The measurements live in scripts/measure-perf.mjs; these tests assert the budgets.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch } from './helpers.mjs';
import {
  measureIdleCandle,
  withSeededEntry,
  measureEntryDom,
  measureTurnAndTyping,
} from '../../scripts/measure-perf.mjs';

// Budgets (issues #44, #45), each about 2x the value measured after the fixes, so CI on a
// slower runner doesn't flake but a regression is caught. Measured with
// scripts/measure-perf.mjs (before -> after): idle Paint events ~390 -> 0; elements in a
// 40-exchange entry 6524 -> 1468; letter spans 5060 -> 0; longest page-turn task at
// CPU 4x 3.3-3.9 s -> ~230 ms; worst keydown/input event at CPU 4x 400-700 ms -> ~96 ms.
const PAINT_EVENTS_IDLE_MAX = 10;     // Paint events during 5 s of idle with the book open
const LAYOUT_EVENTS_IDLE_MAX = 2;     // Layout events during the same idle window
const DOM_ELEMENTS_MAX = 3000;        // all elements after opening a 40-exchange entry
const CH_ELEMENTS_MAX = 50;           // per-letter spans after opening it (only text being written may have them)
const TURN_LONGEST_TASK_MS_MAX = 500; // longest main-thread task during a page turn, CPU 4x
const KEY_EVENT_MS_MAX = 200;         // worst keydown or input event duration while typing, CPU 4x

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

test('idle candle does not repaint the page', { timeout: 120000 }, async () => {
  const idle = await measureIdleCandle(browser, server.url);
  assert.ok(
    idle.paintEvents <= PAINT_EVENTS_IDLE_MAX,
    `Paint events while idle: ${idle.paintEvents} (budget ${PAINT_EVENTS_IDLE_MAX})`,
  );
  assert.ok(
    idle.layoutEvents <= LAYOUT_EVENTS_IDLE_MAX,
    `Layout events while idle: ${idle.layoutEvents} (budget ${LAYOUT_EVENTS_IDLE_MAX})`,
  );
});

test('a 40-exchange entry stays light', { timeout: 120000 }, async () => {
  const dom = await withSeededEntry(browser, server.url, (page) => measureEntryDom(page));
  assert.ok(dom.domNodes <= DOM_ELEMENTS_MAX, `DOM elements: ${dom.domNodes} (budget ${DOM_ELEMENTS_MAX})`);
  assert.ok(dom.chNodes <= CH_ELEMENTS_MAX, `.ch elements: ${dom.chNodes} (budget ${CH_ELEMENTS_MAX})`);
});

test('page turns and typing stay responsive (CPU 4x)', { timeout: 180000 }, async () => {
  const result = await withSeededEntry(browser, server.url, (page) => measureTurnAndTyping(page));
  assert.ok(
    result.turnLongestTaskMs <= TURN_LONGEST_TASK_MS_MAX,
    `longest task during a page turn: ${result.turnLongestTaskMs.toFixed(0)} ms (budget ${TURN_LONGEST_TASK_MS_MAX})`,
  );
  const worstKey = Math.max(result.keydown.max, result.input.max);
  assert.ok(
    worstKey <= KEY_EVENT_MS_MAX,
    `slowest keydown/input while typing: ${worstKey.toFixed(0)} ms (budget ${KEY_EVENT_MS_MAX})`,
  );
});
