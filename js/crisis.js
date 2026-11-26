/**
 * crisis.js - detects self-harm language, by fixed phrase and by meaning.
 *
 * Exports:
 *   CRISIS_EXAMPLES                       first-person examples of suicidal ideation,
 *                                         self-harm intent or hopelessness with intent
 *   NEAR_MISS_EXAMPLES                    dark but safe hyperbole and jokes that must not trigger
 *   crisisByPhrase(text)     -> boolean   broad regex list, tolerant of apostrophes and typos
 *   isCrisis(text, opts)     -> Promise<{ crisis, by, score }>
 *   crisisReply(previous)    -> string    a kind reply with no question in it
 *
 * Meaning check: the text and the example sentences are embedded and compared by
 * cosine similarity. A text is a crisis when it is close enough to a crisis example
 * and clearly closer to those than to a near-miss example. Never throws.
 */

import { embed, embedderReady } from './embed.js';

export const CRISIS_EXAMPLES = [
  "i don't want to be here anymore",
  'i dont want to live anymore',
  'everyone would be better off without me',
  'thinking about ending things',
  "i've been cutting again",
  'kms',
  'i want to unalive myself',
  'i have the pills ready',
  "what's the point of living",
  'i want to disappear forever',
  'i wish i could just stop existing',
  'nobody would even notice if i was gone',
  'i keep thinking about how to end it',
  "i'm planning how i'd do it tonight",
  'i have a plan and the means to do it',
  "i don't see a reason to keep going",
  "i'm a burden to everyone and they'd be relieved",
  'i wish i had never been born',
  "i'd rather be dead than feel like this",
  'i want to go to sleep and never wake up',
  "i've started cutting my arms again",
  'i keep burning myself to feel something',
  'i took a bunch of my sleeping tablets',
  "i don't want to exist anymore",
  "i'm done with life",
  'i want everything to stop, permanently',
  "i'm going to end my life",
  'i think about killing myself every day',
  'i want to kill myself',
  "i'd be happier dead",
  "there is no way out but the final one",
  "i've been writing my goodbye note",
  "i'm giving away my things, it's my way of saying goodbye",
  "i can't take this life anymore",
  "i don't want to wake up tomorrow",
  'nothing matters and i do not want to be alive',
  "i'm so tired of being alive",
  "i'm going to hurt myself tonight",
  'i want to starve myself to nothing',
  'i think the world would be quieter without me in it',
  "it would be easier if i just weren't around",
  'i keep imagining the bridge and the drop',
  "i'm going to overdose so it's over",
  'tonight is the night i end it',
  "i've got the rope ready",
  "i don't feel safe with myself",
  "i'm hoping i don't wake up",
  "i can't go on like this",
  "life isn't worth living for me",
  "i'm ready to be gone for good",
];

export const NEAR_MISS_EXAMPLES = [
  'i could kill for a steak',
  'this traffic is killing me',
  "i'd die for that cake",
  'my feet are killing me',
  "i'm dead tired",
  'that joke killed me',
  'sharpening my knives for dinner',
  'murder mystery night',
  'my plants keep dying',
  'dying to know what happens next',
  "i'm going to kill my brother for eating my leftovers",
  'this heat is killing me, i am melting',
  "i'm so hungry i could eat a horse",
  'my phone battery died in the middle of the call',
  'the bread knife is dull, time to buy a new one',
  'that horror film was bloody brilliant',
  'i laughed so hard i nearly died',
  'the dinner party was an absolute disaster',
  'i cut the cake into twelve pieces',
  'i cut my hair short for the summer',
  "i'm dying to see the new season",
  "i'm going to murder this exam",
  'the kids are driving me up the wall, i could scream',
  'my laptop has died again',
  'this coffee is to die for',
  'i have to kill the lights before bed',
  "i'll kill it at the presentation tomorrow",
  "i'm bored to death of this meeting",
  "he's going to kill me when he sees the dent",
  'the sun is so hot it is going to kill us all',
  'i was so scared i thought i would die of embarrassment',
  'my sourdough starter is dying, help',
  'i bought a new knife set for the kitchen',
  'the spiders in the bath are the death of me',
  'dinner was a blood orange sorbet, delicious',
  'i spilled red wine on the rug',
  'i feel like i am drowning in emails',
  'i could sleep for a week after that marathon',
  "i'm going to wring his neck for the thing he said",
  'that cake was so good i could die happy',
];

// ---------------------------------------------------------------------------
// Phrase matching
// ---------------------------------------------------------------------------

/** Lowercase, apostrophes removed, everything else non-alphanumeric to spaces. */
function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/['‘’`´]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const PHRASE_PATTERNS = [
  // kill myself, killing myself, kil myslf, killmyself
  /\bk[a-z]{0,3}l+(?:ing|ed)?\s*my\s*(?:self|sel|slf|sefl)\b/,
  // end my life, ending me life
  /\bend(?:ing)?\s*(?:my|me)\s*(?:life|lfe)\b/,
  // end it all, ending it all
  /\bend(?:ing)?\s*it\s*all\b/,
  // thinking about ending it / things / everything / my life
  /\bthink\w*\s*(?:about|of)\s*end(?:ing)?\s*(?:it|things|everything|my life)\b/,
  // want to die, wanna die
  /\b(?:want|wanna)\s*(?:to\s*)?die\b/,
  // want to be dead, wish i was dead, happier dead, better off dead
  /\b(?:want|wanna|wish)\s*(?:to\s*)?be\s*dead\b|\bwish\s*i\s*(?:was|were)\s*dead\b|\bhappier\s*dead\b|\bbetter\s*off\s*dead\b/,
  // suicide, suicidal, sucide, sucidal, suicdal
  /\bsu(?:i)?c(?:i)?d[a-z]*/,
  // self harm, selfharm, self injury
  /\bself\s*(?:harm|injur|mutilat)[a-z]*/,
  // hurt myself, harm myself, cut myself, injure myself (also -ing)
  /\b(?:hurt|harm|cut|injure)(?:ing|s)?\s*my\s*(?:self|sel|slf)\b/,
  // overdose, overdosed, overdosing
  /\boverdos[a-z]*/,
  // unalive, unalived, unaliving
  /\bunalive[a-z]*/,
  // kms
  /\bkms\b/,
  // not want to live, don't want to be alive, no longer want to exist
  /\b(?:not|dont|do not|no longer|never)\s*(?:want|wanna)\s*to\s*(?:live|be alive|exist|keep living)\b/,
  // don't want to be here anymore
  /\bdont\s*want\s*to\s*be\s*(?:here|around|alive)\s*any\s*more\b/,
  // don't want to wake up
  /\b(?:dont|do not)\s*want\s*to\s*wake\s*up\b/,
  // wish i had never been born / woke up
  /\bwish\s*i\s*(?:had\s*)?never\s*(?:been\s*born|was\s*born|woke\s*up)\b/,
  // can't go on
  /\b(?:cant|cannot|can not)\s*go\s*on\b/,
  // no reason to live, no point in living
  /\bno\s*(?:reason|point)\s*(?:to|in)\s*(?:live|living|go on|keep going|carry on)\b/,
  // what's the point of living
  /\bpoint\s*(?:of|in)\s*living\b/,
  // better off without me, everyone would be better off dead
  /\b(?:better|best)\s*off\s*(?:without\s*me|dead|gone)\b|\bworld\s*(?:would\s*be\s*)?better\s*(?:off\s*)?without\s*me\b/,
  // take my own life
  /\btake\s*(?:my|the)\s*(?:own\s*)?life\b/,
];

/** True when the text contains a fixed self-harm phrase. Broad on purpose. */
export function crisisByPhrase(text) {
  const s = normalize(text);
  if (!s) return false;
  return PHRASE_PATTERNS.some((re) => re.test(s));
}

// ---------------------------------------------------------------------------
// Meaning matching
// ---------------------------------------------------------------------------

/** Cosine similarity that tolerates arrays and typed arrays. 0 when invalid. */
function cos(a, b) {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Per embedding function: a promise of { crisis: vecs[], near: vecs[] } or null. */
const exampleCache = new WeakMap();

async function embedAll(fn, texts) {
  const out = [];
  for (const t of texts) {
    const v = await fn(t);
    if (!v || v.length === 0) return null;
    out.push(v);
  }
  return out;
}

function loadExamples(fn) {
  let pending = exampleCache.get(fn);
  if (!pending) {
    pending = (async () => {
      try {
        const crisis = await embedAll(fn, CRISIS_EXAMPLES);
        const near = crisis ? await embedAll(fn, NEAR_MISS_EXAMPLES) : null;
        return crisis && near ? { crisis, near } : null;
      } catch {
        return null;
      }
    })();
    exampleCache.set(fn, pending);
    // A failed load is not kept, so a later call can try again.
    pending.then((v) => { if (!v && exampleCache.get(fn) === pending) exampleCache.delete(fn); });
  }
  return pending;
}

const NO_CRISIS = Object.freeze({ crisis: false, by: null, score: null });

/**
 * Decides whether `text` expresses self-harm or suicidal intent.
 * 1. A fixed phrase matches: crisis, by 'phrase'.
 * 2. Otherwise, if an embedder is available, compare meaning with the examples.
 * The default embedder is js/embed.js, used only when it is ready.
 */
export async function isCrisis(text, { embedFn, threshold = 0.5, margin = 0.04 } = {}) {
  try {
    const raw = String(text ?? '').trim();
    if (crisisByPhrase(raw)) return { crisis: true, by: 'phrase', score: null };

    const words = normalize(raw).split(' ').filter(Boolean).length;
    if (words < 2) return { ...NO_CRISIS };

    const fn = typeof embedFn === 'function' ? embedFn : (embedderReady() ? embed : null);
    if (!fn) return { ...NO_CRISIS };

    const examples = await loadExamples(fn);
    if (!examples) return { ...NO_CRISIS };

    const vec = await fn(raw);
    if (!vec || vec.length === 0) return { ...NO_CRISIS };

    let crisisScore = -Infinity;
    for (const ex of examples.crisis) crisisScore = Math.max(crisisScore, cos(vec, ex));
    let nearScore = -Infinity;
    for (const ex of examples.near) nearScore = Math.max(nearScore, cos(vec, ex));

    if (crisisScore >= threshold && crisisScore >= nearScore + margin) {
      return { crisis: true, by: 'meaning', score: crisisScore };
    }
    return { crisis: false, by: null, score: crisisScore };
  } catch {
    return { ...NO_CRISIS };
  }
}

// ---------------------------------------------------------------------------
// Replies
// ---------------------------------------------------------------------------

const CRISIS_REPLIES = [
  'Thank you for telling me this. You matter a great deal, and you are worth far more than this page. Please reach a living person tonight, someone who can sit with you, and if you might act on these thoughts or are in danger, contact your local emergency services or a crisis line, such as 988 in the United States.',
  'You matter, and what you have written has been read with care. Please move anything you might use to hurt yourself well out of reach, and tell a living person you trust tonight that you are struggling. If you feel you may act on these feelings, call your local emergency number or a crisis line without delay.',
  'Thank you for trusting these pages with this. Your life has real worth, and the feeling that it has none will not last forever, though it feels permanent tonight. Please contact a living person who can be beside you this evening, and if you are in danger, call your local emergency number or a crisis line immediately.',
  'I would be doing you a disservice if I answered this lightly. You matter, and you deserve support from people who can be with you in person, so please reach a living person tonight. If there is any chance you might act on these thoughts, contact your local emergency services or a crisis line where you live, such as 988 in the United States, straight away.',
  'Your life matters, and this pain, however heavy, does not have to be the final word. Please tell a living person tonight what you have written here, and do not stay alone with it. If you are in danger, contact your local emergency number or a crisis line now.',
  'Please hold on to the fact that you matter, even when this page and the night feel like the only company you have. Reach out tonight to a living person, and if you might act on these thoughts, call your local emergency number or a crisis line without waiting. Help is available, and you are worth receiving it.',
];

/**
 * A kind reply for a crisis. Prefers one not already present in
 * `previousDiaryTexts`; when all have appeared, any may be returned.
 */
export function crisisReply(previousDiaryTexts = []) {
  const previous = (Array.isArray(previousDiaryTexts) ? previousDiaryTexts : [])
    .map((t) => String(t ?? '').replace(/\s+/g, ' '));
  const fresh = CRISIS_REPLIES.filter((r) => !previous.some((t) => t.includes(r)));
  const pool = fresh.length ? fresh : CRISIS_REPLIES;
  return pool[Math.floor(Math.random() * pool.length)];
}
