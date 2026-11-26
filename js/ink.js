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
// When finished, the paragraph collapses back to plain text with class "done".

export const CHAR_DELAY_MS = 38;

export class InkWriter {
  constructor(p, { charDelay = CHAR_DELAY_MS, onProgress = null } = {}) {
    this.p = p;
    this.charDelay = charDelay;
    this.onProgress = onProgress;
    this.queue = [];        // characters waiting to be written
    this.written = '';      // characters already on the page
    this.finalText = null;  // set by finish()
    this.timer = null;
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
        this.p.textContent = final;
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
    const ch = this.queue.shift();
    const s = document.createElement('span');
    s.className = 'ch';
    s.style.setProperty('--i', 0); // each character animates in as it is placed
    s.textContent = ch;
    this.p.appendChild(s);
    this.written += ch;
    if (this.onProgress && (ch === ' ' || this.written.length % 12 === 0)) {
      try { this.onProgress(); } catch { /* ignore */ }
    }
    this.timer = setTimeout(() => { this.timer = null; this._tick(); }, this.charDelay);
  }

  _settle() {
    // let the last characters finish their fade-in, then collapse to plain text
    setTimeout(() => {
      this.p.textContent = this.finalText;
      this.p.classList.remove('writing');
      this.p.classList.add('done');
      try { this.onProgress?.(); } catch { /* ignore */ }
      this._resolve(this.finalText);
    }, 750);
  }
}
