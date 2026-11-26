/**
 * understand.js - a light, rule-based reading of one diary entry (GitHub issue #33).
 *
 * Exports:
 *   analyze(text) -> {
 *     negation: boolean,     the main clause is negated
 *     negated: string[],     content lemmas under negation ("i'm not happy" -> ['happy'])
 *     tense: 'past' | 'present' | 'future',
 *     question: null | 'about-diary' | 'about-self' | 'general',
 *     names: string[],       people's names, capitalised
 *     places: string[],      places, capitalised
 *     topics: string[],      up to five salient nouns, lowercase singular
 *     words: number          word count
 *   }
 *
 * Word lists and regular expressions only, so it works offline. When nlp.js
 * reports that compromise is ready, the people, places and nouns it finds
 * through extractFacts() are merged in. Synchronous. Never throws.
 */

import { nlpReady, extractFacts } from './nlp.js';

// ---------------------------------------------------------------------------
// Word lists
// ---------------------------------------------------------------------------

const NEGATORS = new Set(['not', 'no', 'never', 'nothing', 'nobody', 'nowhere', 'neither', 'nor',
  'cannot', 'hardly', 'barely', 'none', 'nope']);
const NEGATIVE_CONTRACTIONS = new Set(['dont', 'doesnt', 'didnt', 'cant', 'wont', 'isnt', 'arent',
  'wasnt', 'werent', 'havent', 'hasnt', 'hadnt', 'wouldnt', 'couldnt', 'shouldnt', 'mustnt', 'aint']);

const FUNCTION_WORDS = [
  // pronouns
  'i', 'me', 'my', 'mine', 'myself', 'you', 'your', 'yours', 'yourself', 'he', 'him', 'his', 'himself',
  'she', 'her', 'hers', 'herself', 'it', 'its', 'itself', 'we', 'us', 'our', 'ours', 'ourselves',
  'they', 'them', 'their', 'theirs', 'themselves',
  // determiners and deixis
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'there', 'here', 'some', 'any', 'all', 'each',
  'every', 'both', 'such',
  // auxiliaries and modals
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'do', 'does', 'did', 'doing', 'done',
  'have', 'has', 'had', 'having', 'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might',
  'must', 'going', 'gonna', 'wanna',
  // contractions that carry no negation
  "i'm", "i've", "i'd", "i'll", "it's", "that's", "there's", "here's", "what's", "he's", "she's",
  "they're", "we're", "you're", "you've", "you'll", "we'll", "they'll", "it'll", "let's",
  // prepositions and conjunctions
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'about', 'into', 'onto', 'over', 'under',
  'as', 'than', 'if', 'then', 'because', 'but', 'and', 'or', 'so', 'yet', 'while', 'though', 'although',
  'until', 'till', 'when', 'where', 'what', 'which', 'who', 'whom', 'whose', 'why', 'how', 'up', 'down',
  'out', 'off', 'back', 'around', 'through',
  // adverbs, time words and fillers
  'just', 'also', 'only', 'even', 'still', 'ever', 'always', 'really', 'very', 'too', 'quite', 'much',
  'more', 'most', 'less', 'anymore', 'any', 'now', 'ok', 'okay', 'yeah', 'yes', 'idk', 'ngl', 'tbh',
  'lol', 'um', 'uh', 'hmm', 'oh', 'anyway', 'well', 'honestly', 'actually', 'basically', 'literally',
  'today', 'tonight', 'tomorrow', 'yesterday', 'soon', 'later', 'ago', 'earlier', 'finally', 'since', 'next',
  'apparently', 'seriously', 'sadly', 'maybe', 'probably', 'suddenly', 'unfortunately', 'thankfully',
  'obviously', 'hello', 'hi', 'hey', 'sorry', 'thanks', 'please',
];
const DAYS_MONTHS = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
  'sunday', 'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october',
  'november', 'december', 'christmas', 'easter']);
const STOP = new Set([...FUNCTION_WORDS, ...DAYS_MONTHS]);

const RELATIONS = new Set(['friend', 'friends', 'mate', 'bestie', 'sister', 'brother', 'mum', 'mom',
  'mother', 'dad', 'father', 'boss', 'partner', 'wife', 'husband', 'girlfriend', 'boyfriend', 'son',
  'daughter', 'aunt', 'uncle', 'cousin', 'nan', 'nana', 'grandma', 'grandad', 'grandpa', 'grandmother',
  'grandfather', 'neighbour', 'neighbor', 'colleague', 'roommate', 'flatmate', 'housemate', 'kid',
  'kids', 'child', 'children', 'teacher', 'doctor', 'therapist', 'ex', 'manager', 'landlord', 'coworker',
  'lover', 'fiance', 'fiancee', 'bf', 'gf', 'family', 'parents']);

// Common verbs: never names, and never salient nouns.
const VERB_WORDS = new Set(['say', 'said', 'says', 'call', 'called', 'calls', 'text', 'texted', 'ring',
  'rang', 'rings', 'message', 'messaged', 'ask', 'asked', 'tell', 'told', 'reply', 'replied', 'keep',
  'keeps', 'kept', 'write', 'wrote', 'send', 'sent', 'leave', 'left', 'move', 'moved', 'got', 'come',
  'came', 'went', 'feel', 'feels', 'felt', 'think', 'thinks', 'want', 'wants', 'need', 'needs', 'like',
  'love', 'hate', 'know', 'knows', 'look', 'looks', 'seem', 'seems', 'make', 'makes', 'made', 'go',
  'goes', 'getting', 'driving', 'checking', 'typing', 'walked']);

// Adverbs that are never salient nouns.
const TOPIC_SKIP = new Set(['again', 'else', 'enough', 'away', 'home', 'anymore', 'instead', 'maybe']);

// Common nouns, verbs and adjectives that are never a name.
const NOT_NAME = new Set([
  ...STOP, ...RELATIONS, ...DAYS_MONTHS,
  'everyone', 'everybody', 'someone', 'somebody', 'anyone', 'anybody', 'people', 'folks', 'guys',
  'car', 'bus', 'train', 'job', 'work', 'phone', 'dog', 'cat', 'house', 'flat', 'room', 'home', 'week',
  'weekend', 'day', 'days', 'night', 'time', 'life', 'world', 'guy', 'girl', 'man', 'woman', 'baby',
  'thing', 'things', 'bed', 'tea', 'coffee', 'money', 'bills', 'bill', 'rent', 'school', 'office',
  'email', 'emails', 'text', 'texts', 'message', 'plan', 'idea', 'party', 'meeting', 'sofa', 'door',
  'mind', 'head', 'heart', 'body', 'hands', 'face', 'lunch', 'dinner', 'breakfast', 'morning',
  'evening', 'diary', 'page', 'cake', 'food', 'shop', 'town', 'city', 'street', 'road', 'lord', 'god',
  ...VERB_WORDS,
  'tired', 'happy', 'sad', 'angry', 'lonely', 'anxious', 'bored', 'ashamed', 'guilty', 'jealous',
  'scared', 'exhausted', 'hurt', 'empty', 'miserable', 'worried', 'furious', 'nervous', 'depressed',
  'lost', 'numb', 'calm', 'relieved', 'confused', 'overwhelmed', 'hopeless', 'glad', 'unhappy',
  'knackered', 'fine', 'good', 'bad', 'great', 'awful', 'terrible', 'well',
]);

// Sentence-level adjectives that should not count as salient nouns.
const FEELING_ADJ = new Set(['tired', 'happy', 'sad', 'angry', 'lonely', 'anxious', 'bored', 'ashamed',
  'guilty', 'jealous', 'grieving', 'scared', 'exhausted', 'hurt', 'empty', 'miserable', 'worried',
  'furious', 'nervous', 'depressed', 'lost', 'numb', 'calm', 'relieved', 'confused', 'overwhelmed',
  'hopeless', 'frightened', 'glad', 'unhappy', 'weary', 'broken', 'drained', 'restless', 'stressed',
  'knackered', 'fine', 'okay', 'good', 'bad', 'great', 'awful', 'terrible', 'afraid', 'sorry']);

// Verbs that commonly follow a name: "Priya won't", "Margaret called".
const VERBS_AFTER_NAME = ['said', 'says', 'called', 'calls', 'texted', 'texts', 'rang', 'rings',
  'messaged', 'messages', 'asked', 'asks', 'told', 'tells', 'replied', 'replies', 'keeps', 'kept',
  "won't", 'wont', "wouldn't", 'wouldnt', "didn't", 'didnt', "doesn't", 'doesnt', "hasn't", 'hasnt',
  "isn't", 'isnt', 'never', 'still', 'wrote', 'emailed', 'sent', 'cancelled', 'canceled', 'forgot',
  'forgets', 'invited', 'mentioned', 'shouted', 'laughed', 'cried', 'hates', 'loves', 'wants',
  'thinks', 'admitted', 'promised', 'left', 'moved', 'got', 'came', 'went', 'will', 'would'];
const NAME_VERB_RE = new RegExp(`\\b([A-Za-z][A-Za-z'-]*)\\s+(${VERBS_AFTER_NAME.join('|')})\\b`, 'gi');
const MY_RELATION_RE = new RegExp(
  `\\bmy\\s+(?:(?:best|old|close|good|dear|oldest|younger|older|new)\\s+)?(?:${[...RELATIONS].join('|')})\\s+([A-Za-z][A-Za-z'-]*)`,
  'gi',
);

// Verbs that take a person after them, so "said to Margaret" is not a place.
const SPEECH_VERBS = new Set(['said', 'talked', 'spoke', 'told', 'texted', 'wrote', 'emailed',
  'messaged', 'replied', 'shouted', 'whispered', 'gave', 'sent', 'listened', 'explained', 'lied',
  'apologised', 'apologized', 'admitted', 'confessed', 'asked', 'called', 'rang']);

// Irregular past forms, and their lemmas.
const IRREGULAR = {
  spoke: 'speak', spoken: 'speak', felt: 'feel', went: 'go', gone: 'go', saw: 'see', seen: 'see',
  got: 'get', gotten: 'get', said: 'say', told: 'tell', thought: 'think', knew: 'know', known: 'know',
  came: 'come', left: 'leave', lost: 'lose', made: 'make', took: 'take', taken: 'take', gave: 'give',
  given: 'give', ran: 'run', wrote: 'write', written: 'write', sat: 'sit', fell: 'fall', fallen: 'fall',
  drove: 'drive', ate: 'eat', eaten: 'eat', forgot: 'forget', forgotten: 'forget', began: 'begin',
  brought: 'bring', bought: 'buy', caught: 'catch', chose: 'choose', drank: 'drink', drew: 'draw',
  grew: 'grow', held: 'hold', kept: 'keep', meant: 'mean', met: 'meet', paid: 'pay', sent: 'send',
  slept: 'sleep', spent: 'spend', stood: 'stand', threw: 'throw', understood: 'understand', woke: 'wake',
  wore: 'wear', rang: 'ring', found: 'find', heard: 'hear', lent: 'lend', built: 'build', sold: 'sell',
  taught: 'teach', fought: 'fight', hid: 'hide',
};
const PAST_IRREGULAR = new Set(['was', 'were', 'had', 'did', ...Object.keys(IRREGULAR)]);

// -ed words that are usually adjectives or not past tense at all.
const NOT_PAST_ED = new Set(['need', 'feed', 'bed', 'speed', 'indeed', 'proceed', 'succeed', 'hundred',
  'shed', 'seed', 'weed', 'bleed', 'breed', 'greed', 'sacred', 'naked', 'wicked', 'tired', 'bored',
  'scared', 'excited', 'worried', 'relaxed', 'annoyed', 'confused', 'stressed', 'depressed', 'obsessed',
  'interested', 'exhausted', 'pleased', 'surprised', 'shocked', 'embarrassed', 'frustrated', 'amazed',
  'gutted', 'shattered', 'pissed', 'knackered', 'alarmed', 'delighted', 'concerned', 'terrified',
  'petrified', 'devastated', 'thrilled', 'fed']);

// Words ending in -ing that are not verb forms, so lemma() leaves them alone.
const NO_LEMMA_ING = new Set(['anything', 'something', 'everything', 'nothing', 'thing', 'things',
  'morning', 'evening', 'wedding', 'ceiling', 'building', 'string', 'spring', 'king', 'ring', 'sibling',
  'bring', 'sing', 'swing', 'wing', 'during', 'pudding', 'painting', 'meeting', 'feeling']);

const FUTURE_RE = new RegExp(
  '\\b(?:will|shall|gonna|i\'ll|we\'ll|you\'ll|they\'ll|he\'ll|she\'ll|it\'ll|tomorrow|soon|' +
  'next (?:week|month|year|time|day|weekend|summer|winter|spring|autumn|monday|tuesday|wednesday|' +
  'thursday|friday|saturday|sunday))\\b|(?<!\\b(?:was|were)\\s)\\bgoing to\\b',
);
const PAST_MARKER_RE = /\b(?:yesterday|ago|last (?:night|week|month|year|time|summer|winter|spring|autumn|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/;

const WH_WORDS = new Set(['who', 'what', 'where', 'when', 'why', 'how', 'which', 'whose', 'whom',
  "what's", "who's", "where's", "how's", "why's"]);
const AUX_START = new Set(['is', 'are', 'am', 'was', 'were', 'do', 'does', 'did', 'can', 'could',
  'should', 'would', 'will', 'shall', 'have', 'has', 'had', 'may', 'might', 'must', "isn't", "aren't",
  "don't", "doesn't", "didn't", "can't", "won't", "wouldn't", "shouldn't", "couldn't", "haven't",
  "hasn't", "wasn't", "weren't", 'isnt', 'arent', 'dont', 'doesnt', 'didnt', 'cant', 'wont']);
const SUBJECT_NEXT = new Set(['i', 'you', 'he', 'she', 'it', 'we', 'they', 'this', 'that', 'there',
  'the', 'my', 'your', 'these', 'those', 'someone', 'anyone', 'everyone', 'nobody', 'something',
  'anything', 'life', 'people', 'a', 'an', 'is', 'are', 'was', 'were', 'do', 'does', 'did', 'can',
  'could', 'should', 'would', 'will', 'have', 'has', 'had']);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function normalise(text) {
  return String(text ?? '')
    .replace(/[\u2018\u2019\u0060\u00b4]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensOf(s) {
  return s.toLowerCase().match(/[a-z0-9]+(?:'[a-z]+)*/g) || [];
}

function isNegator(t) {
  return NEGATORS.has(t) || NEGATIVE_CONTRACTIONS.has(t) || (t.length > 3 && t.endsWith("n't"));
}

function isContent(t) {
  return t.length >= 2 && !STOP.has(t) && !isNegator(t) && !/^\d+$/.test(t);
}

/** A crude lemma: enough for "feels" -> "feel" and "hated" -> "hate". */
function lemma(w) {
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (NOT_PAST_ED.has(w) || NO_LEMMA_ING.has(w)) return w;
  if (w.length > 4 && w.endsWith('ied')) return `${w.slice(0, -3)}y`;
  if (w.length > 5 && w.endsWith('ing')) return undoubleOrE(w.slice(0, -3));
  if (w.length > 4 && w.endsWith('ed')) return undoubleOrE(w.slice(0, -2));
  if (w.length > 3 && w.endsWith('s') && !/(ss|us|is|ous|ys)$/.test(w)) return w.slice(0, -1);
  return w;
}

function undoubleOrE(stem) {
  if (stem.length < 3) return stem;
  if (/([b-df-hj-np-tv-z])\1$/.test(stem) && !/(ll|ss|ff|zz)$/.test(stem)) return stem.slice(0, -1);
  if (stem.length <= 4 && /[^aeiou][aeiou][bcdfgklmnprstvz]$/.test(stem)) return `${stem}e`;
  return stem;
}

/** Plural to singular for topics. Only the common English patterns. */
function singular(w) {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !/(ss|us|is|ous)$/.test(w)) return w.slice(0, -1);
  return w;
}

function cap(w) {
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

function baseWord(w) {
  return w.replace(/'s$/i, '').replace(/[^A-Za-z'-]/g, '').replace(/'+$/, '');
}

// ---------------------------------------------------------------------------
// Negation
// ---------------------------------------------------------------------------

// Clause boundaries: punctuation and a few conjunctions.
const CLAUSE_SPLIT = /[.!?;:,]+|\s+(?:but|because|although|though|while|until|and|or)\s+|\s+[-\u2013\u2014]\s+/i;

/**
 * Negation scope. Content words after the negator in its clause are negated.
 * If nothing follows it ("i feel nothing"), the content words before it are.
 * negation is true when any clause is negated; the clauses are split at
 * punctuation and conjunctions, so "my dad and i haven't spoken" counts.
 */
function negationOf(clauses) {
  const negated = new Set();
  let negation = false;
  for (const c of clauses) {
    const idx = c.toks.findIndex(isNegator);
    if (idx < 0) continue;
    negation = true;
    let scope = c.toks.slice(idx + 1).filter(isContent);
    if (scope.length === 0) scope = c.toks.slice(0, idx).filter(isContent);
    for (const t of scope) negated.add(lemma(t));
  }
  return { negation, negated: [...negated] };
}

// ---------------------------------------------------------------------------
// Tense
// ---------------------------------------------------------------------------

function tenseOf(lower, toks) {
  if (FUTURE_RE.test(lower)) return 'future';
  if (PAST_MARKER_RE.test(lower)) return 'past';
  for (const t of toks) {
    if (PAST_IRREGULAR.has(t)) return 'past';
    if (t.length >= 4 && t.endsWith('ed') && !NOT_PAST_ED.has(t)) return 'past';
  }
  return 'present';
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

function questionOf(raw, toks) {
  const first = toks[0];
  if (!first) return null;
  const second = toks[1] || '';
  const endsQuestion = /\?\s*$/.test(raw);
  let isQuestion = endsQuestion;
  if (!isQuestion && WH_WORDS.has(first)) {
    isQuestion = !['a', 'an', 'the'].includes(second);
  }
  if (!isQuestion && AUX_START.has(first)) {
    isQuestion = SUBJECT_NEXT.has(second);
  }
  if (!isQuestion) return null;

  const lower = raw.toLowerCase();
  if (/\b(?:you|your|yours|yourself|yourselves)\b/.test(lower)) return 'about-diary';
  if (/\b(?:am|was|should|do|did|can|could|would|will|shall|have|has|had|is|are|may|might|must)\s+i\b/.test(lower)
    || /\b(?:should|do|did|can|could|would|will|shall|am|was)\s+i\s+(?:do|be|say|tell|go|try)\b/.test(lower)) {
    return 'about-self';
  }
  return 'general';
}

// ---------------------------------------------------------------------------
// Names and places
// ---------------------------------------------------------------------------

function isNameWord(w) {
  const base = baseWord(w);
  return base.length >= 2 && /^[A-Za-z][A-Za-z'-]*$/.test(base) && !NOT_NAME.has(base.toLowerCase());
}

function addUnique(list, value) {
  if (!value) return;
  if (!list.some((x) => x.toLowerCase() === value.toLowerCase())) list.push(value);
}

/** True when `word` is a sentence-initial position in `raw` at `index`. */
function startsSentence(raw, index) {
  const before = raw.slice(0, index).trimEnd();
  return before === '' || /[.!?"\u201c(]$/.test(before);
}

function entitiesOf(raw, facts) {
  const names = [];
  const places = [];

  // Capitalised words in the raw text, lowercased, for checking compromise's finds.
  const capitalised = new Set((raw.match(/[A-Z][A-Za-z'-]*/g) || []).map((w) => baseWord(w).toLowerCase()));

  if (facts) {
    for (const f of facts) {
      const parts = f.topic.split(' ');
      if (f.kind === 'person' && !RELATIONS.has(f.topic) && !NOT_NAME.has(f.topic)
        && parts.every((p) => capitalised.has(p))) {
        addUnique(names, parts.map(cap).join(' '));
      } else if (f.kind === 'place' && parts.every((p) => capitalised.has(p))) {
        addUnique(places, parts.map(cap).join(' '));
      }
    }
  }

  // "my friend Dev", "my sister Anna".
  for (const m of raw.matchAll(MY_RELATION_RE)) {
    if (isNameWord(m[1])) addUnique(names, cap(baseWord(m[1])));
  }

  // "Priya won't", "Margaret called", "dev said" (lowercase allowed before a verb).
  for (const m of raw.matchAll(NAME_VERB_RE)) {
    if (isNameWord(m[1])) addUnique(names, cap(baseWord(m[1])));
  }

  // Sentence-initial name before "and" or an auxiliary: "Anna and I went", "Rick is".
  for (const m of raw.matchAll(/(^|[.!?]\s+)([A-Z][A-Za-z'-]*)(?=\s+(?:and|is|was|has|had|went|came|will|would|did|does)\b)/g)) {
    if (isNameWord(m[2])) addUnique(names, cap(baseWord(m[2])));
  }

  // Capitalised runs that are not at the start of a sentence: "I keep calling her Margaret".
  for (const m of raw.matchAll(/\b[A-Z][A-Za-z'-]*(?:\s+[A-Z][A-Za-z'-]*)*/g)) {
    let words = m[0].split(' ');
    if (startsSentence(raw, m.index)) words = words.slice(1);
    let run = [];
    for (const w of [...words, '']) {
      if (w && isNameWord(w)) {
        run.push(baseWord(w));
      } else if (run.length) {
        addUnique(names, run.map(cap).join(' '));
        run = [];
      }
    }
  }

  // Places: "in Leeds", "on Elm Street". The capitalised run after the preposition.
  for (const m of raw.matchAll(/\b(in|at|to|from|on|near|around|outside|into|across)\s+(?:the\s+)?([A-Z][A-Za-z'-]*(?:\s+[A-Z][A-Za-z'-]*)*)/g)) {
    const prev = raw.slice(0, m.index).trim().split(' ').pop().toLowerCase();
    if (SPEECH_VERBS.has(prev)) continue;
    const words = m[2].split(' ').map(baseWord).filter(Boolean);
    const firstLower = words[0].toLowerCase();
    if (words[0] === 'I' || DAYS_MONTHS.has(firstLower) || RELATIONS.has(firstLower) || STOP.has(firstLower)) continue;
    addUnique(places, words.map(cap).join(' '));
  }

  // A name that is only a place word belongs to places, not names.
  const placeWords = new Set(places.flatMap((p) => p.toLowerCase().split(' ')));
  const cleanNames = names.filter((n) => !n.toLowerCase().split(' ').every((w) => placeWords.has(w)));

  return { names: cleanNames, places };
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

const PRONOUN_SUBJECT = new Set(['i', 'you', 'he', 'she', 'it', 'they', 'we', 'who']);
const AUX_OR_NEG_BEFORE = new Set(['do', 'does', 'did', 'dont', 'doesnt', 'didnt', 'not', "don't",
  "doesn't", "didn't", 'to', 'will', 'would', 'can', 'could', 'should', 'might', 'must']);

function topicsOf(toks, names, places, factTopics) {
  const nameWords = new Set(names.flatMap((n) => n.toLowerCase().split(' ')));
  const placeWords = new Set(places.flatMap((p) => p.toLowerCase().split(' ')));
  const out = [];
  const add = (w) => { if (out.length < 5 && !out.includes(w)) out.push(w); };

  for (const t of factTopics) {
    if (!nameWords.has(t) && !placeWords.has(t)) add(singular(t));
  }

  toks.forEach((t, i) => {
    if (!/^[a-z]+$/.test(t) || t.length < 3) return;
    if (STOP.has(t) || isNegator(t) || FEELING_ADJ.has(t) || VERB_WORDS.has(t) || TOPIC_SKIP.has(t)) return;
    if (nameWords.has(t) || placeWords.has(t)) return;
    // Verb forms, not nouns: irregular past participles, -ed and -ing forms.
    if (IRREGULAR[t] || (t.endsWith('ed') && !NOT_PAST_ED.has(t)) || (t.endsWith('ing') && !NO_LEMMA_ING.has(t))) return;
    const prev = toks[i - 1] || '';
    if (PRONOUN_SUBJECT.has(prev) || AUX_OR_NEG_BEFORE.has(prev)) return; // verbs, not nouns
    add(singular(t));
  });
  return out;
}

// ---------------------------------------------------------------------------
// analyze
// ---------------------------------------------------------------------------

function emptyResult() {
  return {
    negation: false,
    negated: [],
    tense: 'present',
    question: null,
    names: [],
    places: [],
    topics: [],
    words: 0,
  };
}

/**
 * Reads one diary entry. Synchronous. Empty input gives empty results.
 * @param {string} text
 */
export function analyze(text) {
  try {
    const raw = normalise(text);
    const wordCount = (raw.match(/[A-Za-z0-9]+(?:'[A-Za-z]+)*/g) || []).length;
    if (!raw || wordCount === 0) return emptyResult();

    const clauses = raw.split(CLAUSE_SPLIT)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => ({ text: s, toks: tokensOf(s) }))
      .filter((c) => c.toks.length > 0);
    const toks = tokensOf(raw);

    const { negation, negated } = negationOf(clauses);
    const tense = tenseOf(raw.toLowerCase(), toks);
    const question = questionOf(raw, toks);

    const facts = nlpReady() ? extractFacts(raw) : null;
    const { names, places } = entitiesOf(raw, facts);

    // Only things and events from compromise; people and places are handled above.
    const factTopics = facts
      ? facts.filter((f) => f.kind === 'thing' || f.kind === 'event').map((f) => f.topic)
      : [];
    const topics = topicsOf(toks, names, places, factTopics);

    return { negation, negated, tense, question, names, places, topics, words: wordCount };
  } catch {
    return emptyResult();
  }
}
