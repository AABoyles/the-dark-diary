// Optional natural-language helpers for the Dark Diary.
//
// compromise.js is loaded lazily from a CDN the first time loadNlp() is
// called. Until it arrives, or if it never does, every function here either
// returns null (reflectClause) or falls back to plain regular expressions
// (extractFacts). Nothing throws, and nothing waits on the network.

const COMPROMISE_URL = 'https://cdn.jsdelivr.net/npm/compromise@14.20.0/builds/three/compromise-three.mjs';

let nlp = null;
let loading = null;

/**
 * Load compromise once. Resolves true when it is ready, false otherwise.
 * Never rejects.
 * @returns {Promise<boolean>}
 */
export function loadNlp() {
  if (!loading) {
    loading = (async () => {
      try {
        const mod = await import(COMPROMISE_URL);
        const lib = mod && (mod.default || mod);
        if (typeof lib !== 'function') return false;
        nlp = lib;
        return true;
      } catch (err) {
        return false;
      }
    })();
  }
  return loading;
}

/** True once compromise has been loaded (or injected for tests). */
export function nlpReady() {
  return nlp !== null;
}

// Test hook: inject a compromise module without touching the network.
// Pass null to reset to the regex-only state.
export function __setCompromiseForTest(mod) {
  const lib = mod && (mod.default || mod);
  nlp = typeof lib === 'function' ? lib : null;
}

// ---------------------------------------------------------------------------
// Pronoun tables
// ---------------------------------------------------------------------------

// The user's first person becomes the diary's second person, and vice versa.
const TO_DIARY = {
  i: 'you', me: 'you', my: 'your', mine: 'yours', myself: 'yourself',
  we: 'you', us: 'you', our: 'your', ours: 'yours', ourselves: 'yourselves',
};
const TO_USER = { you: 'I', your: 'my', yours: 'mine', yourself: 'myself', yourselves: 'ourselves' };

// Contractions expanded before tagging, so the verb after them is visible.
const CONTRACTIONS = [
  [/\bI'm\b/gi, 'I am'], [/\bI've\b/gi, 'I have'], [/\bI'll\b/gi, 'I will'], [/\bI'd\b/gi, 'I would'],
  [/\byou're\b/gi, 'you are'], [/\byou've\b/gi, 'you have'], [/\byou'll\b/gi, 'you will'],
  [/\byou'd\b/gi, 'you would'], [/\bwe're\b/gi, 'we are'], [/\bwe've\b/gi, 'we have'],
];

// Adverbs and negations that may sit between a subject and its verb.
const BETWEEN = new Set(['not', 'never', 'always', 'still', 'just', 'really', 'also', 'so',
  'very', 'quite', 'too', 'only', 'often', 'sometimes', 'already', 'now', 'ever']);

/**
 * Rewrite a clause from the user's point of view into the diary's voice, so
 * "I am tired of my job" becomes "you are tired of your job". Verb agreement
 * follows the new subject. Returns null if compromise is not ready or anything
 * goes wrong.
 * @param {string} text
 * @returns {string|null}
 */
export function reflectClause(text) {
  if (!nlp) return null;
  try {
    let src = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!src) return null;
    for (const [re, rep] of CONTRACTIONS) src = src.replace(re, rep);

    const terms = nlp(src).json({ terms: { text: true, pre: true, post: true, tags: true } })[0]?.terms || [];
    if (terms.length === 0) return null;

    // Subject of the verb we may be about to meet: 'I', 'you' or 'we', from
    // the original clause. Cleared by any word that is not an adverb or negation.
    let pending = null;
    let out = '';
    terms.forEach((term, idx) => {
      const orig = term.text || '';
      const lower = orig.toLowerCase();
      let rep = orig;
      let subj = null;

      if (Object.prototype.hasOwnProperty.call(TO_DIARY, lower)) {
        rep = TO_DIARY[lower];
        subj = lower;
      } else if (Object.prototype.hasOwnProperty.call(TO_USER, lower)) {
        rep = TO_USER[lower];
        subj = lower;
      } else if (pending && /^(am|is|are|was|were)$/.test(lower)) {
        // Be-verbs agree with the new subject: I am -> you are, you are -> I am.
        if (pending === 'i' || pending === 'we') {
          rep = /^(was|were)$/.test(lower) ? 'were' : 'are';
        } else if (pending === 'you') {
          rep = /^(was|were)$/.test(lower) ? 'was' : 'am';
        }
      } else if (pending && (pending === 'i' || pending === 'you') && BETWEEN.has(lower) === false) {
        // Third-person present forms (keeps, has, does) take the base form.
        const conj = nlp(lower).verbs().conjugate()[0];
        if (conj && conj.PresentTense === lower && conj.Infinitive && conj.Infinitive !== lower) {
          rep = conj.Infinitive;
        }
      }

      if (rep !== orig && idx === 0 && /^[A-Z]/.test(orig) && rep !== 'I') {
        rep = rep.charAt(0).toUpperCase() + rep.slice(1);
      }

      out += (term.pre || '') + rep + (term.post || '');

      if (subj) pending = subj;
      else if (!BETWEEN.has(lower)) pending = null;
    });

    out = out.replace(/\s+/g, ' ').trim();
    return out || null;
  } catch (err) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fact extraction
// ---------------------------------------------------------------------------

const GREETINGS = /^(hello|hi|hey|hiya|howdy|greetings|yo|good (morning|afternoon|evening|night))\b/i;

const PERSON_NOUNS = new Set(['sister', 'brother', 'mother', 'mum', 'mom', 'mother', 'father', 'dad',
  'boss', 'friend', 'partner', 'wife', 'husband', 'girlfriend', 'boyfriend', 'son', 'daughter',
  'aunt', 'uncle', 'cousin', 'grandmother', 'grandfather', 'grandma', 'grandpa', 'neighbour',
  'neighbor', 'colleague', 'roommate', 'flatmate', 'kid', 'kids', 'child', 'children', 'teacher',
  'doctor', 'therapist', 'ex', 'parents', 'family', 'lover', 'manager', 'landlord', 'coworker']);

const PLACE_NOUNS = new Set(['house', 'home', 'flat', 'apartment', 'room', 'town', 'city', 'village',
  'country', 'street', 'school', 'office', 'bedroom', 'kitchen', 'garden', 'church', 'hospital']);

const EVENT_NOUNS = new Set(['wedding', 'birthday', 'funeral', 'party', 'exam', 'interview', 'meeting',
  'holiday', 'trip', 'breakup', 'divorce', 'accident', 'argument', 'fight', 'diagnosis', 'surgery',
  'anniversary', 'graduation', 'christening', 'vacation']);

const FEELINGS = new Set(['tired', 'afraid', 'angry', 'lonely', 'happy', 'anxious', 'bored', 'ashamed',
  'guilty', 'jealous', 'grieving', 'sad', 'scared', 'exhausted', 'hurt', 'empty', 'miserable',
  'worried', 'furious', 'nervous', 'depressed', 'lost', 'numb', 'calm', 'relieved', 'confused',
  'overwhelmed', 'hopeless', 'frightened', 'glad', 'unhappy', 'weary', 'broken', 'drained',
  'restless', 'stressed', 'lonesome']);

// Words that do not make a useful topic after "my".
const STOP_TOPIC = new Set(['own', 'way', 'mind', 'word', 'turn', 'fault', 'sake', 'time', 'thing',
  'things', 'idea', 'self', 'god', 'goodness', 'first', 'last', 'best', 'same', 'new', 'old', 'next',
  'other', 'whole', 'only', 'real', 'true']);

const MAX_FACTS = 3;

// Clause boundaries for the "phrase" of a fact.
const CLAUSE_SPLIT = /[.!?;,]+|\s+(?:but|and|because|so|although|though|while)\s+/i;

function clausePhrase(src, topic) {
  const t = topic.toLowerCase();
  const clauses = src.split(CLAUSE_SPLIT).map((c) => c.trim()).filter(Boolean);
  const clause = clauses.find((c) => (c.toLowerCase().match(/[a-z']+/g) || []).includes(t)) || src;
  const words = clause.split(/\s+/).filter(Boolean);
  if (words.length <= 12) return words.join(' ');
  const idx = Math.max(0, words.findIndex((w) => w.toLowerCase().replace(/[^a-z']/g, '') === t));
  let start = Math.max(0, idx - 6);
  const end = Math.min(words.length, start + 12);
  start = Math.max(0, end - 12);
  return words.slice(start, end).join(' ');
}

function headNounKind(noun) {
  if (PERSON_NOUNS.has(noun)) return 'person';
  if (PLACE_NOUNS.has(noun)) return 'place';
  if (EVENT_NOUNS.has(noun)) return 'event';
  return 'thing';
}

/**
 * Facts worth remembering from one user message. Synchronous. Uses compromise
 * when ready, a regex fallback otherwise. At most three, deduped by topic.
 * @param {string} text
 * @returns {Array<{topic: string, phrase: string, kind: 'person'|'place'|'thing'|'feeling'|'event'}>}
 */
export function extractFacts(text) {
  try {
    const src = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    const lower = src.toLowerCase();
    const words = lower.match(/[a-z']+/g) || [];
    if (words.length < 3) return [];
    if (GREETINGS.test(lower) && words.length <= 4) return [];
    if (/\?\s*$/.test(src) && /\b(you|your|yours|yourself)\b/i.test(src)) return [];

    const found = []; // {topic, kind}
    const add = (topic, kind) => {
      const t = String(topic || '').toLowerCase().replace(/[^a-z' ]/g, '').trim();
      if (t.length < 2 || STOP_TOPIC.has(t)) return;
      if (!found.some((f) => f.topic === t)) found.push({ topic: t, kind });
    };

    if (nlp) {
      try {
        const doc = nlp(src);
        doc.people().out('array').forEach((name) => add(name.split(' ').pop(), 'person'));
        doc.match('my #Adjective? #Noun+').out('array').forEach((m) => {
          const head = (m.toLowerCase().match(/[a-z']+/g) || []).pop();
          if (head) add(head, headNounKind(head));
        });
        doc.match('i (am|feel|was) #Adverb? #Adjective').out('array').forEach((m) => {
          const head = (m.toLowerCase().match(/[a-z']+/g) || []).pop();
          if (head && head !== 'am' && head !== 'feel') add(head, 'feeling');
        });
        doc.places().out('array').forEach((p) => add(p, 'place'));
      } catch (err) {
        // Fall through to the regex pass below.
      }
    }

    // Regex pass: works without compromise, and tops up what it found.
    for (const m of lower.matchAll(/\bmy ((?:[a-z]+ ){0,2}[a-z]+)/g)) {
      // The head noun is the first word after "my" that is not a stop word.
      const noun = m[1].split(' ').find((p) => !STOP_TOPIC.has(p));
      if (noun && noun.length >= 3) add(noun, headNounKind(noun));
    }
    for (const m of lower.matchAll(/\bi (?:am|feel|feels|felt|was)\s+(?:so |very |really |too |quite |always |still )?([a-z]+)/g)) {
      if (FEELINGS.has(m[1])) add(m[1], 'feeling');
    }
    for (const w of words) {
      if (EVENT_NOUNS.has(w)) add(w, 'event');
    }

    return found.slice(0, MAX_FACTS).map((f) => ({
      topic: f.topic,
      phrase: clausePhrase(src, f.topic),
      kind: f.kind,
    }));
  } catch (err) {
    return [];
  }
}
