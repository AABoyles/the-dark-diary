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
  const clone = book.cloneNode(true);
  clone.querySelectorAll('.page-turn').forEach((n) => n.remove());
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

/** A layer showing a snapshot, clipped to part of the book. */
function face(snap, clip, { back = false, origin = '50%' } = {}) {
  const clone = snap.cloneNode(true); // each face needs its own copy of the snapshot
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
      leaf.append(face(before, whole));
      keyframes = [{ transform: 'rotateY(0deg)', opacity: 1 }, { transform: 'rotateY(-100deg)', opacity: 0.2 }];
    } else if (dir === 'forward') {
      overlay.append(face(before, leftHalf));                                   // the left page stays put
      leaf.append(face(before, rightHalf), face(after, leftHalf, { back: true, origin: `${gutter}px` }));
      keyframes = [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(-180deg)' }];
    } else {
      overlay.append(face(before, rightHalf));                                  // the right page stays put
      leaf.append(face(before, leftHalf), face(after, rightHalf, { back: true, origin: `${gutter}px` }));
      keyframes = [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(180deg)' }];
    }
    overlay.append(leaf);
    book.appendChild(overlay);
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
