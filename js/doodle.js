// A pen doodling on the page while the diary composes its reply.
// startDoodle(container) appends an SVG to the container and keeps adding
// hand-drawn strokes (each one drawn on over time) until the returned stop()
// is called, so the longer the wait, the more the page fills up.

const NS = 'http://www.w3.org/2000/svg';
const W = 300, H = 100;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

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

// Each generator returns an array of path data strings around (cx, cy) at scale s.
const STROKES = {
  spiral(cx, cy, s) {
    const turns = rand(1.5, 3), a0 = rand(0, 6.28), pts = [];
    for (let t = 0; t <= turns * 6.28; t += 0.5) {
      const r = (t / (turns * 6.28)) * s * 0.5;
      pts.push([cx + Math.cos(a0 + t) * r, cy + Math.sin(a0 + t) * r * 0.8]);
    }
    return [smooth(pts)];
  },
  flourish(cx, cy, s) {
    const dir = pick([-1, 1]), pts = [];
    for (let i = 0; i <= 6; i++) {
      const x = cx + dir * (i / 6 - 0.5) * s * 2;
      pts.push([x, cy + Math.sin(i * 1.3 + rand(0, 1)) * s * 0.35 + rand(-3, 3)]);
    }
    return [smooth(pts)];
  },
  loops(cx, cy, s) {
    const n = Math.floor(rand(3, 6)), pts = [];
    for (let i = 0; i < n * 8; i++) {
      const t = (i / 8) * 6.28;
      pts.push([cx - s + (i / (n * 8)) * s * 2 + Math.cos(t) * s * 0.28, cy + Math.sin(t) * s * 0.28]);
    }
    return [smooth(pts)];
  },
  hatch(cx, cy, s) {
    const n = Math.floor(rand(3, 6)), out = [];
    for (let i = 0; i < n; i++) {
      const x = cx - s * 0.5 + i * (s / n) + rand(-1, 1);
      out.push(smooth([[x, cy - s * 0.35 + rand(-2, 2)], [x + s * 0.18, cy + s * 0.35 + rand(-2, 2)]]));
    }
    return out;
  },
  ring(cx, cy, s) {
    const pts = [], r = s * 0.35;
    for (let t = 0; t <= 6.9; t += 0.6) pts.push([cx + Math.cos(t) * (r + rand(-1.5, 1.5)), cy + Math.sin(t) * (r * 0.8 + rand(-1.5, 1.5))]);
    return [smooth(pts)];
  },
  vine(cx, cy, s) {
    const pts = [], leaves = [];
    for (let i = 0; i <= 5; i++) {
      const x = cx - s + i * (s * 0.4), y = cy + Math.sin(i * 1.1) * s * 0.3;
      pts.push([x, y]);
      if (i && i < 5) {
        const up = i % 2 ? -1 : 1;
        leaves.push(smooth([[x, y], [x + s * 0.12, y + up * s * 0.22], [x + s * 0.22, y + up * s * 0.05]]));
      }
    }
    return [smooth(pts), ...leaves];
  },
  eye(cx, cy, s) {
    const w = s * 0.7, h = s * 0.28;
    const lid = `M${cx - w} ${cy} Q${cx} ${cy - h * 2} ${cx + w} ${cy} Q${cx} ${cy + h * 2} ${cx - w} ${cy}`;
    return [lid, smooth([[cx - 3, cy], [cx, cy - 4], [cx + 3, cy], [cx, cy + 4], [cx - 3, cy]])];
  },
};
const KINDS = Object.keys(STROKES);

export function startDoodle(container) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'doodle');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('aria-hidden', 'true');
  container.appendChild(svg);

  let timer = null, stopped = false, count = 0, cx = 28, last = '';

  function addStroke() {
    if (stopped) return;
    let kind;
    do { kind = pick(KINDS); } while (kind === last);
    last = kind;
    // the pen wanders rightward, then back, so the doodle gradually fills the page
    cx += rand(18, 42);
    if (cx > W - 28) cx = rand(24, 70);
    const cy = H / 2 + rand(-18, 18);
    const s = rand(16, 36) * (count > 24 ? 0.7 : 1);
    for (const d of STROKES[kind](cx, cy, s)) {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('stroke-width', rand(0.7, 1.7).toFixed(2));
      path.style.opacity = rand(0.5, 0.9).toFixed(2);
      svg.appendChild(path);
      if (reduce) continue;
      const len = path.getTotalLength();
      path.style.strokeDasharray = len;
      path.animate(
        [{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
        { duration: Math.max(350, Math.min(1300, len * 9)), easing: 'ease-in-out', fill: 'both' }
      );
    }
    count++;
    // bound the DOM on very long waits by dropping the oldest strokes
    while (svg.childNodes.length > 90) svg.removeChild(svg.firstChild);
    timer = setTimeout(addStroke, rand(550, 1000));
  }

  addStroke();
  return function stop() {
    stopped = true;
    clearTimeout(timer);
    svg.remove();
  };
}
