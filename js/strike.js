// Struck-through words for the Dark Diary.
//
// The diary sometimes writes a sinister word, crosses it out and carries on
// with a gentler one. Markup in message text is "~~cruel~~ gentle", for example
// "I would ~~devour~~ enjoy hearing more." Everything here is pure: no DOM, no
// storage. The only randomness is the injected rand() in maybeStrike.

// Gentle word or phrase -> the sinister word it almost wrote. Keys are common
// words that appear in the diary's own replies (see the strike tests).
export const STRIKE_PAIRS = Object.freeze({
  enjoy: 'devour',
  keep: 'bury',
  listen: 'feast',
  remember: 'preserve',
  help: 'harvest',
  hold: 'pin down',
  discuss: 'slice',
  friend: 'specimen',
  guest: 'ingredient',
  love: 'consume',
  trust: 'swallow',
  share: 'divide',
  welcome: 'season',
  cook: 'render',
  wait: 'linger',
  care: 'cull',
  table: 'slab',
  story: 'autopsy',
  family: 'larder',
  company: 'captivity',
  smile: 'rictus',
  safe: 'trapped',
  stay: 'roost',
  wine: 'blood',
  food: 'remains',
  eat: 'gorge',
  meal: 'butchery',
  soup: 'marrow',
  secret: 'viscera',
  drawer: 'casket',
  silver: 'knives',
  dream: 'nightmare',
  music: 'dirge',
  warm: 'flushed',
  sleep: 'lie in state',
  door: 'trapdoor',
});

// One complete "~~x~~" pair, with the optional space that follows it.
const PAIR_OR_STRAY = /~~[^~]+?~~ ?|~~/g;
const PAIR_ONLY = /~~([^~]+?)~~/g;

// The text of a value, or '' for anything that is not a string.
function toText(value) {
  return typeof value === 'string' ? value : '';
}

// Matches the gentle keys whole-word, case-insensitively. Alternatives are
// ordered longest first, so at any position the longer key wins, and the
// leftmost key in the text wins overall.
function gentleKeyPattern() {
  const keys = Object.keys(STRIKE_PAIRS)
    .sort((a, b) => b.length - a.length)
    .map((key) => key.split(' ').join('\\s+'));
  return new RegExp(`\\b(?:${keys.join('|')})\\b`, 'gi');
}

// Copies the capitalisation of the gentle word onto the sinister one.
function matchCase(original, word) {
  if (/[A-Z]/.test(original) && original === original.toUpperCase()) {
    return word.toUpperCase();
  }
  if (/^[A-Z]/.test(original)) {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }
  return word;
}

/**
 * True if the text holds at least one complete "~~x~~" pair.
 * @param {string} text
 * @returns {boolean}
 */
export function hasStrike(text) {
  return /~~[^~]+?~~/.test(toText(text));
}

/**
 * Removes each "~~x~~" together with one following space, keeping the gentle
 * replacement. Stray unmatched "~~" are removed too.
 * @param {string} text
 * @returns {string}
 */
export function stripStrikes(text) {
  return toText(text).replace(PAIR_OR_STRAY, '');
}

/**
 * Keeps the first `max` strikes exactly as written and strips the rest.
 * Stray unmatched "~~" are removed.
 * @param {string} text
 * @param {number} [max=1]
 * @returns {string}
 */
export function limitStrikes(text, max = 1) {
  const keep = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 1;
  let seen = 0;
  return toText(text).replace(PAIR_OR_STRAY, (match) => {
    if (!match.includes('~~') || !/~~[^~]+?~~/.test(match)) return '';
    seen += 1;
    return seen <= keep ? match : '';
  });
}

/**
 * Splits text into segments in order. Struck segments have struck: true.
 * Adjacent plain text is merged, stray "~~" are dropped and no segment is empty.
 * @param {string} text
 * @returns {Array<{text: string, struck: boolean}>}
 */
export function parseStrikes(text) {
  const src = toText(text);
  const out = [];
  const push = (value, struck) => {
    if (!value) return;
    const last = out[out.length - 1];
    if (!struck && last && !last.struck) {
      last.text += value;
    } else {
      out.push({ text: value, struck });
    }
  };

  let cursor = 0;
  for (const match of src.matchAll(PAIR_ONLY)) {
    push(src.slice(cursor, match.index).replace(/~~/g, ''), false);
    const struck = match[1];
    if (struck.trim()) {
      push(struck, true);
    } else {
      push(struck, false);
    }
    cursor = match.index + match[0].length;
  }
  push(src.slice(cursor).replace(/~~/g, ''), false);
  return out.filter((segment) => segment.text.length > 0);
}

/**
 * Possibly inserts ONE strike before the first gentle key in the text.
 * Does nothing if the text already has a strike, if any of the last four
 * recent diary lines has one, or if rand() does not fall under `chance`.
 * @param {string} text
 * @param {{recentDiary?: string[], rand?: () => number, chance?: number}} [options]
 * @returns {string}
 */
export function maybeStrike(text, { recentDiary = [], rand = Math.random, chance = 0.15 } = {}) {
  const src = toText(text);
  if (!src || hasStrike(src)) return text;

  const recent = Array.isArray(recentDiary) ? recentDiary.slice(-4) : [];
  if (recent.some((entry) => hasStrike(entry))) return text;
  if (!(rand() < chance)) return text;

  const match = gentleKeyPattern().exec(src);
  if (!match) return text;

  const gentle = match[0].toLowerCase().split(/\s+/).join(' ');
  const cruel = STRIKE_PAIRS[gentle];
  if (!cruel) return text;

  const struck = matchCase(match[0], cruel);
  return `${src.slice(0, match.index)}~~${struck}~~ ${src.slice(match.index)}`;
}
