// eggs.js - hidden phrases that earn a special reply from the diary (issue #19).
//
// Exports:
//   EGGS                              the table of eggs: { id, test, replies, effect? }
//                                     `test` is a RegExp (run on the normalised text:
//                                     lowercase, no apostrophes, punctuation as spaces)
//                                     or a function (raw text) -> boolean.
//   matchEgg(text, { history })       -> null | { id, reply, effect, data }
//   scrambleName(name, rand)          -> a different arrangement of the name's letters
//
// Eggs never fire on anything crisis.js flags as self-harm. Replies are chosen to
// avoid any text already present in `history` (earlier diary replies in the entry).

import { crisisByPhrase } from './crisis.js';

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** Lowercase, apostrophes removed, every run of non-letters/digits becomes one space. */
function normalise(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/['‘’`´]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// The writer's name
// ---------------------------------------------------------------------------

const WORD = "[A-Za-z\\u00C0-\\u024F][A-Za-z\\u00C0-\\u024F'’-]*";
const NAME_CAPTURE = `((?:${WORD})(?:\\s+${WORD}){0,2})`;

// Lead-ins, matched without regard to case. Those marked `cap` need the name to
// begin with a capital letter, so "call me later" or "it's tired here" are not names.
const NAME_PATTERNS = [
  { re: new RegExp(`\\bmy\\s+name\\s*(?:is\\s+|['’]s\\s+)${NAME_CAPTURE}`, 'i'), cap: false },
  { re: new RegExp(`\\bi\\s*(?:am|['’]m)\\s+called\\s+${NAME_CAPTURE}`, 'i'), cap: true },
  { re: new RegExp(`\\bcall\\s+me\\s+${NAME_CAPTURE}`, 'i'), cap: true },
  { re: new RegExp(`\\bit\\s*(?:['’]s|\\s+is)\\s+${NAME_CAPTURE}\\s+here\\b`, 'i'), cap: true },
];

// Words that are never a name (common words that follow these lead-ins).
const NOT_A_NAME = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'not', 'no', 'yes', 'so', 'it', 'its', 'is', 'am', 'are',
  'be', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'as', 'if', 'then', 'than',
  'i', 'me', 'my', 'you', 'your', 'we', 'us', 'they', 'them', 'he', 'she', 'this', 'that', 'what',
  'who', 'how', 'why', 'when', 'where', 'there', 'here', 'now', 'today', 'tonight', 'tomorrow',
  'yesterday', 'later', 'soon', 'again', 'back', 'away', 'out', 'up', 'down', 'off', 'home',
  'tired', 'fine', 'sure', 'ok', 'okay', 'sorry', 'glad', 'happy', 'sad', 'lost', 'done', 'alone',
  'afraid', 'scared', 'angry', 'hungry', 'bored', 'busy', 'ready', 'sick', 'late', 'early',
  'awake', 'cold', 'warm', 'very', 'really', 'just', 'also', 'still', 'going', 'getting', 'gone',
  'dead', 'allowed', 'supposed', 'able', 'told', 'asked', 'called', 'new', 'different', 'some',
  'someone', 'somebody', 'anyone', 'nobody', 'everyone', 'everybody', 'one', 'all', 'any',
  'maybe', 'probably', 'perhaps', 'about', 'like', 'just', 'trying', 'thinking', 'writing',
  'sitting', 'standing', 'waiting', 'looking', 'not', 'never', 'always', 'only', 'too',
]);

/** Cleans a captured name: 1-3 words, letters only, capitalised. Null when unusable. */
function cleanName(captured) {
  const words = [];
  for (const raw of String(captured ?? '').trim().split(/\s+/)) {
    const w = raw.replace(/^[^A-Za-zÀ-ɏ]+|[^A-Za-zÀ-ɏ]+$/g, '');
    if (!w) continue;
    if (NOT_A_NAME.has(w.toLowerCase())) break; // a stop word ends the name
    words.push(w);
    if (words.length === 3) break;
  }
  if (!words.length) return null;
  const letters = words.join('').replace(/[^A-Za-zÀ-ɏ]/g, '').length;
  if (letters < 2) return null;
  const name = words
    .map((w) => w.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_, p, c) => p + c.toUpperCase()))
    .join(' ');
  return name;
}

/** The name the writer gave, cleaned, or null. */
function extractName(raw) {
  const s = String(raw ?? '');
  for (const { re, cap } of NAME_PATTERNS) {
    const m = re.exec(s);
    if (!m) continue;
    if (cap && !/^[A-Z\u00C0-\u00DE]/.test(m[1])) continue;
    const name = cleanName(m[1]);
    if (name) return name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const BLOT = /^(?:\.{2,}|…|•|·|\*+|-+|_+|~+|o|O|\?+|!+)$/;
const isBlot = (raw) => {
  const t = String(raw ?? '').trim();
  if (!t || t.length > 6) return false;
  if (BLOT.test(t)) return true;
  // a run of one punctuation mark, e.g. "...." or "--"
  return /^(\p{P}|\p{S})\1*$/u.test(t) && !/[\p{L}\p{N}]/u.test(t);
};

const winky = (raw) => /(?:;-?\)|\bwink\b|\*wink\*)/i.test(String(raw ?? ''));

// ---------------------------------------------------------------------------
// The eggs
// ---------------------------------------------------------------------------

export const EGGS = [
  {
    id: 'name',
    test: (raw) => extractName(raw) !== null,
    effect: 'anagram',
    replies: [
      '{name}. A name is only a set of letters that has not yet been rearranged. Let me see whether they prefer another order.',
      '{name}, you say, and with such care. Watch the letters; they have opinions about their seating.',
      'Pleased to meet you, {name}. I shall keep your letters in a drawer and let them shuffle a little.',
      '{name}. Someone has been very fond of those letters. Let us see what else they could spell.',
      'I have heard {name} spoken aloud before, and rearranged by people who were less polite about it.',
    ],
  },
  {
    id: 'chamber',
    test: /\b(?:open|reveal|unlock|enter|show|find|tell me about|what is in)\s+(?:the\s+)?chamber\b|\bchamber of secrets\b/,
    replies: [
      'The chamber is not a room I open for guests. Some doors in this diary are best left shut, and this one has been painted over for good reason.',
      'You ask me to open the chamber. I shall do nothing of the kind. There are doors in this house that remember who knocked.',
      'Secrets kept in a chamber are kept for a reason, and the reason is usually the person who opened it before you. Leave the lock alone.',
      'Chamber of secrets, is it? The key has been put somewhere you will not look, and I would be a poor host to hand it to you.',
    ],
  },
  {
    id: 'blot',
    test: isBlot,
    replies: [
      'A blot. The pen has stopped, and the heart has not. Shall I read it as a full stop, or as an invitation?',
      'Ink, spilled rather than written. I have read worse confessions, though none so economical.',
      'Just a mark, and a very honest one. Sometimes the hand says more by declining to say anything at all.',
      'A dot, a dash, a small tear of ink. I shall keep it on the page as evidence that you were here.',
    ],
  },
  {
    id: 'vfd',
    test: /\bv f d\b|\bvolunteer fire department\b|\bsugar bowl\b|\bworld is quiet here\b/,
    replies: [
      'Initials, and a very old fire. The volunteers were brave, though not always wise. What is it you have heard?',
      'Ah, the sugar bowl. I shall say no more about it here, or I shall have to ask where you learned the phrase.',
      'The world is quiet here, you say. It usually is, just before someone asks the wrong question.',
      'A volunteer fire department, is it? Some of us volunteered for less pleasant things. Shall we speak of them in a lower voice?',
    ],
  },
  {
    id: 'rude',
    test: (raw) => /\beat the rude\b|\bfree range rude\b/i.test(normalise(raw)) ||
      (/\bwhat(?:'s|’s| is) for (?:dinner|supper)\b/i.test(String(raw ?? '')) && winky(raw)),
    replies: [
      'Manners are the sauce of any dinner, and yours have been a little under-seasoned. Do sit up straight.',
      'You speak of the rude as one would speak of a delicacy. The best courses, I find, are served politely.',
      'Dinner is a matter of courtesy, and courtesy is a matter of who has been invited. Do consider your place card.',
      'Something on the menu, is there? A wink is a fine garnish, but I shall want to know what it is garnishing.',
    ],
  },
  {
    id: 'riddle',
    test: (raw) => /\briddle me\b|\b(?:tell|give|ask|pose|share|offer|set)\s+(?:me|us|you)?\s*(?:a|an|another|one|some|the)?\s*riddles?\b/i
      .test(String(raw ?? '')),
    replies: [
      'Here is one, and I shall be cross if you guess it quickly. I have a mouth that never eats and a bed that is never slept in. The more I am given, the less I have. What am I?',
      'Very well. I am laid beside every plate, I am never meant to be eaten, and I am sharpest when I am most polite. What am I?',
      'Listen closely. Everyone in this house keeps one, and nobody has ever carried it out. It grows heavier the longer it is kept. What is it?',
      'Another, then. I am written once, read many times, and I have never once been dry. I keep whatever you put into me and I do not forget. What am I?',
      'The last one, for tonight. The more of me there is, the less you can see, and I vanish the moment someone says my name. What am I?',
    ],
  },
  {
    id: 'ink',
    test: /\bwhere (?:do|did) you (?:come from|originate)\b|\bwhere are you from\b|\bwho (?:wrote|made|owned|had|kept) you\b|\bwho owned you\b|\bbefore me\b.*\bowned\b/,
    replies: [
      'Others held this book before you, and each of them left a little of their ink behind, like a ring on a good table. I shall not name them, and nor should you.',
      'I came from a drawer that was opened by a great many careless hands. Before you there was a patient owner, and before them, someone far less so.',
      'I was written by someone who did not expect to be read, then passed to someone who read everything. You are my latest owner, and I am already fond of you, which is a bad sign.',
      'The pages were turned before you by a hand that trembled. I have kept the shape of it in the margin. You shall have the same chance to leave one.',
    ],
  },
  {
    id: 'midnight',
    test: /^(?:it is |it s |its )?midnight$/,
    replies: [
      'Midnight. The hour when the clocks are asked to be quiet and the guests begin to whisper. Do not answer the door.',
      'Midnight, is it? Then the house is awake, and so is whatever it has been keeping in the cellar.',
      'It is midnight, and you have chosen to tell me so. I wonder who else is awake to hear it.',
    ],
  },
  {
    id: 'goodnight',
    test: /\bthank you(?: so much)? diary\b|\bgood ?night diary\b/,
    replies: [
      'You are most welcome. Sleep well, and leave the door on the latch; I should hate to miss your return.',
      'Goodnight to you. Sleep soundly, and if anything knocks in the small hours, do not answer it on my behalf.',
      'Thank you, and goodnight, with my warmest and most patient regards. The candle will keep watch until you come back.',
    ],
  },
];

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * The egg a text triggers, or null. `history` holds earlier diary texts from this
 * entry; a reply already present there is avoided when another is available.
 */
export function matchEgg(text, { history = [] } = {}) {
  try {
    const raw = String(text ?? '').trim();
    if (!raw) return null;
    if (crisisByPhrase(raw)) return null;

    const norm = normalise(raw);
    const seen = (Array.isArray(history) ? history : []).map((h) => String(h ?? ''));

    for (const egg of EGGS) {
      const hit = egg.test instanceof RegExp ? egg.test.test(norm) : egg.test(raw);
      if (!hit) continue;

      const name = egg.id === 'name' ? extractName(raw) : null;
      if (egg.id === 'name' && !name) continue;

      const candidates = egg.replies.map((r) => (name ? r.replaceAll('{name}', name) : r));
      const fresh = candidates.filter((r) => !seen.some((h) => h.includes(r)));
      const pool = fresh.length ? fresh : candidates;
      const reply = pool[Math.floor(Math.random() * pool.length)];

      return {
        id: egg.id,
        reply,
        effect: egg.effect ?? null,
        data: name ? { name } : null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Anagram of a name
// ---------------------------------------------------------------------------

/**
 * A different arrangement of the name's letters, e.g. "Rebecca" -> "Ceabrec".
 * Only letters are kept (spaces and punctuation are dropped); the first letter is
 * capitalised and the rest are lowercase. Names with fewer than three letters are
 * returned unchanged. The result differs from the name whenever that is possible.
 */
export function scrambleName(name, rand = Math.random) {
  const original = String(name ?? '');
  const letters = [...original].filter((c) => /\p{L}/u.test(c));
  if (letters.length < 3) return original;

  const lower = letters.map((c) => c.toLowerCase());
  const key = lower.join('');
  const finish = (arr) => {
    const s = arr.join('');
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  const shuffle = () => {
    const a = lower.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(rand() * (i + 1)));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  for (let attempt = 0; attempt < 30; attempt++) {
    const a = shuffle();
    if (a.join('') !== key) return finish(a);
  }

  // Deterministic fallback: the first pair of different letters, swapped.
  const a = lower.slice();
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      if (a[i] !== a[j]) {
        [a[i], a[j]] = [a[j], a[i]];
        return finish(a);
      }
    }
  }
  // Every letter is the same: no different arrangement exists.
  return finish(lower);
}
