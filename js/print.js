// "Print / Save as PDF": a printable bound copy of the whole diary.
//
// buildPrintBook() returns a detached <section id="print-book"> made only with
// createElement and textContent (session text is never parsed as HTML). It has a
// title page, a contents page, and one <article> per entry, oldest first. The
// doodles the pen drew beside user messages are redrawn in the margin with
// renderDoodle(), from the path data saved with each message.
//
// printBook() appends that copy to the document, calls win.print(), and removes
// it again on 'afterprint'. css/print.css hides the app and shows only the copy,
// and only while printing.

import { renderDoodle } from './doodle.js';

const UNTITLED = 'An Entry Not Yet Mocked';
// One complete "~~x~~" pair. Stray or unclosed tildes stay as plain text.
const STRIKE_PAIR = /~~([^~]+?)~~/g;

/** Creates an element with a class and text, and appends any child nodes. */
function make(tag, className, text, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  node.append(...children);
  return node;
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/** A <time> for a timestamp; the machine-readable datetime is set only when the value is a real date. */
function dateNode(className, ts) {
  const time = make('time', className, formatDate(ts));
  const when = new Date(ts);
  if (!Number.isNaN(when.getTime())) time.dateTime = when.toISOString();
  return time;
}

/** Diary text: "~~x~~" becomes an <s> holding x; everything else is a plain text node. */
function appendDiaryText(p, text) {
  let last = 0;
  for (const m of text.matchAll(STRIKE_PAIR)) {
    if (m.index > last) p.append(text.slice(last, m.index));
    p.append(make('s', null, m[1]));
    last = m.index + m[0].length;
  }
  if (last < text.length) p.append(text.slice(last));
}

function messageNode(message) {
  const isUser = message.role === 'user';
  const text = typeof message.text === 'string' ? message.text : '';
  const p = make('p', isUser ? 'print-user' : 'print-diary');

  if (isUser && Array.isArray(message.doodle) && message.doodle.length) {
    const margin = make('span', 'print-doodle');
    p.append(margin);
    renderDoodle(margin, message.doodle);
  }

  if (isUser) p.append(text);
  else appendDiaryText(p, text);
  return p;
}

function titlePage() {
  return make('section', 'print-title',
    undefined,
    make('p', 'print-cover-line', 'Property of'),
    make('h1', 'print-cover-title', 'The Diary'),
    make('p', 'print-cover-line', 'of nobody in particular'));
}

function contentsPage(sessions) {
  const list = make('ol', 'print-toc');
  for (const session of sessions) {
    list.append(make('li', null, undefined,
      make('span', 'print-toc-title', session.title || UNTITLED),
      dateNode('print-toc-date', session.createdAt)));
  }
  return make('section', 'print-contents', undefined, make('h2', null, 'Contents'), list);
}

function entryArticle(session) {
  const article = make('article', 'print-entry', undefined,
    make('h2', 'print-entry-title', session.title || UNTITLED),
    dateNode('print-entry-date', session.createdAt));
  for (const message of session.messages || []) {
    if (!message || (!message.text && !message.doodle)) continue;
    article.append(messageNode(message));
  }
  return article;
}

/**
 * The printable copy of the diary as a detached element. `sessions` is as
 * db.listSessions returns it (newest first); the copy is printed oldest first.
 */
export function buildPrintBook(sessions) {
  const oldestFirst = (sessions || []).slice().reverse();
  const book = make('section', null, undefined);
  book.id = 'print-book';
  book.append(titlePage(), contentsPage(oldestFirst));
  for (const session of oldestFirst) book.append(entryArticle(session));
  return book;
}

/**
 * Builds the printable copy, opens the print dialog, and removes the copy once
 * printing has finished. Returns the element that was appended.
 */
export function printBook(sessions, { win = window } = {}) {
  document.getElementById('print-book')?.remove();
  const book = buildPrintBook(sessions);
  document.body.append(book);

  const cleanup = () => {
    win.removeEventListener('afterprint', cleanup);
    book.remove();
  };
  win.addEventListener('afterprint', cleanup);

  try {
    win.print();
  } catch (err) {
    cleanup();
    throw err;
  }
  return book;
}
