// Page turns (issue #20): a leaf rotates around the gutter, showing the page
// being turned on its front and the page it reveals on its back.
//
//   await turnPage({ book, pages, dir: 'forward' | 'back', change, single });
//
// `change` switches the real DOM to the new state (another spread, the contents,
// an entry). The function snapshots the book before and after, and animates
// leaves made from those snapshots over the real book; then removes them.
//
// Snapshots are deep clones of #book rendered inside CLOSED shadow roots, so
// their duplicate ids never leak into document.querySelector (or tests), and
// they get the page's own stylesheets via a constructed CSSStyleSheet.

const DURATION = 760;
let turning = null;     // the in-flight turn, if any
let slowTurns = 0;      // consecutive turns that took too long to build (issue #45)
const SLOW_TURN_MS = 350;
let sheet = null;       // adopted stylesheet for snapshots

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

function snapshotSheet() {
  if (sheet) return sheet;
  let css = '';
  for (const s of document.styleSheets) {
    try {
      for (const rule of s.cssRules) css += rule.cssText + '\n';
    } catch { /* cross-origin (fonts): @font-face is document-wide anyway */ }
  }
  // a snapshot is a still picture: nothing inside it animates
  css += `
    *, *::before, *::after { animation: none !important; transition: none !important; }
    .ink.writing .ch { opacity: 1 !important; filter: none !important; top: 0 !important; }
    .doodle path { stroke-dasharray: none !important; stroke-dashoffset: 0 !important; }
  `;
  sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  return sheet;
}

/** A frozen copy of the book, positioned exactly over it. */
function snapshot(book) {
  // only the pages are pictured (issue #45): a shallow copy of #book keeps its
  // id, classes and data-view for the stylesheet; the cover and leather are left out
  const clone = book.cloneNode(false);
  const pagesEl = book.querySelector('#pages');
  if (pagesEl) clone.appendChild(pagesEl.cloneNode(true));
  skipHiddenEntries(book, clone);
  // keep what the user can see in scrolled areas and form fields
  const src = book.querySelectorAll('#toc-list, #flow-viewport');
  const dst = clone.querySelectorAll('#toc-list, #flow-viewport');
  src.forEach((el, i) => { if (dst[i]) dst[i].dataset.scrollTop = el.scrollTop; });
  const r = book.getBoundingClientRect();
  Object.assign(clone.style, {
    position: 'absolute', left: '0', top: '0', margin: '0',
    width: `${r.width}px`, height: `${r.height}px`, maxWidth: 'none', maxHeight: 'none',
    transform: 'none',
  });
  return clone;
}

/**
 * In a long entry most of the text is on other spreads. In the copy, entries
 * that lie wholly off the visible pages (and in a single column, so they don't
 * change how the columns break) keep their size but skip styling, layout and
 * paint (content-visibility), which keeps big turns cheap (issue #45).
 */
function skipHiddenEntries(book, clone) {
  const viewport = book.querySelector('#flow-viewport');
  const live = book.querySelectorAll('#entries > .entry');
  if (!viewport || !live.length || book.dataset.view !== 'session') return;
  const v = viewport.getBoundingClientRect();
  const copies = clone.querySelectorAll('#entries > .entry');
  live.forEach((el, i) => {
    const rects = el.getClientRects();
    if (rects.length !== 1 || !copies[i]) return;
    const r = rects[0];
    if (r.right > v.left && r.left < v.right) return; // (partly) on show
    copies[i].style.contentVisibility = 'hidden';
    copies[i].style.containIntrinsicSize = `${Math.ceil(r.width)}px ${Math.ceil(r.height)}px`;
  });
}

/** A layer showing a snapshot, clipped to part of the book. */
function face(snap, clip, { back = false, origin = '50%', consume = false } = {}) {
  // each face needs its own copy, but the last face to use a snapshot can take it as is
  const clone = consume ? snap : snap.cloneNode(true);
  const wrap = document.createElement('div');
  wrap.className = 'page-turn-face';
  wrap.style.clipPath = clip;
  if (back) {
    wrap.style.transform = 'rotateY(180deg)';
    wrap.style.transformOrigin = `${origin} 50%`;
  }
  const host = document.createElement('div');
  host.className = 'page-turn-host';
  const root = host.attachShadow({ mode: 'closed' });
  root.adoptedStyleSheets = [snapshotSheet()];
  root.appendChild(clone);
  // restore scroll positions inside the snapshot
  requestAnimationFrame(() => {
    root.querySelectorAll('[data-scroll-top]').forEach((el) => { el.scrollTop = Number(el.dataset.scrollTop) || 0; });
  });
  const shade = document.createElement('div');
  shade.className = 'page-turn-shade';
  wrap.append(host, shade);
  return wrap;
}

/**
 * Turn a page. dir 'forward' lifts the right page over to the left; 'back' the
 * left page over to the right. single: one page per view (phones): the page
 * swings away around its left edge.
 */
export async function turnPage({ book, pages, dir = 'forward', change, single = false, onTurn = null }) {
  if (turning || reduceMotion() || !book || !pages || typeof CSSStyleSheet === 'undefined' || !HTMLElement.prototype.attachShadow) {
    await change?.();
    return;
  }
  let release;
  turning = new Promise((r) => { release = r; });
  try {
    // on a device where full turns proved slow, a quick cross-fade instead (issue #45)
    if (slowTurns >= 2) {
      await change?.();
      try { onTurn?.(); } catch { /* sound is optional */ }
      await pages.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' }).finished.catch(() => {});
      return;
    }
    const t0 = performance.now();
    const before = snapshot(book);
    await change?.();
    await frame();
    await frame();
    const after = snapshot(book);

    const bookRect = book.getBoundingClientRect();
    const pagesRect = pages.getBoundingClientRect();
    const left = pagesRect.left - bookRect.left;
    const right = bookRect.right - pagesRect.right;
    const top = pagesRect.top - bookRect.top;
    const bottom = bookRect.bottom - pagesRect.bottom;
    const gutter = single ? left : left + pagesRect.width / 2;
    const inset = (l, r) => `inset(${top}px ${r}px ${bottom}px ${l}px)`;
    const leftHalf = inset(left, bookRect.width - gutter);
    const rightHalf = inset(gutter, right);
    const whole = inset(left, right);

    const overlay = document.createElement('div');
    overlay.className = 'page-turn';
    overlay.setAttribute('aria-hidden', 'true'); // a moving picture of the page, not content (issue #41)
    overlay.style.perspectiveOrigin = `${gutter}px 50%`;
    const leaf = document.createElement('div');
    leaf.className = 'page-turn-leaf';
    leaf.style.transformOrigin = `${gutter}px 50%`;

    let keyframes;
    if (single) {
      leaf.append(face(before, whole, { consume: true }));
      keyframes = [{ transform: 'rotateY(0deg)', opacity: 1 }, { transform: 'rotateY(-100deg)', opacity: 0.2 }];
    } else if (dir === 'forward') {
      overlay.append(face(before, leftHalf));                                   // the left page stays put
      leaf.append(face(before, rightHalf, { consume: true }), face(after, leftHalf, { back: true, origin: `${gutter}px`, consume: true }));
      keyframes = [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(-180deg)' }];
    } else {
      overlay.append(face(before, rightHalf));                                  // the right page stays put
      leaf.append(face(before, leftHalf, { consume: true }), face(after, rightHalf, { back: true, origin: `${gutter}px`, consume: true }));
      keyframes = [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(180deg)' }];
    }
    overlay.append(leaf);
    book.appendChild(overlay);
    // how long did building the turn take, including the first frame that draws it?
    const built = performance.now();
    await frame();
    const cost = (built - t0) + (performance.now() - built);
    slowTurns = cost > SLOW_TURN_MS ? slowTurns + 1 : Math.max(0, slowTurns - 1);
    try { onTurn?.(); } catch { /* sound is optional */ }

    const opts = { duration: DURATION, easing: 'cubic-bezier(0.45, 0.05, 0.35, 1)', fill: 'forwards' };
    const shades = [...leaf.querySelectorAll('.page-turn-shade')];
    shades.forEach((s) => s.animate([{ opacity: 0 }, { opacity: 0.55, offset: 0.5 }, { opacity: 0 }], opts));
    await leaf.animate(keyframes, opts).finished.catch(() => {});
    overlay.remove();
  } finally {
    turning = null;
    release();
  }
}

/** True while a page is turning (callers may skip extra turns). */
export const isTurning = () => !!turning;
