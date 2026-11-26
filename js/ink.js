// InkWriter: the diary's reply writes itself onto the page, one character at a
// time, at the diary's own pace (CHAR_DELAY_MS per character), whether the text
// arrives all at once or streams in piece by piece (issue #7).
//
//   const w = new InkWriter(p, { onProgress });
//   w.append('Washing blood ');      // as pieces stream in
//   w.append('from a silk shirt.');
//   await w.finish(finalText);       // reconcile with the final text, resolve when written
//
// Each character is a <span class="ch"> that animates in (see css: .ink.writing .ch).
// Strike-through markup "~~cruel~~ gentle" (issue #13) is written as the cruel
// word, then a line drawn through it, a short pause, and the gentler word.
// When finished, the paragraph collapses to its final markup (renderInk) with class "done".
//
// Hand-written look (issue #22): every letter carries a small deterministic tilt,
// bob and weight (handFor), chosen from a seed so that streaming and the final
// render agree. Letters of a word sit in a nowrap <span class="w"> so words never
// break across lines. About one message in five gets an ink blot (blotFor).

import { parseStrikes } from './strike.js';

export const CHAR_DELAY_MS = 38;
const STRIKE_PAUSE_MS = 520;
const BLOT_CHANCE = 0.2;

// ---- deterministic randomness -------------------------------------------

// xmur3: string -> 32-bit hash generator (seeds mulberry32).
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

// mulberry32: small PRNG returning floats in [0, 1).
function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomFor(key) {
  return mulberry32(xmur3(key)());
}

const round3 = (x) => Math.round(x * 1000) / 1000;

/** A stable 32-bit integer hash (FNV-1a) of the message text. */
export function seedFor(text) {
  let h = 2166136261;
  for (const ch of String(text ?? '')) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * The hand of one character: tilt in degrees (±2.2), vertical bob in em
 * (±0.06 jitter plus a slow baseline drift of about 0.05em), and weight 0.82–1.0.
 * `pos` is the letter's place in its word (0 = first); the first two letters of
 * a word are written darker, as if the pen were freshly dipped.
 * @param {number|string} seed
 * @param {number} index  position of the character in the visible text
 * @param {{pos?: number}} [options]
 * @returns {{rot: number, dy: number, weight: number}}
 */
export function handFor(seed, index, { pos = 99 } = {}) {
  const rand = randomFor(`${seed}:${index}`);
  const phase = randomFor(`${seed}:drift`)() * Math.PI * 2;
  const rot = (rand() * 2 - 1) * 2.2;
  const jitter = (rand() * 2 - 1) * 0.06;
  const drift = 0.05 * Math.sin(index * 0.35 + phase);
  let weight = 0.82 + rand() * 0.13;
  if (pos < 2) weight = Math.min(1, weight + 0.1);
  return { rot: round3(rot), dy: round3(jitter + drift), weight: round3(weight) };
}

/**
 * The ink blot for a message, or null. About one seed in five has one.
 * Size in em, offset from the right edge in %, offset from the bottom in em, rotation in degrees.
 * @param {number|string} seed
 * @returns {{size: number, right: number, bottom: number, rot: number} | null}
 */
export function blotFor(seed) {
  const rand = randomFor(`${seed}:blot`);
  if (rand() >= BLOT_CHANCE) return null;
  return {
    size: round3(0.5 + rand() * 0.4),
    right: round3(2 + rand() * 12),
    bottom: round3(-0.35 + rand() * 0.4),
    rot: round3(rand() * 360),
  };
}

const randomSeed = () => Math.floor(Math.random() * 0x100000000);

// ---- placing characters -------------------------------------------------

function createHand(seed) {
  return { seed, index: 0, pos: 0, word: null };
}

/**
 * Appends one visible character to `parent`. Spaces are plain text nodes so the
 * line can wrap; letters go into the current word's nowrap span. Returns the
 * <span class="ch"> for a letter, or null for a space.
 */
function placeChar(hand, parent, ch) {
  if (ch === ' ') {
    parent.appendChild(document.createTextNode(' '));
    hand.word = null;
    hand.pos = 0;
    hand.index += 1;
    return null;
  }
  if (!hand.word || hand.word.parentNode !== parent) {
    hand.word = document.createElement('span');
    hand.word.className = 'w';
    parent.appendChild(hand.word);
  }
  const { rot, dy, weight } = handFor(hand.seed, hand.index, { pos: hand.pos });
  const s = document.createElement('span');
  s.className = 'ch';
  s.style.setProperty('--rot', `${rot}deg`);
  s.style.setProperty('--dy', `${dy}em`);
  s.style.setProperty('--w', String(weight));
  s.textContent = ch;
  hand.word.appendChild(s);
  hand.pos += 1;
  hand.index += 1;
  return s;
}

function appendBlot(p, seed, blotIn) {
  const b = blotFor(seed);
  if (!b) return;
  const el = document.createElement('span');
  el.className = blotIn ? 'blot blot-in' : 'blot';
  el.setAttribute('aria-hidden', 'true');
  el.style.setProperty('--bs', `${b.size}em`);
  el.style.setProperty('--br', `${b.right}%`);
  el.style.setProperty('--bb', `${b.bottom}em`);
  el.style.setProperty('--bt', `${b.rot}deg`);
  p.appendChild(el);
}

/**
 * Render text (with optional ~~strike~~ markup) into a paragraph, instantly.
 * @param {HTMLElement} p
 * @param {string} text
 * @param {{seed?: number, blotIn?: boolean}} [options]  seed defaults to seedFor(text);
 *   blotIn animates the blot in (used when a message has just finished writing).
 */
export function renderInk(p, text, { seed, blotIn = false } = {}) {
  const src = String(text ?? '');
  const hand = createHand(seed ?? seedFor(src));
  p.textContent = '';
  let plain = '';
  for (const seg of parseStrikes(src)) {
    let parent = p;
    if (seg.struck) {
      const s = document.createElement('s');
      s.className = 'struck lined';
      p.appendChild(s);
      parent = s;
    }
    for (const ch of seg.text) placeChar(hand, parent, ch);
    plain += seg.text;
  }
  setReadableText(p, plain);
  appendBlot(p, hand.seed, blotIn);
}

// Screen readers (issue #41): the letter-by-letter ink is decorative and hidden;
// the plain text sits beside it in a visually hidden element, read once and whole.
function setReadableText(p, plain) {
  p.setAttribute('aria-hidden', 'true');
  const host = p.parentElement;
  if (!host) return;
  let sr = host.querySelector(':scope > .sr-only');
  if (!sr) {
    sr = document.createElement('span');
    sr.className = 'sr-only';
    host.insertBefore(sr, p);
  }
  sr.textContent = plain;
}

const prefersReducedMotion = () => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

export class InkWriter {
  constructor(p, { charDelay = CHAR_DELAY_MS, onProgress = null, onChar = null, seed = null } = {}) {
    this.p = p;
    this.charDelay = charDelay;
    this.onProgress = onProgress;
    this.onChar = onChar;   // e.g. a quill-scratch sound per letter (issue #21)
    this.seed = seed ?? randomSeed(); // the hand: the same seed is used for the final render
    this.hand = createHand(this.seed);
    this.queue = [];        // characters waiting to be written
    this.written = '';      // characters already on the page
    this.finalText = null;  // set by finish()
    this.timer = null;
    this.target = p;        // where characters go: the paragraph, or an open <s>
    this.done = new Promise((resolve) => { this._resolve = resolve; });
    this.reduce = prefersReducedMotion();
    p.textContent = '';
    p.setAttribute('aria-hidden', 'true'); // the readable copy is set when the text settles
    p.classList.remove('done');
    p.classList.add('writing');
  }

  /** Everything written or queued so far. */
  get text() {
    return this.written + this.queue.join('');
  }

  /** Queue more text to be written. */
  append(piece) {
    if (this.finalText !== null || !piece) return;
    this.queue.push(...piece);
    this._tick();
  }

  /**
   * No more pieces are coming. If what was streamed is a prefix of `finalText`,
   * the rest is written in the same hand; otherwise (rare: generation failed
   * mid-way and another line was chosen) the final text simply appears.
   */
  finish(finalText) {
    const final = String(finalText ?? '');
    if (this.finalText === null) {
      if (final.startsWith(this.text)) {
        this.queue.push(...final.slice(this.text.length));
      } else {
        this.queue = [];
        this.written = final;
        renderInk(this.p, final, { seed: this.seed });
      }
      this.finalText = final;
      this._tick();
    }
    return this.done;
  }

  _tick() {
    if (this.timer) return;
    // reduced motion (issue #41): no letter-by-letter writing; text appears as it arrives
    if (this.reduce) {
      if (this.finalText !== null) {
        this.queue = [];
        this.written = this.finalText;
        this._settle(0);
      } else if (this.queue.length) {
        this.written += this.queue.join('');
        this.queue = [];
        renderInk(this.p, this.written.replace(/~(?!~)$/, ''), { seed: this.seed });
        try { this.onProgress?.(); } catch { /* ignore */ }
      }
      return;
    }
    if (!this.queue.length) {
      if (this.finalText !== null) this._settle();
      return;
    }
    // strike markup: "~~" opens or closes a crossed-out word
    if (this.queue[0] === '~') {
      if (this.queue.length < 2 && this.finalText === null) {
        this.timer = setTimeout(() => { this.timer = null; this._tick(); }, this.charDelay); // wait for the second "~"
        return;
      }
      if (this.queue[1] === '~') {
        this.queue.splice(0, 2);
        this.written += '~~';
        let pause = 0;
        if (this.target === this.p) {
          const s = document.createElement('s');
          s.className = 'struck';
          this.p.appendChild(s);
          this.target = s;
        } else {
          const s = this.target;
          this.target = this.p;
          requestAnimationFrame(() => s.classList.add('lined')); // draw the line through it
          pause = STRIKE_PAUSE_MS;
        }
        this.timer = setTimeout(() => { this.timer = null; this._tick(); }, pause);
        return;
      }
    }
    const ch = this.queue.shift();
    const s = placeChar(this.hand, this.target, ch);
    if (s) s.style.setProperty('--i', 0); // each character animates in as it is placed
    this.written += ch;
    if (this.onChar && ch !== ' ') {
      try { this.onChar(ch); } catch { /* ignore */ }
    }
    if (this.onProgress && (ch === ' ' || this.written.length % 12 === 0)) {
      try { this.onProgress(); } catch { /* ignore */ }
    }
    this.timer = setTimeout(() => { this.timer = null; this._tick(); }, this.charDelay);
  }

  _settle(delay = 750) {
    if (this.settling) return;
    this.settling = true;
    // let the last characters finish their fade-in, then collapse to plain text;
    // any blot fades in only now, after the last character is written
    setTimeout(() => {
      renderInk(this.p, this.finalText, { seed: this.seed, blotIn: true });
      this.p.classList.remove('writing');
      this.p.classList.add('done');
      try { this.onProgress?.(); } catch { /* ignore */ }
      this._resolve(this.finalText);
    }, delay);
  }
}
