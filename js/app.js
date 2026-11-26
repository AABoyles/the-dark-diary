// The Dark Diary — UI glue: book open/close, table of contents, sessions, ink effects.
import * as db from './db.js';
import { initEngine, reply, makeTitle } from './ai.js';

const $ = (s) => document.querySelector(s);
const book = $('#book');
const tocList = $('#toc-list');
const entriesEl = $('#entries');
const input = $('#entry-input');
const sessionPage = $('#session-page');

const CHAR_DELAY_MS = 38; // must match css/style.css (--i * 38ms)
const UNTITLED = 'An Entry Not Yet Mocked';

let current = null; // active session
let busy = false;
let engineStarted = false;

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
function setView(view) { book.dataset.view = view; }

function makeEntry(role, text, { animate = false } = {}) {
  const div = document.createElement('div');
  div.className = `entry ${role}`;
  const p = document.createElement('p');
  p.className = 'ink';
  div.appendChild(p);
  if (role === 'user') {
    p.textContent = text;
    div.classList.add(animate ? 'absorbing' : 'absorbed');
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

function scrollDown() { entriesEl.scrollTop = entriesEl.scrollHeight; }

function renderSession() {
  const empty = !current;
  sessionPage.classList.toggle('empty', empty);
  if (empty) return;
  $('#session-title').textContent = current.title || UNTITLED;
  $('#session-date').textContent = fmtDate(current.createdAt);
  $('#session-date').dateTime = new Date(current.createdAt).toISOString();
  entriesEl.innerHTML = '';
  for (const m of current.messages) entriesEl.appendChild(makeEntry(m.role, m.text));
  scrollDown();
}

async function selectSession(id) {
  if (busy) return;
  current = (await db.getSession(id)) || null;
  renderSession();
  await renderToc();
  setView('session');
  if (current) input.focus();
}

async function newSession() {
  if (busy) return;
  current = await db.createSession();
  renderSession();
  await renderToc();
  setView('session');
  input.focus();
}

// ---------- Conversation ----------
async function submit() {
  const text = input.value.trim();
  if (!text || busy || !current) return;
  busy = true;
  input.value = '';
  input.disabled = true;
  const session = current;

  session.messages.push({ role: 'user', text, ts: Date.now() });
  entriesEl.appendChild(makeEntry('user', text, { animate: true }));
  await db.saveSession(session);

  const pending = document.createElement('div');
  pending.className = 'entry diary pending';
  pending.innerHTML = '<p class="ink"></p>';
  entriesEl.appendChild(pending);
  scrollDown();

  // Let the user's ink sink for a moment before the diary answers.
  const minWait = new Promise((r) => setTimeout(r, 1600));
  let answer;
  try { [answer] = await Promise.all([reply(session.messages), minWait]); }
  catch { answer = 'The diary declines to answer. How very like you to have asked.'; }

  const entry = makeEntry('diary', answer, { animate: true });
  pending.replaceWith(entry);
  session.messages.push({ role: 'diary', text: answer, ts: Date.now() });
  await db.saveSession(session);
  const grow = setInterval(scrollDown, 250);
  setTimeout(() => clearInterval(grow), answer.length * CHAR_DELAY_MS + 900);

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
  if (current && current.id === session.id) input.focus();
}

$('#entry-form').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
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
  renderSession();
  await renderToc();
  setView('toc');
});

// ---------- Boot ----------
(async function boot() {
  setView('toc');
  sessionPage.classList.add('empty');
  await renderToc();
})();
