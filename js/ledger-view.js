// The ledger page (issue #50): the diary's remarks on the left page, and on the
// right a week-by-week table of small hand-inked marks, one per day written on.
// Each feeling has its own shape (colour is never the only cue), sized by how
// strongly it was felt; every cell also says it in words for screen readers.
//
//   renderLedger(sessions, { now, page })   page 0 = the latest twelve weeks, 1 = the twelve before, ...
//   clearLedger()

import { moodEntries, byDay, weeks, patterns, remarks } from './ledger.js';

const NS = 'http://www.w3.org/2000/svg';
const WEEKS_PER_PAGE = 12;
const $ = (s) => document.querySelector(s);

// Path data in a 24x24 box. Heavy feelings are drawn in the diary's red-black ink.
export const GLYPHS = {
  grief: { d: 'M12 4 C10 8 6.5 11.5 6.5 15 a5.5 5.5 0 0 0 11 0 C17.5 11.5 14 8 12 4 Z', word: 'grief', heavy: true },
  anger: { d: 'M3 16 L6.5 8 L10 16 L13.5 8 L17 16 L20.5 9', word: 'anger', heavy: true },
  fear: { d: 'M3 12 q1.5 -4 3 0 t3 0 t3 0 t3 0 t3 0 t3 0', word: 'fear', heavy: true },
  shame: { d: 'M5 6 L18 19 M9 5 L19 15 M5 10 L14 19 M19 6 L6 19', word: 'shame', heavy: true },
  boredom: { d: 'M4 12.5 Q12 11 20 12.5', word: 'boredom', heavy: false },
  delight: { d: 'M12 3 L13.6 10.4 L21 12 L13.6 13.6 L12 21 L10.4 13.6 L3 12 L10.4 10.4 Z', word: 'delight', heavy: false },
  neutral: { d: 'M12 10.2 a1.8 1.8 0 1 0 0.01 0 Z', word: 'nothing much', heavy: false },
};

const strength = (x) => (x >= 0.7 ? 'strongly' : x >= 0.4 ? 'plainly' : 'faintly');

// A small deterministic wobble per day, so the marks look written rather than stamped.
function wobble(key) {
  let h = 2166136261;
  for (const c of String(key)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

/** One mark as an <svg>, decorative (the cell's text says what it means). */
export function glyph(emotion, intensity = 0.6, seed = '') {
  const g = GLYPHS[emotion] || GLYPHS.neutral;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('ledger-mark', g.heavy ? 'heavy' : 'light', `mark-${emotion in GLYPHS ? emotion : 'neutral'}`);
  const w = wobble(seed);
  const scale = 0.55 + 0.45 * Math.max(0, Math.min(1, intensity));
  const group = document.createElementNS(NS, 'g');
  group.setAttribute('transform', `rotate(${(w * 16 - 8).toFixed(1)} 12 12) translate(12 12) scale(${scale.toFixed(2)}) translate(-12 -12)`);
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', g.d);
  group.appendChild(path);
  svg.appendChild(group);
  return svg;
}

const fmtWeek = (ts) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const fmtRange = (a, b) => `${new Date(a).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })} – ${new Date(b).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`;

function renderKey() {
  const ul = $('#ledger-key');
  if (ul.childElementCount) return;
  for (const [emotion, g] of Object.entries(GLYPHS)) {
    const li = document.createElement('li');
    li.append(glyph(emotion, 0.8, emotion), document.createTextNode(g.word));
    ul.appendChild(li);
  }
}

/** Fill the ledger view. Returns { pages } (how many twelve-week pages there are). */
export function renderLedger(sessions, { now = Date.now(), page = 0 } = {}) {
  const entries = moodEntries(sessions);
  const p = patterns(entries, { now });

  // left page: what the diary has to say about it
  const box = $('#ledger-remarks');
  box.replaceChildren();
  box.classList.toggle('gentle', !!p.crisisRecent);
  for (const line of remarks(p)) {
    const el = document.createElement('p');
    el.className = 'ledger-remark';
    el.textContent = line;
    box.appendChild(el);
  }

  // right page: twelve weeks of marks
  const rows = weeks(byDay(entries), { now, maxWeeks: 520 });
  const pages = Math.max(1, Math.ceil(rows.length / WEEKS_PER_PAGE));
  const at = Math.max(0, Math.min(page, pages - 1));
  const end = rows.length - at * WEEKS_PER_PAGE;
  const shown = rows.slice(Math.max(0, end - WEEKS_PER_PAGE), end);
  const body = $('#ledger-weeks');
  body.replaceChildren();
  for (const week of shown) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = fmtWeek(week.start);
    tr.appendChild(th);
    week.days.forEach((day) => {
      const td = document.createElement('td');
      if (day) {
        const mark = glyph(day.dominant, day.intensity, day.key);
        const said = document.createElement('span');
        said.className = 'sr-only';
        said.textContent = `${(GLYPHS[day.dominant] || GLYPHS.neutral).word}, ${strength(day.intensity)}`;
        td.append(mark, said);
        if (day.crisis) td.classList.add('hard-day');
      }
      tr.appendChild(td);
    });
    body.appendChild(tr);
  }
  $('#ledger-table').hidden = shown.length === 0;
  $('#ledger-empty').hidden = shown.length > 0;
  $('#ledger-range').textContent = shown.length ? fmtRange(shown[0].start, shown.at(-1).start + 6 * 86400000) : '';
  $('#ledger-earlier').disabled = at >= pages - 1;
  $('#ledger-later').disabled = at === 0;
  $('#ledger-nav').hidden = pages <= 1;
  renderKey();
  return { pages, page: at };
}

/** Take everything off the ledger's pages (when the book is locked). */
export function clearLedger() {
  $('#ledger-remarks').replaceChildren();
  $('#ledger-weeks').replaceChildren();
  $('#ledger-range').textContent = '';
}
