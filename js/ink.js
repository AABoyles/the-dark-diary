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

import { parseStrikes } from './strike.js';

export const CHAR_DELAY_MS = 38;
const STRIKE_PAUSE_MS = 520;

/** Render text (with optional ~~strike~~ markup) into a paragraph, instantly. */
export function renderInk(p, text) {
  p.textContent = '';
  for (const seg of parseStrikes(String(text ?? ''))) {
    if (seg.struck) {
      const s = document.createElement('s');
      s.className = 'struck lined';
      s.textContent = seg.text;
      p.appendChild(s);
    } else {
      p.appendChild(document.createTextNode(seg.text));
    }
  }
}

export class InkWriter {
  constructor(p, { charDelay = CHAR_DELAY_MS, onProgress = null } = {}) {
    this.p = p;
    this.charDelay = charDelay;
    this.onProgress = onProgress;
    this.queue = [];        // characters waiting to be written
    this.written = '';      // characters already on the page
    this.finalText = null;  // set by finish()
    this.timer = null;
    this.target = p;        // where characters go: the paragraph, or an open <s>
    this.done = new Promise((resolve) => { this._resolve = resolve; });
    p.textContent = '';
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
        renderInk(this.p, final);
      }
      this.finalText = final;
      this._tick();
    }
    return this.done;
  }

  _tick() {
    if (this.timer) return;
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
    const s = document.createElement('span');
    s.className = 'ch';
    s.style.setProperty('--i', 0); // each character animates in as it is placed
    s.textContent = ch;
    this.target.appendChild(s);
    this.written += ch;
    if (this.onProgress && (ch === ' ' || this.written.length % 12 === 0)) {
      try { this.onProgress(); } catch { /* ignore */ }
    }
    this.timer = setTimeout(() => { this.timer = null; this._tick(); }, this.charDelay);
  }

  _settle() {
    // let the last characters finish their fade-in, then collapse to plain text
    setTimeout(() => {
      renderInk(this.p, this.finalText);
      this.p.classList.remove('writing');
      this.p.classList.add('done');
      try { this.onProgress?.(); } catch { /* ignore */ }
      this._resolve(this.finalText);
    }, 750);
  }
}
