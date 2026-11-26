// Dialogue state and follow-up moves for the fallback engine (GitHub issue #32).
//
// Everything is derived from a transcript passed in. Nothing is kept between
// calls, and nothing here throws. From the user's side it works out what they
// have raised (a person, an event or a topic), whether the diary's last
// question was swerved, and whether a person or event has quietly dropped out
// of the conversation. From the diary's side it recognises its own earlier
// moves by their fixed wording. From that it proposes candidate moves.

import { extractFacts } from './nlp.js';

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

const FUNCTION_WORDS = new Set((
  'a an the and or but so if then than that this these those there here it its is are was were be been ' +
  'being am do does did doing done have has had having i me my mine we us our you your yours he she they ' +
  'them their his her him not no yes what which who whom whose when where why how just really very also too ' +
  'only some any all one get got go going gone like about with from into onto over under for of in on at by ' +
  'to up down out off back again still even ever never always well okay ok idk dunno lol ngl tbh anyway ' +
  'enough can could would should will shall may might must dont didnt cant wont isnt wasnt im ive ill thats ' +
  'whats hows youre youve youll much many more most such own didn doesn don isn wasn won hasn haven ' +
  'couldn shouldn wouldn'
).split(' '));

// Irregular forms whose stems would otherwise differ ("said" vs "say").
const IRREGULAR = {
  said: 'say', says: 'say', told: 'tell', tells: 'tell', felt: 'feel', saw: 'see', seen: 'see',
  thought: 'think', thinks: 'think',
};

// Relations that name a person. "my sister" becomes "your sister".
const RELATIONS = new Set(['sister', 'brother', 'sis', 'bro', 'bestie', 'sibling', 'mother', 'mum', 'mom',
  'father', 'dad', 'boss', 'friend', 'partner', 'wife', 'husband', 'girlfriend', 'boyfriend', 'fiance',
  'fiancee', 'son', 'daughter', 'aunt', 'uncle', 'cousin', 'grandmother', 'grandfather', 'grandma', 'grandpa',
  'nan', 'neighbour', 'neighbor', 'colleague', 'roommate', 'housemate', 'flatmate', 'kid', 'kids', 'child',
  'children', 'teacher', 'doctor', 'therapist', 'ex', 'parents', 'family', 'lover', 'manager', 'landlord',
  'coworker', 'crush', 'grandad', 'granny', 'gran']);

// Nouns that name an event rather than a thing.
const EVENTS = new Set(['wedding', 'birthday', 'funeral', 'party', 'exam', 'interview', 'meeting', 'holiday',
  'trip', 'breakup', 'divorce', 'accident', 'argument', 'fight', 'diagnosis', 'surgery', 'anniversary',
  'graduation', 'christening', 'vacation', 'appointment', 'audition', 'flight', 'reunion']);

// Plural relations are not threads: the follow-up wording is singular.
const PLURAL_RELATIONS = new Set(['kids', 'children', 'parents']);

const DETERMINERS = new Set(['a', 'an', 'the', 'this', 'that', 'these', 'those', 'his', 'her', 'their', 'its',
  'my', 'our']);
const HAVE_VERBS = new Set(['had', 'have', 'has', 'got', 'lost', 'started', 'finished', 'missed', 'failed',
  'hate', 'hated', 'love', 'loved']);
const ADJECTIVES = new Set(['bad', 'good', 'great', 'awful', 'terrible', 'long', 'hard', 'rough', 'lovely',
  'nice', 'horrible', 'weird', 'strange', 'real', 'big', 'small', 'little', 'lot', 'bit', 'quick', 'busy',
  'tough', 'difficult', 'sad', 'lonely', 'proper', 'huge', 'stupid', 'mad', 'odd', 'favourite', 'favorite',
  'first', 'last', 'next', 'best', 'worst', 'own', 'only']);
const NOT_TOPIC = new Set(['lot', 'bit', 'feeling', 'idea', 'time', 'chance', 'point', 'sense', 'kind', 'sort',
  'way', 'thing', 'things', 'go', 'deal', 'mess', 'word', 'effect', 'some', 'none', 'mind', 'head', 'stuff',
  'self', 'arse', 'ass', 'bum', 'sock', 'socks']);

// Capitalised or lowercase words that are never a person's name.
const NOT_NAME = new Set([...FUNCTION_WORDS, ...RELATIONS, ...EVENTS, ...ADJECTIVES, ...NOT_TOPIC, ...
  ('monday tuesday wednesday thursday friday saturday sunday january february march april june july ' +
  'august september october november december christmas easter london paris england scotland wales ' +
  'ireland europe america canada india china japan home work school office bed bus train today tomorrow ' +
  'yesterday tonight honestly anyway hello hiya hey hi thanks please maybe probably mostly actually ' +
  'apparently literally basically obviously seriously god lol lmao money rent job cat dog dinner food ' +
  'sorry fine sure nothing everything something anything everyone everybody someone somebody nobody ' +
  'anybody anyone none there here then now just also really very yes yeah nope ever once twice ' +
  'week year night morning day money tea coffee phone email text call called ops myself yourself ourselves ' +
  'last next first other same every again once twice').split(' ')]);

// Answers that open with yes, no, a reason or a hedge.
const ANSWER_OPEN = /^(?:yes|yeah|yep|yup|yea|no|nope|nah|because|cos|cuz|since|maybe|probably|definitely|absolutely|obviously|sort|kind|mostly|partly|sometimes|often)\b/;
const NON_ANSWER_NO = /^(?:no|nope|nah) (?:idea|clue|comment|way|reason)\b/;

// Name-like words after a verb of speech or contact, in any case.
const NAME_AFTER_VERB = /\b(?:said|called|texted|told|asked|rang|messaged|saw|met)\s+([a-z][a-z']{2,})\b/gi;
// After "with" or "from" only a capitalised word counts: "from ops" and
// "with dignity" are not names.
const NAME_AFTER_PREP = /\b(?:with|from)\s+([A-Z][a-z]{2,})\b/g;
// A name right after a relation: "my friend Dev".
const RELATION_THEN_NAME = /\b(?:friend|sister|brother|mate|colleague|flatmate|housemate|roommate|partner|boyfriend|girlfriend|boss|mum|mom|dad|mother|father|aunt|uncle)\s+([A-Z][a-z]{2,})\b/g;
// Sentence-opening word before a verb about it. Any case, for the common verbs.
const NAME_SUBJECT = /(?:^|[.!?]\s+)([a-z][a-z']{2,})\s+(?:won't|wont|didn't|didnt|hasn't|hasnt|keeps|texted|called|rang|replied|messaged|wants|said|hates|loves|doesn't|doesnt)\b/gi;
// Capitalised sentence opener before a be/have verb. Case matters here, so
// "work is" or "cat is" are not taken for names.
const NAME_SUBJECT_CAP = /(?:^|[.!?]\s+)([A-Z][a-z']{2,})\s+(?:is|was|has|had|isn't|wasn't|hasn't|doesn't)\b/g;

// ---------------------------------------------------------------------------
// Move templates. {v} is the thread value. Templates never put {v} after "the"
// or "my", so the value can be a name ("Dev") or a reflected phrase ("your
// sister", "the interview") without producing "the your" or "your Dev".
// ---------------------------------------------------------------------------

const FOLLOW_UP = {
  person: [
    '{v} again. Tell me what {v} wants from you.',
    'What did {v} say, exactly?',
    'And {v}? Go on, then. What did they actually do?',
    'You keep returning to {v}. I have noticed, and I have a theory.',
    'Let us put {v} on the table, and see what falls off.',
    '{v}, of all people. Did they know what they were doing?',
    'Tell me about {v}, and leave out the parts you have rehearsed.',
    'Is {v} still the same, or has that changed since we last spoke of them?',
    'You hurried past {v} a moment ago. Why?',
    '{v} has been on your mind all evening, I think. Is that right?',
    'Does {v} know how much of your evening they have taken up?',
  ],
  event: [
    'After {v}, what did you do with your hands?',
    'And after {v}? Tell me the part you skipped.',
    'Back to {v}. You have not yet told me how it ended.',
    '{v} is still sitting in the room with us. What did you do afterwards?',
    'You said {v} as though it were nothing, and it was not nothing.',
    'What happened straight after {v}, and who was there to see it?',
    'Go back to {v}. Slowly, this time.',
    '{v}, again. What did you do with your hands during it?',
  ],
  topic: [
    'Back to {v}, then. Why does it keep coming up?',
    'You keep coming back to {v}, whether you mean to or not.',
    'Tell me more about {v}, and do not spare me the dull parts.',
    'Is {v} the real subject, or only the one you could say aloud?',
    '{v} again. I thought we had finished with it.',
    'What would you say about {v} if I were not so attentive?',
  ],
};

const DODGED = [
  "You didn't answer me. I noticed.",
  "A clever swerve. I'll ask again later, when you're tired.",
  'That was not an answer, though it was dressed rather nicely as one.',
  'You stepped around my question like a puddle. I saw.',
  'Noted, and filed under the things you would rather not say.',
  'Ah, the courteous shrug. I will allow it, for now.',
  'You have left my question on the doorstep. I shall fetch it later.',
  'Let that question sit a while. It has not gone anywhere, and neither have I.',
  'Not an answer, but a very elegant one. Shall we try the question again?',
  'You changed the subject with the grace of a good host. I am still waiting.',
];

const ABANDONED = [
  'We were discussing {v}, before you changed the subject.',
  'And {v}? You left them standing in the hall when you turned to something else.',
  'Before you wandered off, you were telling me about {v}.',
  'You dropped {v} rather quickly. Shall we return to the subject?',
  'We had {v} on the table, and then you put it back in the drawer.',
  '{v} was getting interesting, and then you went elsewhere.',
  'Shall we return to {v}, or has the subject been quietly dismissed?',
  'I had thought we were still on {v}. Evidently not.',
  'Did {v} simply stop being important, or did you stop wanting to say so?',
];

// Every template, tagged with its move kind, for recognising the diary's own lines.
const MATCHERS = [];
const addMatchers = (kind, list) => {
  for (const tpl of list) MATCHERS.push({ kind, tpl, re: templateRegex(tpl) });
};
addMatchers('follow-up', [...FOLLOW_UP.person, ...FOLLOW_UP.event, ...FOLLOW_UP.topic]);
addMatchers('dodged', DODGED);
addMatchers('abandoned', ABANDONED);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const clean = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function templateRegex(tpl) {
  return new RegExp(tpl.split('{v}').map(escapeRe).join('(.+?)'));
}

function stemOf(word) {
  const base = IRREGULAR[word] || word;
  const cut = base.replace(/(?:ing|ed|es|s)$/, '');
  return (cut.length >= 3 ? cut : base).slice(0, 4);
}

// Stems of the content words in a line: what a reply would have to share with
// a question to count as addressing it.
function contentStems(text) {
  const out = new Set();
  for (const raw of clean(text).toLowerCase().match(/[a-z']+/g) || []) {
    const w = raw.replace(/'/g, '');
    if (w.length >= 3 && !FUNCTION_WORDS.has(w)) out.add(stemOf(w));
  }
  return out;
}

// Does the user's reply address the diary's question? Yes, no, a reason or a
// shared content word counts. Anything else is a swerve.
function answers(reply, question) {
  const plain = clean(reply).toLowerCase().replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (ANSWER_OPEN.test(plain) && !NON_ANSWER_NO.test(plain)) return true;
  const asked = contentStems(question);
  for (const stem of contentStems(reply)) if (asked.has(stem)) return true;
  return false;
}

const stripPossessive = (word) => word.replace(/'s$/, '');

// The phrase for a noun, reflected into the diary's voice. "my sister" gives
// "your sister"; "the interview" stays "the interview". `fallback` is the
// determiner to use when the text gives none, or null to refuse such a phrase.
function phrase(tokens, word, fallback) {
  const i = tokens.indexOf(word);
  let det = fallback;
  if (i >= 0) {
    for (let j = i - 1; j >= Math.max(0, i - 3); j -= 1) {
      const w = tokens[j];
      if (w === 'my' || w === 'our') { det = 'your'; break; }
      if (DETERMINERS.has(w)) { det = 'the'; break; }
    }
  }
  return det ? `${det} ${word}` : null;
}

// A relation with no determiner ("friend" in "hello there friend") is a
// thread only when a verb follows it ("mum thinks", "boss called").
const VERB_AFTER = new Set(['thinks', 'think', 'said', 'says', 'called', 'texted', 'wants', 'keeps', 'is',
  'was', 'has', 'had', 'told', 'asked', 'rang', 'messaged', 'hates', 'loves', 'isnt', 'wasnt', 'doesnt',
  'didnt', 'wont', 'are', 'were', 'have', 'will', 'would', 'never', 'always', 'still', 'says']);

function relationPhrase(tokens, word) {
  const i = tokens.indexOf(word);
  if (i < 0) return null;
  // "like a therapist" is a comparison, not a person in the story.
  if (tokens[i - 1] === 'like' || (tokens[i - 2] === 'like' && DETERMINERS.has(tokens[i - 1]))) return null;
  const after = tokens[i + 1];
  return phrase(tokens, word, VERB_AFTER.has(after) ? 'your' : null);
}

// A name as the user typed it, capitalised.
function capitalise(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// The name's own casing from the text, when there is one.
function nameOf(src, word) {
  const m = src.match(new RegExp(`\\b${escapeRe(word)}\\b`, 'i'));
  return capitalise(m ? m[0] : word);
}

// All the things one user message raises, most salient first: people, then
// events, then topics. Each { kind: 'person'|'event'|'topic', value } with the
// value already reflected into the diary's voice. Deduplicated by value.
function mentionsIn(text) {
  const src = clean(text);
  if (!src) return [];
  const tokens = (src.toLowerCase().match(/[a-z][a-z']*/g) || []).map(stripPossessive);
  const persons = [];
  const events = [];
  const topics = [];
  const seen = new Set();
  const push = (list, kind, value) => {
    if (!value) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ kind, value });
  };
  const pushName = (raw) => {
    const w = stripPossessive(raw);
    if (w.length < 3 || w.includes("'") || NOT_NAME.has(w.toLowerCase())) return;
    push(persons, 'person', capitalise(w));
  };

  // 0. A named friend ("my friend Dev") is the thread, ahead of the relation.
  for (const m of src.matchAll(RELATION_THEN_NAME)) pushName(m[1]);

  // 1. What the shared NLP helper finds. It is regex-only until compromise loads.
  let facts = [];
  try { facts = extractFacts(src); } catch (err) { facts = []; }
  for (const fact of facts) {
    const t = String(fact.topic || '').toLowerCase();
    if (!t || fact.kind === 'feeling') continue;
    if (RELATIONS.has(t)) {
      if (!PLURAL_RELATIONS.has(t)) push(persons, 'person', relationPhrase(tokens, t));
    } else if (EVENTS.has(t)) push(events, 'event', phrase(tokens, t, 'the'));
    else if (fact.kind === 'person') push(persons, 'person', nameOf(src, t));
    else if (fact.kind === 'event') push(events, 'event', phrase(tokens, t, 'the'));
    else push(topics, 'topic', phrase(tokens, t, null));
  }

  // 2. Relations and events the facts pass may have missed.
  tokens.forEach((tok, i) => {
    if (RELATIONS.has(tok) && !PLURAL_RELATIONS.has(tok)) push(persons, 'person', relationPhrase(tokens, tok));
    if (EVENTS.has(tok)) push(events, 'event', phrase(tokens, tok, 'the'));
    if ((tok === 'fired' || tok === 'sacked') && tokens[i + 1] !== 'up') push(events, 'event', 'the firing');
    if (tok === 'dumped' || (tok === 'broke' && tokens[i + 1] === 'up')) push(events, 'event', 'the breakup');
  });

  // 3. Names: after a verb of speech or contact, or opening a sentence.
  for (const m of src.matchAll(NAME_AFTER_VERB)) pushName(m[1]);
  for (const m of src.matchAll(NAME_AFTER_PREP)) pushName(m[1]);
  for (const m of src.matchAll(NAME_SUBJECT)) pushName(m[1]);
  for (const m of src.matchAll(NAME_SUBJECT_CAP)) pushName(m[1]);

  // 4. Topics: a noun after have, get, lose, fail and the like.
  tokens.forEach((tok, i) => {
    if (!HAVE_VERBS.has(tok) || !DETERMINERS.has(tokens[i + 1])) return;
    const det = tokens[i + 1];
    let j = i + 2;
    while (j < tokens.length && ADJECTIVES.has(tokens[j])) j += 1;
    const noun = tokens[j];
    if (!noun || noun.length < 3 || FUNCTION_WORDS.has(noun) || NOT_TOPIC.has(noun)
      || RELATIONS.has(noun) || EVENTS.has(noun)) return;
    push(topics, 'topic', `${det === 'my' || det === 'our' ? 'your' : 'the'} ${noun}`);
  });

  return [...persons, ...events, ...topics];
}

// Which moves the diary's own line matches, by its fixed wording. Returns
// { kind, value } (value is the captured thread value, or null) or null.
function matchMove(text) {
  const line = clean(text);
  if (!line) return null;
  for (const { kind, re } of MATCHERS) {
    const m = re.exec(line);
    if (m) return { kind, value: m[1] === undefined ? null : m[1] };
  }
  return null;
}

function render(tpl, value) {
  if (value == null) return tpl;
  const out = tpl.split('{v}').join(value);
  return tpl.startsWith('{v}') ? capitalise(out) : out;
}

function emptyState() {
  return {
    turn: 0,
    thread: null,
    lastDiaryQuestion: null,
    dodged: false,
    abandoned: null,
    lastMoves: [],
    diaryTexts: [],
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derive the conversation state from a transcript. Stateless.
 *
 * `thread.since` and `abandoned.turnsAgo` count user turns, from 1.
 * `lastMoves` has one entry per diary message, oldest first: 'follow-up',
 * 'dodged' or 'abandoned' for a line that matches that move's wording, and
 * 'other' otherwise. `diaryTexts` holds the diary's messages, which
 * dialogueMoves needs to apply its repetition rules.
 *
 * @param {Array<{role: 'user'|'diary', text: string, ts?: number}>} messages
 * @returns {{turn: number,
 *            thread: null|{kind: 'person'|'event'|'topic', value: string, since: number},
 *            lastDiaryQuestion: string|null,
 *            dodged: boolean,
 *            abandoned: null|{value: string, turnsAgo: number},
 *            lastMoves: string[],
 *            diaryTexts: string[]}}
 */
export function dialogueState(messages) {
  try {
    const list = Array.isArray(messages)
      ? messages.filter((m) => m && typeof m === 'object')
      : [];
    const user = [];
    const diary = [];
    list.forEach((m, pos) => {
      const text = clean(m.text);
      if (m.role === 'user') user.push({ text, pos });
      else if (m.role === 'diary' && text) diary.push({ text, pos });
    });

    const turn = user.length;
    const perTurn = user.map((u) => mentionsIn(u.text));

    // The thread: the newest thing raised in the last three user turns.
    let thread = null;
    for (let k = turn; k >= Math.max(1, turn - 2) && !thread; k -= 1) {
      const first = perTurn[k - 1][0];
      if (first) thread = { kind: first.kind, value: first.value, since: k };
    }

    // Abandoned: a person or event raised in at least two turns, last seen two
    // or more turns ago, while the last two turns were about something else.
    let abandoned = null;
    if (turn >= 3 && contentStems(user[turn - 1].text).size >= 2
      && contentStems(user[turn - 2].text).size >= 2) {
      const tallies = new Map();
      perTurn.forEach((mentions, i) => {
        for (const m of mentions) {
          if (m.kind === 'topic') continue;
          const key = m.value.toLowerCase();
          const t = tallies.get(key) || { value: m.value, count: 0, last: 0 };
          t.count += 1;
          t.last = i + 1;
          t.value = m.value;
          tallies.set(key, t);
        }
      });
      let best = null;
      for (const t of tallies.values()) {
        if (t.count < 2 || t.last > turn - 2) continue;
        if (!best || t.count > best.count || (t.count === best.count && t.last > best.last)) best = t;
      }
      if (best) abandoned = { value: best.value, turnsAgo: turn - best.last };
    }

    // The diary's question, if its message just before the newest user message ended with '?'.
    const lastUserPos = user.length ? user[user.length - 1].pos : -1;
    const prevDiary = [...diary].reverse().find((d) => d.pos < lastUserPos) || null;
    const lastDiaryQuestion = prevDiary && /\?$/.test(prevDiary.text) ? prevDiary.text : null;

    const newest = turn ? user[turn - 1].text : '';
    const dodged = Boolean(lastDiaryQuestion) && newest.length > 0 && !answers(newest, lastDiaryQuestion);

    const diaryTexts = diary.map((d) => d.text);
    const lastMoves = diaryTexts.map((t) => {
      const m = matchMove(t);
      return m ? m.kind : 'other';
    });

    return { turn, thread, lastDiaryQuestion, dodged, abandoned, lastMoves, diaryTexts };
  } catch (err) {
    return emptyState();
  }
}

/**
 * Candidate follow-up moves for the diary's next message, most specific first.
 * At most one per kind. Returns [] when nothing applies.
 *
 * @param {ReturnType<typeof dialogueState>} state
 * @param {{rand?: () => number}} [opts]
 * @returns {Array<{kind: 'follow-up'|'dodged'|'abandoned', text: string, q: boolean}>}
 */
export function dialogueMoves(state, { rand = Math.random } = {}) {
  try {
    if (!state || typeof state !== 'object') return [];
    const used = Array.isArray(state.diaryTexts) ? state.diaryTexts : [];
    const lastMoves = Array.isArray(state.lastMoves) ? state.lastMoves : [];
    const prev = lastMoves.length ? lastMoves[lastMoves.length - 1] : null;
    const seen = used.map(matchMove).filter(Boolean);
    const count = (kind) => seen.filter((m) => m.kind === kind).length;
    const sameValue = (kind, value) => seen.some((m) => m.kind === kind
      && m.value != null && m.value.toLowerCase() === String(value).toLowerCase());

    const pick = (pool, value) => {
      const options = pool
        .map((tpl) => render(tpl, value))
        .filter((text) => !used.some((u) => u.includes(text)));
      if (!options.length) return null;
      const r = Number(typeof rand === 'function' ? rand() : Math.random());
      const idx = r >= 0 && r < 1 ? Math.floor(r * options.length) : 0;
      return options[Math.min(options.length - 1, idx)];
    };

    const out = [];
    const emit = (kind, text) => {
      if (text) out.push({ kind, text, q: text.endsWith('?') });
    };

    // Probe a thread raised in the newest or the previous user turn.
    const th = state.thread;
    if (th && th.value && prev !== 'follow-up' && typeof th.since === 'number'
      && th.since >= state.turn - 1 && !sameValue('follow-up', th.value)) {
      emit('follow-up', pick(FOLLOW_UP[th.kind] || FOLLOW_UP.topic, th.value));
    }

    // Remark on a question the user swerved, at most twice per transcript.
    if (state.dodged && prev !== 'dodged' && count('dodged') < 2) {
      emit('dodged', pick(DODGED, null));
    }

    // Note a person or event that was dropped, once per value.
    const ab = state.abandoned;
    if (ab && ab.value && prev !== 'abandoned' && !sameValue('abandoned', ab.value)) {
      emit('abandoned', pick(ABANDONED, ab.value));
    }

    return out;
  } catch (err) {
    return [];
  }
}
