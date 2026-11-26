// A pen doodling in the margin beside the user's message while the diary is
// slow to answer. One hand, one pen: strokes are drawn strictly one at a time,
// slowly, with a short lift between them. The doodle is never removed; the
// stroke paths are returned by stop() so they can be saved with the message
// and redrawn (instantly) with renderDoodle() when the entry is shown again.

const NS = 'http://www.w3.org/2000/svg';
const W = 120, H = 90;               // viewBox of the margin strip
const PEN_WIDTH = 1.4;               // one pen: constant line width
const SPEED = 20;                    // viewBox units per second (slow, deliberate)
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Catmull-Rom spline through points -> smooth cubic Bezier path data.
function smooth(pts) {
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

// Each shape is a list of strokes (path data) around (cx, cy) at scale s.
// The pen draws them in order, lifting between strokes.
const SHAPES = {
  spiral(cx, cy, s) {
    const turns = rand(1.5, 2.6), a0 = rand(0, 6.28), pts = [];
    for (let t = 0; t <= turns * 6.28; t += 0.5) {
      const r = (t / (turns * 6.28)) * s * 0.6;
      pts.push([cx + Math.cos(a0 + t) * r, cy + Math.sin(a0 + t) * r * 0.85]);
    }
    return [smooth(pts)];
  },
  flourish(cx, cy, s) {
    const dir = pick([-1, 1]), pts = [];
    for (let i = 0; i <= 6; i++) {
      pts.push([cx + dir * (i / 6 - 0.5) * s * 2, cy + Math.sin(i * 1.3 + rand(0, 1)) * s * 0.38 + rand(-1.5, 1.5)]);
    }
    return [smooth(pts)];
  },
  loops(cx, cy, s) {
    const n = Math.floor(rand(3, 5)), pts = [];
    for (let i = 0; i < n * 8; i++) {
      const t = (i / 8) * 6.28;
      pts.push([cx - s + (i / (n * 8)) * s * 2 + Math.cos(t) * s * 0.3, cy + Math.sin(t) * s * 0.3]);
    }
    return [smooth(pts)];
  },
  hatch(cx, cy, s) {
    const n = Math.floor(rand(3, 6)), out = [];
    for (let i = 0; i < n; i++) {
      const x = cx - s * 0.6 + i * ((s * 1.2) / n);
      out.push(smooth([[x, cy - s * 0.45 + rand(-1, 1)], [x + s * 0.22, cy + s * 0.45 + rand(-1, 1)]]));
    }
    return out;
  },
  ring(cx, cy, s) {
    const pts = [], r = s * 0.42;
    for (let t = 0; t <= 6.9; t += 0.6) pts.push([cx + Math.cos(t) * (r + rand(-0.8, 0.8)), cy + Math.sin(t) * (r * 0.85 + rand(-0.8, 0.8))]);
    return [smooth(pts)];
  },
  vine(cx, cy, s) {
    const stem = [], leaves = [];
    for (let i = 0; i <= 5; i++) {
      const x = cx - s + i * (s * 0.4), y = cy + Math.sin(i * 1.1) * s * 0.3;
      stem.push([x, y]);
      if (i && i < 5) {
        const up = i % 2 ? -1 : 1;
        leaves.push(smooth([[x, y], [x + s * 0.14, y + up * s * 0.26], [x + s * 0.26, y + up * s * 0.06]]));
      }
    }
    return [smooth(stem), ...leaves];
  },
  eye(cx, cy, s) {
    const w = s * 0.8, h = s * 0.26, r = s * 0.14;
    const lid = `M${(cx - w).toFixed(1)} ${cy.toFixed(1)} Q${cx.toFixed(1)} ${(cy - h * 2).toFixed(1)} ${(cx + w).toFixed(1)} ${cy.toFixed(1)} Q${cx.toFixed(1)} ${(cy + h * 2).toFixed(1)} ${(cx - w).toFixed(1)} ${cy.toFixed(1)}`;
    return [lid, smooth([[cx - r, cy], [cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]])];
  },
};
const KINDS = Object.keys(SHAPES);

function makeSvg(container) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'doodle');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('aria-hidden', 'true');
  container.appendChild(svg);
  return svg;
}

function makePath(svg, d) {
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('stroke-width', PEN_WIDTH);
  svg.appendChild(path);
  return path;
}

/** Redraw a saved doodle instantly (no animation). */
export function renderDoodle(container, paths) {
  if (!Array.isArray(paths) || !paths.length) return null;
  const svg = makeSvg(container);
  for (const d of paths) makePath(svg, d);
  return svg;
}

/**
 * Start the pen. Returns { stop() }. stop() asks the pen to finish the stroke it
 * is on (the doodle stays on the page) and resolves to the list of path data
 * drawn, once the pen is at rest.
 */
export function startDoodle(container) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const svg = makeSvg(container);
  const drawn = [];
  let stopped = false, wake = null;
  let px = W * 0.4, py = H * 0.4, last = '';

  // pause that ends early when the pen is told to stop
  const lift = (ms) => new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    wake = () => { clearTimeout(t); resolve(); };
  });

  async function stroke(d) {
    const path = makePath(svg, d);
    drawn.push(d);
    if (reduce) return;
    const len = path.getTotalLength();
    path.style.strokeDasharray = len;
    const anim = path.animate(
      [{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
      { duration: Math.max(700, (len / SPEED) * 1000), easing: 'cubic-bezier(0.35, 0, 0.65, 1)', fill: 'both' }
    );
    await anim.finished.catch(() => {});
  }

  const run = (async () => {
    while (!stopped) {
      let kind;
      do { kind = pick(KINDS); } while (kind === last);
      last = kind;
      // the hand drifts a little between shapes instead of jumping about
      px = clamp(px + rand(-24, 24), 16, W - 16);
      py = clamp(py + rand(-20, 20), 16, H - 16);
      for (const d of SHAPES[kind](px, py, rand(14, 24))) {
        if (stopped) break;
        await stroke(d);            // one stroke at a time...
        if (stopped) break;
        await lift(rand(350, 800)); // ...then lift the pen
      }
      if (!stopped) await lift(rand(500, 1100));
    }
    return drawn.slice();
  })();

  return {
    stop() {
      stopped = true;
      if (wake) wake();
      return run;
    },
  };
}
