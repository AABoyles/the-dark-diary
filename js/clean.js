/**
 * clean.js - post-processing for model output (pure functions, no DOM).
 *
 *   clean(text, { allowStrike }) -> the diary's reply as plain prose, at most 3 sentences / ~260 chars.
 *                         Strike-through markup "~~cruel~~ gentle" (issue #13) is kept (at most one)
 *                         when allowStrike is true, and otherwise reduced to the gentle word.
 *   cleanTitle(text)   -> a short Title Case entry title
 *   streamPrefix(raw, { allowStrike }) -> while a reply is still streaming in (issue #7): the part of the
 *                         text that is safe to show now, i.e. guaranteed to remain a prefix
 *                         of clean(raw + whatever arrives next) in all but rare cases.
 */

import { limitStrikes, stripStrikes } from './strike.js';


const EMOJI_RE = /[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️⃣]/gu;
const QUOTE_EDGE_RE = /^[\s"'“”‘’`]+|[\s"'“”‘’`]+$/g;
const LABEL_RE = /^(?:the\s+)?(?:dark\s+)?diary\s*:\s*|^(?:user|assistant|you|model|narrator|writer)\s*:\s*/i;

export function clean(text, { allowStrike = false } = {}) {
  let t = String(text ?? '').replace(/\r/g, '');
  t = allowStrike ? limitStrikes(t, 1) : stripStrikes(t);

  // Stage directions: (parenthetical) and *asterisked* actions, plus [brackets].
  t = t.replace(/\([^()]*\)/g, ' ');
  t = t.replace(/\[[^\[\]]*\]/g, ' ');
  t = t.replace(/\*[^*\n]*\*/g, ' ');

  // Markdown: line prefixes, emphasis, code, headings.
  t = t.replace(/^\s*(?:#+|>+|[-+*•]+)\s+/gm, '');
  t = t.replace(/[*_`#]/g, '');

  // Plain prose: one line, no emojis, collapsed whitespace, no space before punctuation.
  t = t.replace(EMOJI_RE, '').replace(/\s+/g, ' ').replace(/\s+([.,;:!?…])/g, '$1').trim();

  // Strip surrounding quotes and speaker labels, repeatedly.
  for (let i = 0; i < 4; i++) {
    const before = t;
    t = t.replace(QUOTE_EDGE_RE, '').replace(LABEL_RE, '').trim();
    if (t === before) break;
  }

  return capSentences(t, 3, 260);
}

function capSentences(t, maxSentences, maxChars) {
  if (!t) return '';
  const parts = t.split(/(?<=[.!?…])\s+/).filter(Boolean);
  let out = '';
  for (const part of parts.slice(0, maxSentences)) {
    const candidate = out ? `${out} ${part}` : part;
    if (candidate.length > maxChars) break;
    out = candidate;
  }
  if (!out) {
    // The first sentence alone is too long: cut at a word boundary.
    const cut = t.slice(0, maxChars);
    const space = cut.lastIndexOf(' ');
    out = (space > 40 ? cut.slice(0, space) : cut).replace(/[,;:\s]+$/, '') + '…';
  }
  return out;
}

const SMALL_WORDS = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'nor', 'of', 'in', 'on', 'at', 'to', 'for', 'by', 'with', 'as']);

function titleCase(s) {
  return s
    .split(' ')
    .map((w, i) => {
      if (!w) return w;
      if (i > 0 && SMALL_WORDS.has(w.toLowerCase())) return w.toLowerCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

export function cleanTitle(text) {
  let t = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? '';
  t = t.replace(EMOJI_RE, '').replace(/[*_`#]/g, '').trim();
  t = t.replace(/^(?:the\s+)?title\s*:\s*/i, '');
  t = t.replace(QUOTE_EDGE_RE, '');
  t = t.replace(/[.。\s]+$/, '');
  t = t.replace(/\s+/g, ' ').trim();
  if (t.length > 70) {
    const cut = t.slice(0, 70);
    const space = cut.lastIndexOf(' ');
    t = (space > 40 ? cut.slice(0, space) : cut).trim();
  }
  return t ? titleCase(t) : '';
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

// Index of the first stage-direction opener that is not yet closed: "(", "[" or "*".
function firstUnclosed(t) {
  const stack = [];
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '(' || ch === '[') stack.push([ch, i]);
    else if ((ch === ')' && stack.at(-1)?.[0] === '(') || (ch === ']' && stack.at(-1)?.[0] === '[')) stack.pop();
    else if (ch === '*') {
      if (stack.at(-1)?.[0] === '*') stack.pop();
      else stack.push(['*', i]);
    } else if (ch === '\n' && stack.at(-1)?.[0] === '*') stack.pop(); // clean() never spans * over lines
  }
  let cut = stack.length ? stack[0][1] : t.length;
  // an unclosed ~~strike~~ (odd number of "~~") is held back too
  const tildes = [...t.matchAll(/~~/g)].map((m) => m.index);
  if (tildes.length % 2 === 1) cut = Math.min(cut, tildes.at(-1));
  // a lone trailing "~" may be the first half of "~~"
  if (cut === t.length && t.endsWith('~')) cut = t.length - 1;
  return cut;
}

/**
 * The displayable part of a reply that is still arriving. Holds back:
 *  - everything until enough text has arrived to rule out a leading speaker label ("Diary:")
 *  - anything from an unclosed (stage direction), [bracket] or *action* onwards
 *  - a trailing ellipsis that capSentences() adds when cutting an over-long sentence
 *  - a word still being written (it might be half an emoji, or be cut later), and
 *    trailing , ; : (an over-long sentence is cut just before them)
 */
export function streamPrefix(raw, { allowStrike = false } = {}) {
  const t = String(raw ?? '');
  const settled = t.length >= 24 || /[.!?…]/.test(t);
  if (!settled) return '';
  const upto = t.slice(0, firstUnclosed(t));
  let out = clean(upto, { allowStrike });
  if (out.endsWith('…') && !/…\s*$/.test(t)) out = out.slice(0, -1).trimEnd();
  else if (!/\s$/.test(upto)) out = out.replace(/\S+$/, '').trimEnd();
  return out.replace(/[,;:]+$/, '');
}
