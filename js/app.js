// The Dark Diary — UI glue: book open/close, table of contents, sessions, ink effects.
import * as db from './db.js';
import { initEngine, reply, makeTitle } from './ai.js';
import { registerPWA } from './pwa.js';
import { startDoodle, renderDoodle } from './doodle.js';
import { loadNlp } from './nlp.js';
import { initEmbedder } from './embed.js';
import { remember, recollect, backfill } from './memory.js';

const $ = (s) => document.querySelector(s);
const book = $('#book');
const tocList = $('#toc-list');
const entriesEl = $('#entries');
const input = $('#entry-input');
const flowView = $('#flow-view');
const viewport = $('#flow-viewport');
const flow = $('#flow');
const pagesEl = $('#pages');

const CHAR_DELAY_MS = 38; // must match css/style.css (--i * 38ms)
const DOODLE_AFTER_MS = 3000; // the pen only starts if the diary takes longer than this to answer
const UNTITLED = 'An Entry Not Yet Mocked';

let current = null; // active session
let busy = false;
let engineStarted = false;
let spread = 0;      // index of the spread being shown
let spreads = 1;
let perSpread = 2;   // pages per spread: 2 on wide screens, 1 on phones

const fmtDate = (ts) =>
  new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
const fmtShort = (ts) =>
  new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

// ---------- Book ----------
function openBook() {
  if (!book.classList.contains('closed')) return;
  book.classList.remove('closed');
  book.classList.add('open');
  startEngine();
}
$('#cover').addEventListener('click', openBook);
$('#cover').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBook(); }
});

function startEngine() {
  if (engineStarted) return;
  engineStarted = true;
  const status = $('#engine-status');
  initEngine((msg) => { status.textContent = msg; })
    .then(({ backend }) => {
      if (backend === 'prompt-api') status.textContent = 'The diary stirs. (on-device)';
      else if (backend === 'transformers') status.textContent = 'The diary stirs. (fetched model)';
      setTimeout(() => { if (backend !== 'scripted') status.textContent = ''; }, 4000);
    })
    .catch(() => { status.textContent = 'The diary is indisposed.'; });
}

// ---------- Table of contents ----------
async function renderToc() {
  const sessions = await db.listSessions();
  tocList.innerHTML = '';
  for (const s of sessions) {
    const li = document.createElement('li');
    li.dataset.id = s.id;
    if (current && current.id === s.id) li.classList.add('active');
    li.innerHTML = '<span class="toc-title"></span><span class="toc-leader"></span><time class="toc-date"></time>';
    li.querySelector('.toc-title').textContent = s.title || UNTITLED;
    li.querySelector('.toc-date').textContent = fmtShort(s.createdAt);
    li.addEventListener('click', () => selectSession(s.id));
    tocList.appendChild(li);
  }
}

// ---------- Session page ----------
function setView(view) {
  book.dataset.view = view;
  flowView.hidden = view !== 'session';
  if (view === 'session') layout();
}

// ---------- Pagination ----------
// The entry is a single multi-column flow (CSS columns, one column per page).
// Column 0 is a blank spacer so an entry always starts on a right-hand page;
// we slide the flow by whole spreads.
function layout({ follow = false } = {}) {
  if (flowView.hidden) return;
  perSpread = matchMedia('(min-width: 760px)').matches ? 2 : 1;
  const pad = parseFloat(getComputedStyle($('#toc-page')).paddingLeft) || 32;
  const colw = Math.floor(pagesEl.clientWidth / perSpread - 2 * pad);
  const gap = 2 * pad;
  viewport.style.setProperty('--pad', `${pad}px`);
  viewport.style.setProperty('--colw', `${colw}px`);
  viewport.style.setProperty('--gap', `${gap}px`);
  const step = (flow.clientWidth + gap) / perSpread;
  const cols = Math.max(1, Math.round((flow.scrollWidth + gap) / step));
  spreads = Math.ceil(cols / perSpread);
  spread = follow ? spreads - 1 : Math.min(spread, spreads - 1);
  flow.style.transform = `translateX(${-spread * perSpread * step}px)`;
  const first = spread * perSpread, last = Math.min(cols, first + perSpread) - 1;
  // desktop: column 0 is the blank spacer, so column n is page n
  const pageNo = (c) => (perSpread === 2 ? c : c + 1);
  const a = pageNo(first), b = pageNo(last);
  $('#spread-label').textContent = a === b ? `${a}` : (a < 1 ? `${b}` : `${a}–${b}`);
  $('#prev-spread').disabled = spread === 0;
  $('#next-spread').disabled = spread >= spreads - 1;
}
const follow = () => requestAnimationFrame(() => layout({ follow: true }));
new ResizeObserver(() => layout()).observe(pagesEl);
// Focus/selection can scroll the clipped viewport; keep it pinned.
viewport.addEventListener('scroll', () => { viewport.scrollLeft = 0; });
const turn = (d) => { spread = Math.max(0, Math.min(spreads - 1, spread + d)); layout(); };
$('#prev-spread').addEventListener('click', () => turn(-1));
$('#next-spread').addEventListener('click', () => turn(1));
flowView.addEventListener('keydown', (e) => {
  if (e.target === input) return;
  if (e.key === 'ArrowLeft') turn(-1);
  if (e.key === 'ArrowRight') turn(1);
});

function makeEntry(role, text, { animate = false, doodle = null } = {}) {
  const div = document.createElement('div');
  div.className = `entry ${role}`;
  const p = document.createElement('p');
  p.className = 'ink';
  div.appendChild(p);
  if (role === 'user') {
    p.textContent = text;
    if (doodle) renderDoodle(div, doodle);
  } else if (animate) {
    writeInk(p, text);
  } else {
    p.textContent = text;
    p.classList.add('done');
  }
  return div;
}

// Render text as per-character spans so the reply "writes itself".
function writeInk(p, text) {
  p.textContent = '';
  p.classList.add('writing');
  [...text].forEach((ch, i) => {
    const s = document.createElement('span');
    s.className = 'ch';
    s.style.setProperty('--i', i);
    s.textContent = ch;
    p.appendChild(s);
  });
  const total = [...text].length * CHAR_DELAY_MS + 800;
  setTimeout(() => { p.textContent = text; p.classList.remove('writing'); p.classList.add('done'); }, total);
  return total;
}


function renderSession() {
  if (!current) return;
  $('#session-title').textContent = current.title || UNTITLED;
  $('#session-date').textContent = fmtDate(current.createdAt);
  $('#session-date').dateTime = new Date(current.createdAt).toISOString();
  entriesEl.innerHTML = '';
  for (const m of current.messages) entriesEl.appendChild(makeEntry(m.role, m.text, { doodle: m.doodle }));
  spread = 0;
  follow();
}

async function selectSession(id) {
  if (busy) return;
  current = (await db.getSession(id)) || null;
  renderSession();
  await renderToc();
  setView('session');
  follow();
  if (current) input.focus({ preventScroll: true });
}

async function newSession() {
  if (busy) return;
  current = await db.createSession();
  renderSession();
  await renderToc();
  setView('session');
  follow();
  input.focus({ preventScroll: true });
}

// ---------- Conversation ----------
async function submit() {
  const text = input.value.trim();
  if (!text || busy || !current) return;
  busy = true;
  input.value = '';
  input.disabled = true;
  const session = current;

  const userMsg = { role: 'user', text, ts: Date.now() };
  session.messages.push(userMsg);
  const userEntry = makeEntry('user', text, { animate: true });
  entriesEl.appendChild(userEntry);
  follow();
  await db.saveSession(session);

  remember(session.id, text).catch(() => {}); // learn from it for later entries
  follow();

  // If the diary is slow to answer, a pen starts doodling in the margin of the
  // user's message. Quick answers never see it.
  let pen = null;
  const penTimer = setTimeout(() => { pen = startDoodle(userEntry); }, DOODLE_AFTER_MS);
  let answer;
  let recollections = [];
  try { recollections = await recollect(session.id, text); } catch { /* memory is optional */ }
  try { answer = await reply(session.messages, { recollections }); }
  catch { answer = 'The diary declines to answer. How very like you to have asked.'; }

  clearTimeout(penTimer);
  if (pen) {
    // the pen finishes its current stroke; the doodle stays on the page and is saved
    pen.stop().then((paths) => {
      if (paths.length) { userMsg.doodle = paths; return db.saveSession(session); }
    }).catch(() => {});
  }
  entriesEl.appendChild(makeEntry('diary', answer, { animate: true }));
  session.messages.push({ role: 'diary', text: answer, ts: Date.now() });
  await db.saveSession(session);
  follow();

  // After the first exchange, the diary mocks the user in the table of contents.
  if (!session.title) {
    try {
      session.title = await makeTitle(session.messages);
      await db.saveSession(session);
      if (current && current.id === session.id) $('#session-title').textContent = session.title;
      await renderToc();
    } catch { /* leave untitled */ }
  }

  busy = false;
  input.disabled = false;
  if (current && current.id === session.id) input.focus({ preventScroll: true });
  follow();
}

$('#entry-form').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
input.addEventListener('input', () => layout());
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
});

$('#new-session').addEventListener('click', newSession);
$('#back-to-toc').addEventListener('click', () => setView('toc'));
$('#delete-session').addEventListener('click', async () => {
  if (!current || busy) return;
  if (!confirm('Burn this entry? The diary will not remember it fondly, or at all.')) return;
  await db.deleteSession(current.id);
  current = null;
  await renderToc();
  setView('toc');
});

// ---------- Boot ----------
registerPWA();
// Small helpers load right away (compromise.js ~340 KB, MiniLM ~23 MB); the big model waits for the book to open.
Promise.all([loadNlp(), initEmbedder(() => {})]).then(() => backfill()).catch(() => {});
(async function boot() {
  setView('toc');
  await renderToc();
})();
