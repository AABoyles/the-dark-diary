// effects.js - small visual effects for the diary's ink (issue #19).
//
// Exports:
//   playAnagram(inkEl, name, { rand, holdMs }) -> Promise<void>
//     The letters of `name` (first occurrence in the paragraph, case-insensitive)
//     travel into the order given by scrambleName(), hold, travel back, and the
//     paragraph's original plain text is restored. Resolves when done. Does nothing
//     under prefers-reduced-motion, and never throws.

import { scrambleName } from './eggs.js';

const MOVE_MS = 900;   // one journey; matches the CSS transition in css/effects.css
const LETTER = /\p{L}/u;

const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

function reducedMotion() {
  try {
    return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Wraps each letter of the first occurrence of `name` in <span class="anagram-ch">.
 * Returns the letter spans in reading order, or null when the name is not present.
 */
function wrapLetters(inkEl, name) {
  const text = inkEl.textContent;
  const at = text.toLowerCase().indexOf(name.toLowerCase());
  if (at < 0) return null;
  const end = at + name.length;

  const frag = document.createDocumentFragment();
  const spans = [];
  const plain = (s) => { if (s) frag.append(document.createTextNode(s)); };
  plain(text.slice(0, at));
  for (const ch of text.slice(at, end)) {
    if (!LETTER.test(ch)) { plain(ch); continue; }
    const span = document.createElement('span');
    span.className = 'anagram-ch';
    span.textContent = ch;
    span.style.display = 'inline-block';
    spans.push(span);
    frag.append(span);
  }
  plain(text.slice(end));
  inkEl.replaceChildren(frag);
  return spans;
}

/**
 * For each slot j of the target arrangement, the index of the span that belongs
 * there. Letters are matched case-insensitively, so the result is a permutation.
 */
function targetOrder(spans, target) {
  const used = new Array(spans.length).fill(false);
  const order = [];
  for (const ch of target) {
    const lower = ch.toLowerCase();
    const i = spans.findIndex((s, k) => !used[k] && s.textContent.toLowerCase() === lower);
    if (i < 0) return null;
    used[i] = true;
    order.push(i);
  }
  return order.length === spans.length ? order : null;
}

function centres(spans) {
  return spans.map((s) => {
    const r = s.getBoundingClientRect();
    return r.left + r.width / 2;
  });
}

/** Moves every span so that its centre sits over the slot given by `order`. */
function moveTo(spans, slotX, order) {
  // order[j] = span that should sit in slot j; so span order[j] goes to slotX[j]
  const dest = new Array(spans.length);
  order.forEach((spanIndex, slot) => { dest[spanIndex] = slot; });
  const here = centres(spans);
  spans.forEach((s, i) => {
    s.style.transform = `translateX(${(slotX[dest[i]] - here[i]).toFixed(2)}px)`;
  });
}

function resetMoves(spans) {
  for (const s of spans) s.style.transform = '';
}

/**
 * Animates the letters of `name` inside `inkEl`. See the module comment.
 */
export async function playAnagram(inkEl, name, { rand = Math.random, holdMs = 1600 } = {}) {
  try {
    if (!inkEl || !name || reducedMotion()) return;
    const original = inkEl.textContent;
    const spans = wrapLetters(inkEl, String(name));
    if (!spans || spans.length < 2) {
      if (spans) inkEl.textContent = original;
      return;
    }

    try {
      const target = scrambleName(String(name), rand);
      const order = targetOrder(spans, target);
      if (!order) return;

      // Slot centres in the original arrangement, measured before any movement.
      const slotX = centres(spans);
      for (const s of spans) s.style.transition = `transform ${MOVE_MS}ms ease-in-out`;
      inkEl.classList.add('anagram-moving');

      void inkEl.offsetWidth; // settle the start state so the transition runs
      moveTo(spans, slotX, order);
      await wait(MOVE_MS);

      await wait(Math.max(0, holdMs));

      resetMoves(spans);
      await wait(MOVE_MS);
    } finally {
      inkEl.classList.remove('anagram-moving');
      inkEl.textContent = original;
    }
  } catch {
    // effects are decoration: a failure leaves the text as it was
  }
}
