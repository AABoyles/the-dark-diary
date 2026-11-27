// js/candle.js — a warm, flickering candlelight vignette over the desk and book
// (issues #23, #44).
//
// One fixed, click-through overlay (#candle) with three pre-blended layers: a
// static edge vignette, a warm glow and a faint dimming layer. The flicker is
// pure CSS (css/atmosphere.css): @keyframes on opacity and transform only, so
// the compositor animates it without repainting the page — no JavaScript timer,
// no mix-blend-mode. Paused while the tab is hidden or the book is closed (CSS
// :has), static under prefers-reduced-motion, and it can be put out entirely
// (the Candle setting, WCAG 2.2.2).

const ID = 'candle';

let el = null;
let thinking = false;
let onVisibility = null;

/** Light the candle (idempotent). */
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
      if (!el.firstChild) {
        for (const name of ['candle-vignette', 'candle-glow', 'candle-shadow']) {
          const layer = document.createElement('div');
          layer.className = name;
          el.appendChild(layer);
        }
      }
    }
    document.body.appendChild(el); // keeps it the last child of <body>
    el.classList.toggle('thinking', thinking);
    el.classList.toggle('paused', document.hidden);
    if (!onVisibility) {
      onVisibility = () => el?.classList.toggle('paused', document.hidden);
      document.addEventListener('visibilitychange', onVisibility);
    }
  } catch { /* no DOM: nothing to light */ }
}

/** While the diary composes a reply the flame leans in: brighter, quicker. */
export function setThinking(on) {
  thinking = Boolean(on);
  el?.classList.toggle('thinking', thinking);
}

/** Put the candle out. */
export function stopCandle() {
  if (onVisibility) {
    document.removeEventListener('visibilitychange', onVisibility);
    onVisibility = null;
  }
  (el ?? (typeof document !== 'undefined' ? document.getElementById(ID) : null))?.remove();
  el = null;
}
