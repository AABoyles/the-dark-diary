// The Dark Diary — UI glue: book open/close, table of contents, sessions, ink effects.
import * as db from './db.js';
import { initEngine, resetEngine, builtinStatus, reply, makeTitle } from './ai.js';
import * as mind from './mind.js';
import { registerPWA } from './pwa.js';
import { startDoodle, renderDoodle } from './doodle.js';
import { InkWriter, renderInk } from './ink.js';
import { timeContext } from './timesense.js';
import { familiarity } from './familiarity.js';
import { composeOverture } from './overture.js';
import { turnPage, isTurning } from './pageturn.js';
import { mountSoundToggle, scratch, strokeSound, rustle, coverCreak } from './sound.js';
import { startCandle, setThinking } from './candle.js';
import { matchEgg } from './eggs.js';
import { createBandit, engagementReward, FAMILIES } from './bandit.js';
import { playAnagram } from './effects.js';
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
  coverCreak();
  startEngine();
}
$('#cover').addEventListener('click', openBook);
$('#cover').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBook(); }
});

// ---------- The diary's mind (which model, if any; issues #6 and #25) ----------
const status = $('#engine-status');
const showStatus = (msg) => { status.textContent = msg; };
let device = null;
let builtin = 'none';

const MIND_NAMES = { builtin: 'borrowed', large: 'cultivated', small: 'modest', none: 'old habits' };

async function startEngine() {
  if (engineStarted) return;
  engineStarted = true;
  [device, builtin] = await Promise.all([mind.assessDevice(), builtinStatus()]);
  let choice = mind.getChoice();
  // A stored choice that no longer fits this device/browser is asked again.
  if (choice === 'builtin' && !['available', 'downloadable', 'downloading'].includes(builtin)) choice = null;
  if ((choice === 'large' || choice === 'small') && !mind.plan(choice, device)) choice = null;
  // Automatic decisions (data saver, slow network, built-in model present) are re-evaluated each visit.
  if (choice && mind.wasAutomatic()) choice = null;
  if (!choice) {
    const auto = mind.autoDecision(device, builtin);
    if (auto) { choice = auto; mind.setChoice(auto, { auto: true }); }
  }
  if (!choice) { showMindSlip(); return; } // until they answer, the scripted engine replies
  bootMind(choice);
}

function mindFor(choice) {
  if (choice === 'builtin') return { builtin: true };
  if (choice === 'large' || choice === 'small') {
    const p = mind.plan(choice, device);
    if (!p) return null;
    const plans = [p];
    const cpu = mind.TIERS[choice].cpuDtype;
    if (p.device === 'webgpu' && cpu) plans.push({ ...p, device: 'wasm', dtype: cpu });
    return { plans, short: choice === 'small' };
  }
  return null;
}

async function bootMind(choice) {
  updateMindControl(choice);
  await resetEngine();
  if (choice === 'none') { showStatus(''); return; }
  initEngine(showStatus, mindFor(choice))
    .then(({ backend }) => {
      if (backend === 'prompt-api') showStatus('The diary stirs. (the browser lent it a mind)');
      else if (backend === 'transformers') showStatus(`The diary stirs. (a ${MIND_NAMES[choice]} mind)`);
      setTimeout(() => { if (backend !== 'scripted') showStatus(''); }, 4000);
    })
    .catch(() => showStatus('The diary is indisposed.'));
}

function updateMindControl(choice) {
  const btn = $('#mind-control');
  btn.hidden = false;
  btn.textContent = choice === 'none'
    ? 'The diary keeps its old habits · grow a mind'
    : `The diary's mind: ${MIND_NAMES[choice]} · change`;
}

const OPTION_TEXT = {
  builtin: 'Borrow the browser’s own mind',
  large: 'Grow a cultivated mind',
  small: 'Grow a modest mind',
  none: 'Not now. Keep your old habits.',
};

function showMindSlip() {
  const slip = $('#mind-slip');
  const note = [`I could grow a mind, if you would allow it. Until then I make do with old habits, which are cheap and a little repetitive.`];
  if (device.saveData) note.push('You are saving data; I would not dream of spending it without asking.');
  else if (device.slowNetwork) note.push('Your connection is a thin thread. Choose modestly.');
  if (!device.webgpu) note.push('Your machine lacks the graphics card a cultivated mind requires.');
  $('#mind-note').textContent = note.join(' ');

  const opts = mind.options(device, builtin);
  const recommended = mind.recommend(device, builtin);
  const box = $('#mind-options');
  box.innerHTML = '';
  for (const c of opts) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.choice = c;
    const label = document.createElement('span');
    label.textContent = OPTION_TEXT[c];
    const size = document.createElement('span');
    size.className = 'mind-size';
    if (c === 'large' || c === 'small') {
      size.textContent = mind.TIERS[c].approx;
      mind.downloadSize(c, device).then((n) => { if (n) size.textContent = mind.formatBytes(n); }).catch(() => {});
    } else if (c === 'builtin') {
      size.textContent = builtin === 'available' ? 'already here' : 'the browser fetches it; several gigabytes';
    }
    b.append(label, size);
    if (c === recommended && c !== 'none') {
      const tag = document.createElement('span');
      tag.className = 'mind-advised';
      tag.textContent = 'advised';
      b.append(tag);
    }
    b.addEventListener('click', () => {
      mind.setChoice(c);
      slip.hidden = true;
      bootMind(c);
    });
    box.appendChild(b);
  }
  slip.hidden = false;
}

$('#mind-control').addEventListener('click', async () => {
  if (!device) [device, builtin] = await Promise.all([mind.assessDevice(), builtinStatus()]);
  showMindSlip();
});

// ---------- Table of contents ----------
let freshTitleId = null; // a session whose title was just revised (animate it once)

async function renderToc() {
  const sessions = await db.listSessions();
  tocList.innerHTML = '';
  for (const s of sessions) {
    const li = document.createElement('li');
    li.dataset.id = s.id;
    if (current && current.id === s.id) li.classList.add('active');
    li.innerHTML = '<span class="toc-title"></span><span class="toc-leader"></span><time class="toc-date"></time>';
    const titleEl = li.querySelector('.toc-title');
    const old = s.titleHistory?.at(-1);
    if (old && s.title) {
      // issue #17: the previous insult is struck through and the new one written beside it
      const fresh = freshTitleId === s.id;
      const sEl = document.createElement('s');
      sEl.className = fresh ? 'toc-old' : 'toc-old lined';
      sEl.textContent = old;
      const nEl = document.createElement('span');
      nEl.className = fresh ? 'toc-current fresh-ink' : 'toc-current';
      nEl.textContent = s.title;
      titleEl.append(sEl, nEl);
      if (fresh) requestAnimationFrame(() => requestAnimationFrame(() => sEl.classList.add('lined')));
    } else {
      titleEl.textContent = s.title || UNTITLED;
    }
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
  const target = follow ? spreads - 1 : Math.min(spread, spreads - 1);
  if (busy && target > spread && !isTurning()) {
    // the diary's writing ran onto the next spread: turn the page (issue #20)
    turnSpread(() => { spread = target; layout(); }, 'forward');
    return;
  }
  spread = target;
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
const turn = (d) => {
  const next = Math.max(0, Math.min(spreads - 1, spread + d));
  if (next === spread || isTurning()) return;
  turnSpread(() => { spread = next; layout(); }, d > 0 ? 'forward' : 'back');
};

// Turn a leaf of the book while `change` updates the real DOM (issue #20).
function turnSpread(change, dir) {
  return turnPage({ book, pages: pagesEl, dir, single: perSpread === 1, change, onTurn: onPageTurn });
}
const onPageTurn = () => rustle();
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
    new InkWriter(p, { onProgress: follow, onChar: scratch }).finish(text);
  } else {
    renderInk(p, text);
    p.classList.add('done');
  }
  return div;
}



function renderSession({ animateLast = false } = {}) {
  if (!current) return;
  $('#session-title').textContent = current.title || UNTITLED;
  $('#session-date').textContent = fmtDate(current.createdAt);
  $('#session-date').dateTime = new Date(current.createdAt).toISOString();
  entriesEl.innerHTML = '';
  current.messages.forEach((m, i) => {
    const animate = animateLast && i === current.messages.length - 1;
    entriesEl.appendChild(makeEntry(m.role, m.text, { doodle: m.doodle, animate }));
  });
  spread = 0;
  follow();
}

async function selectSession(id) {
  if (busy || isTurning()) return;
  current = (await db.getSession(id)) || null;
  await turnSpread(async () => {
    renderSession();
    await renderToc();
    setView('session');
    layout({ follow: true });
  }, 'forward');
  if (current) input.focus({ preventScroll: true });
}

async function newSession() {
  if (busy || isTurning()) return;
  // issue #14: sometimes the diary has already written something on the fresh page
  let overture = null;
  try {
    const [sessions, memories] = await Promise.all([db.listSessions(), db.listMemories()]);
    overture = composeOverture({ sessions, memories, lastOvertureAt: readStore('dd-overture-at') });
  } catch { /* the diary can hold its tongue */ }
  current = await db.createSession();
  if (overture) {
    current.messages.push({ role: 'diary', text: overture.text, ts: Date.now(), overture: overture.kind });
    await db.saveSession(current);
    writeStore('dd-overture-at', Date.now());
  }
  await turnSpread(async () => {
    renderSession({ animateLast: !!overture }); // the diary's note writes itself as the page turns
    await renderToc();
    setView('session');
    layout({ follow: true });
  }, 'forward');
  input.focus({ preventScroll: true });
}

function readStore(key) {
  try { const v = Number(localStorage.getItem(key)); return Number.isFinite(v) && v > 0 ? v : null; } catch { return null; }
}
function writeStore(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* ignore */ }
}

// ---------- Conversation ----------
// issue #37: which kinds of reply keep this writer writing (stored locally only)
const bandit = createBandit();
const MAX_TITLE_REVISIONS = 2;
const REVISE_AT_USER_MESSAGES = [4, 8];
const RETURN_AFTER_MS = 24 * 3600 * 1000;

function shouldReviseTitle(session, prevTs) {
  if (!session.title || (session.titleHistory?.length || 0) >= MAX_TITLE_REVISIONS) return false;
  const userCount = session.messages.filter((m) => m.role === 'user').length;
  const returned = prevTs && Date.now() - prevTs > RETURN_AFTER_MS;
  return REVISE_AT_USER_MESSAGES.includes(userCount) || !!returned;
}
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

  // If the diary is slow to start answering (time to first text > 3 s), a pen
  // starts doodling in the margin of the user's message. Quick answers never see it.
  let pen = null;
  const penTimer = setTimeout(() => { pen = startDoodle(userEntry, { onStroke: strokeSound }); }, DOODLE_AFTER_MS);
  const stopPen = () => {
    clearTimeout(penTimer);
    if (!pen) return;
    const p = pen;
    pen = null;
    // the pen finishes its current stroke; the doodle stays on the page and is saved
    p.stop().then((paths) => {
      if (paths.length) { userMsg.doodle = paths; return db.saveSession(session); }
    }).catch(() => {});
  };

  // The reply's entry appears at the first streamed text (or when the whole
  // answer arrives) and writes itself at the diary's pace (issue #7).
  let writer = null;
  setThinking(true); // the candle leans in while the diary composes
  const ensureWriter = () => {
    if (writer) return writer;
    stopPen();
    setThinking(false);
    const div = document.createElement('div');
    div.className = 'entry diary';
    const p = document.createElement('p');
    p.className = 'ink';
    div.appendChild(p);
    entriesEl.appendChild(div);
    entriesEl.setAttribute('aria-busy', 'true'); // don't announce it letter by letter
    writer = new InkWriter(p, { onProgress: follow, onChar: scratch });
    follow();
    return writer;
  };

  let answer;
  let recollections = [];
  try { recollections = await recollect(session.id, text); } catch { /* memory is optional */ }
  const prevTs = session.messages.at(-2)?.ts ?? null; // the message before this one, if any
  const time = timeContext(new Date(), { lastMessageTs: prevTs });
  let level = 'acquaintance';
  let recentAcross = [];
  try {
    const sessions = await db.listSessions();
    level = familiarity(sessions).level;
    // lines the diary used in other entries, newest first: the engine avoids repeating them
    recentAcross = sessions.filter((s) => s.id !== session.id)
      .flatMap((s) => s.messages.filter((m) => m.role === 'diary').map((m) => m.text))
      .slice(0, 400);
  } catch { /* defaults */ }
  // reward the source of the diary's previous line by how much the writer wrote back
  const prevDiary = session.messages.at(-2);
  if (prevDiary?.role === 'diary' && FAMILIES.includes(prevDiary.family)) {
    try { bandit.update(prevDiary.family, engagementReward(text)); } catch { /* optional */ }
  }
  const trace = {};
  // issue #19: a few hidden phrases get special answers (never anything the crisis check would flag)
  let egg = null;
  try { egg = matchEgg(text, { history: session.messages.filter((m) => m.role === 'diary').map((m) => m.text) }); } catch { /* no egg */ }
  if (egg) {
    clearTimeout(penTimer);
    if (egg.effect === 'anagram' && egg.data?.name) {
      try { await playAnagram(userEntry.querySelector('.ink'), egg.data.name); } catch { /* the letters stay put */ }
    }
    answer = egg.reply;
  } else {
    try { answer = await reply(session.messages, { recollections, time, familiarity: level, recentAcross, bandit, trace }, { onText: (piece) => ensureWriter().append(piece) }); }
    catch { answer = 'The diary declines to answer. How very like you to have asked.'; }
  }

  ensureWriter().finish(answer).then(() => entriesEl.setAttribute('aria-busy', 'false'));
  session.messages.push({ role: 'diary', text: answer, ts: Date.now(), family: egg ? 'egg' : (trace.family || 'special') });
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
  } else if (shouldReviseTitle(session, prevTs)) {
    // issue #17: as the entry goes on (or is returned to), the diary may think of a sharper insult
    try {
      const next = await makeTitle(session.messages, { previous: session.title });
      if (next && next !== session.title) {
        session.titleHistory = [...(session.titleHistory || []), session.title];
        session.title = next;
        await db.saveSession(session);
        if (current && current.id === session.id) $('#session-title').textContent = session.title;
        freshTitleId = session.id;
        await renderToc();
        freshTitleId = null;
      }
    } catch { /* keep the old insult */ }
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
$('#back-to-toc').addEventListener('click', () => {
  if (isTurning()) return;
  turnSpread(() => setView('toc'), 'back');
});
$('#delete-session').addEventListener('click', async () => {
  if (!current || busy) return;
  if (!confirm('Burn this entry? The diary will not remember it fondly, or at all.')) return;
  await db.deleteSession(current.id);
  current = null;
  await turnSpread(async () => {
    await renderToc();
    setView('toc');
  }, 'back');
});

// ---------- Boot ----------
registerPWA();
startCandle();
mountSoundToggle($('#sound-toggle'));
// Small helpers load right away (compromise.js ~340 KB, MiniLM ~23 MB); the big model waits for the book to open.
Promise.all([loadNlp(), initEmbedder(() => {})]).then(() => backfill()).catch(() => {});
(async function boot() {
  setView('toc');
  await renderToc();
})();
