// js/candle.js — a warm, flickering candlelight vignette over the desk and book (issue #23).
//
// One fixed, click-through overlay (#candle). The flicker only changes CSS custom
// properties on that element, on an irregular setTimeout (no rAF loop). The
// browser transitions opacity and background-position, which keeps it smooth.
// Paused while the page is hidden. Under prefers-reduced-motion it renders one
// static, warm vignette and never changes.

const ID = 'candle';
const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

let el = null;
let timer = null;
let thinking = false;
let onVisibility = null;

const rand = (min, max) => min + Math.random() * (max - min);

function reducedMotion() {
  try {
    return globalThis.matchMedia?.(REDUCED_QUERY)?.matches === true;
  } catch {
    return false;
  }
}

function paint() {
  if (!el) return;
  if (reducedMotion()) {
    el.style.setProperty('--candle-intensity', '0.92');
    el.style.setProperty('--candle-x', '0px');
    el.style.setProperty('--candle-y', '0px');
    return;
  }
  el.style.setProperty('--candle-intensity', rand(0.85, 1).toFixed(3));
  el.style.setProperty('--candle-x', `${rand(-6, 6).toFixed(2)}px`);
  el.style.setProperty('--candle-y', `${rand(-4, 4).toFixed(2)}px`);
}

function canFlicker() {
  return Boolean(el) && !document.hidden && !reducedMotion();
}

function schedule() {
  clearTimeout(timer);
  timer = null;
  if (!canFlicker()) return;
  timer = setTimeout(tick, thinking ? rand(50, 140) : rand(80, 260));
}

function tick() {
  timer = null;
  if (!canFlicker()) {
    paint(); // reduced motion: settle on the static values
    return;
  }
  paint();
  schedule();
}

/** Creates the candle overlay (once) and starts its flicker. Calling it again is harmless. */
export function startCandle() {
  try {
    if (typeof document === 'undefined' || !document.body) return;
    if (!el) {
      el = document.getElementById(ID) ?? document.createElement('div');
      el.id = ID;
      el.setAttribute('aria-hidden', 'true');
      // Essential layout is inline too, so a missing stylesheet can never block clicks.
      el.style.position = 'fixed';
      el.style.inset = '0';
      el.style.pointerEvents = 'none';
    }
    document.body.appendChild(el); // keeps it the last child of <body>
    el.classList.toggle('thinking', thinking);
    paint();
    if (!onVisibility) {
      onVisibility = () => {
        if (document.hidden) {
          clearTimeout(timer);
          timer = null;
        } else {
          schedule();
        }
      };
      document.addEventListener('visibilitychange', onVisibility);
    }
    schedule();
  } catch { /* no DOM: nothing to light */ }
}

/** While the diary composes a reply: the light brightens a little and flickers faster. */
export function setThinking(on) {
  thinking = Boolean(on);
  if (!el) return;
  el.classList.toggle('thinking', thinking);
  schedule();
}

/** Removes the timers, the listener and the element. */
export function stopCandle() {
  clearTimeout(timer);
  timer = null;
  if (onVisibility) {
    document.removeEventListener('visibilitychange', onVisibility);
    onVisibility = null;
  }
  (el ?? (typeof document !== 'undefined' ? document.getElementById(ID) : null))?.remove();
  el = null;
}
