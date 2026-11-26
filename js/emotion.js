/**
 * emotion.js - the emotional tone of one diary entry (GitHub issue #34).
 *
 * Exports:
 *   EMOTIONS                      the seven labels, neutral last
 *   PROTOTYPES                    first-person example sentences per emotion
 *   emotionByLexicon(text, analysis?) -> { emotion, score }   sync, negation-aware
 *   emotionByMeaning(text, { embedFn?, threshold? }) -> Promise<{ emotion, score } | null>
 *
 * Two routes, no new model. The lexicon reads cue words and phrases, including
 * slang. The meaning route compares the text with PROTOTYPES using the MiniLM
 * embedder from embed.js, or any embedFn passed in. Neither route throws.
 */

import { embed, embedMany, embedderReady } from './embed.js';

export const EMOTIONS = ['grief', 'anger', 'fear', 'shame', 'boredom', 'delight', 'neutral'];

export const PROTOTYPES = {
  grief: [
    'My dad died last spring and I still reach for my phone to ring him.',
    "I'm gutted, honestly, she's gone and I keep crying in the car.",
    'I miss him so much it feels like a hole in the middle of the day.',
    'The funeral was today and I just sat there, numb and hollow.',
    "I can't stop sobbing when I see her coat still on the hook.",
    'Everything reminds me of them, and that grief hits me out of nowhere.',
    "I'm heartbroken. The house is so quiet without the dog.",
    'I feel so empty now that the last of my family has passed away.',
    "I cried all the way round the supermarket and didn't even care who saw.",
    "It's been a month and the loss still knocks the wind out of me.",
    "I'm devastated, I don't know how to carry this sadness.",
    "I'm so lonely since she moved away, nothing feels warm any more.",
  ],
  anger: [
    'I am livid. He lied to my face again and I could scream.',
    "I'm so pissed off at my landlord, he's ignored every single email.",
    'My blood is boiling, she talked over me in front of everyone.',
    'I could strangle my brother, he ate my lunch and then laughed about it.',
    "I'm seething and I don't trust myself to say anything nice right now.",
    'Ugh, I am fuming, the cheek of him blaming me for the mess.',
    "I'm sick of being treated like a doormat, it makes me furious.",
    'Absolutely raging about the parking fine. Who does that?',
    "I'm so bloody annoyed with the whole team, they never listen.",
    'Every time he opens his mouth I get more and more irritated and bitter.',
    "I'm cheesed off and I want to throw my mug at the wall.",
    'I hate how unfair this is, my jaw clenches every time I think about it.',
  ],
  fear: [
    "I'm terrified about the results, my hands won't stop shaking.",
    "I'm dreading tomorrow's meeting and my stomach is in knots.",
    "My heart is racing, I'm scared something bad is about to happen.",
    "I'm so anxious I can't sleep and my thoughts won't stop spiralling.",
    'The noise outside had me on edge all night, I was properly frightened.',
    "I'm panicking about the bills and I don't know how I'll cope.",
    "I'm nervous about the flight, I keep picturing the plane dropping.",
    'What if I fail? The fear just sits on my chest like a stone.',
    "I'm jumpy and worried, every email makes me flinch.",
    "Honestly I'm bricking it. The interview is in an hour.",
    'The dark house frightens me and I keep checking the locks.',
    "I'm uneasy around him, something feels off and I can't shake it.",
  ],
  shame: [
    "I'm so embarrassed I could die. I tripped right in front of the whole room.",
    'I feel like an idiot for believing him, I am mortified.',
    "I messed up and it's entirely my fault, I'm ashamed of myself.",
    'God, I cringed so hard when I replayed what I said at the party.',
    "I'm such a joke. Everyone saw me cry and I can't face them.",
    'I feel guilty for snapping at her, she did not deserve that.',
    'I wish I had never said it, the regret is eating me alive.',
    'My face went red and I wanted the floor to swallow me up.',
    "I'm humiliated. I looked so stupid up on stage.",
    'I feel small and useless, like I let everyone down again.',
    'Still blushing about the email I sent to the whole department.',
    "I should have known better, I'm so ashamed of how I behaved.",
  ],
  boredom: [
    "Nothing to do and I'm bored out of my skull.",
    "Another dull Tuesday, same old routine, I'm just meh about everything.",
    'The meeting dragged on forever and I zoned out completely.',
    "I can't be bothered with anything today, it's all so flat.",
    "I'm knackered and there's nothing left in the tank, I just want to lie down.",
    'Whatever. I am restless and listless and watching the clock.',
    'The lecture was so tedious I counted the ceiling tiles for an hour.',
    "I'm shattered, drained, and too lethargic to even pick up my phone.",
    'Blah. Same food, same walls, same sofa. Nothing excites me.',
    "I'm underwhelmed by the whole weekend, it's been a total yawn.",
    'Life is a bit beige right now, nothing feels interesting.',
    'I just sat there doing nothing, feeling dull and uninspired.',
  ],
  delight: [
    "I'm buzzing! The offer came through and I could dance round the kitchen.",
    'I am so happy I could cry, my sister had the baby and they are both fine.',
    "That was brilliant, we laughed until our sides hurt, I'm over the moon.",
    "I'm thrilled and proud of myself for finally finishing the marathon.",
    'Honestly the sun is out and I feel giddy and light.',
    'Yay, we got the keys to the flat today, I am stoked.',
    'What a lovely evening, everyone was so kind and I feel grateful.',
    "I'm chuffed to bits with how the garden turned out.",
    'I feel so relieved and content now that it is all sorted.',
    'The concert was amazing, I am still glowing and smiling at nothing.',
    "Got the job! I'm ecstatic and can't stop grinning.",
    'My heart feels full, life is wonderful right now.',
  ],
  neutral: [
    'Made a cup of tea, read the post, and went for a walk round the block.',
    'The train was on time and I finished the crossword on the way in.',
    'Had pasta for dinner and then did the washing up.',
    'Rain again. Took the bins out and filed some receipts.',
    'Went to the shop for bread and milk, nothing much to report.',
    'Spent the afternoon sorting the spare room and labelling boxes.',
    'The meeting covered the agenda and we booked the next one.',
    'Watched the football on telly and went to bed around eleven.',
    'Replied to two emails and updated the spreadsheet for the quarter.',
    'The bus was packed so I walked, it took about forty minutes.',
    'I have a dentist appointment on Thursday at half past nine.',
    'Quiet day. Did a little reading and cooked some rice.',
  ],
};

// ---------------------------------------------------------------------------
// Lexicon
// ---------------------------------------------------------------------------

const LEXICON = {
  grief: [
    'grief', 'grieving', 'grieve', 'mourning', 'heartbroken', 'heartbreak', 'bereft', 'bereaved',
    'devastated', 'gutted', 'sobbing', 'sobbed', 'crying', 'cried', 'cry', 'weeping', 'tearful',
    'sad', 'sadness', 'miserable', 'lonely', 'hollow', 'miss him', 'miss her', 'miss them',
    'passed away', 'funeral', 'died', 'blue', 'wrecked', 'hopeless', 'crushed', 'empty',
  ],
  anger: [
    'angry', 'anger', 'furious', 'livid', 'raging', 'seething', 'fuming', 'pissed', 'pissed off',
    'irate', 'mad', 'annoyed', 'infuriated', 'outraged', 'resentful', 'bitter', 'incensed', 'fed up',
    'sick of', 'cheesed off', 'hacked off', 'wound up', 'strangle', 'bloody', 'bastard', 'up the wall',
    'rage', 'hate', 'hated', 'loathe', "can't stand", 'irritated',
  ],
  fear: [
    'afraid', 'scared', 'frightened', 'terrified', 'petrified', 'anxious', 'anxiety', 'panicking',
    'panic', 'panicky', 'dreading', 'dread', 'nervous', 'worried', 'worry', 'uneasy', 'on edge',
    'jumpy', 'spooked', 'shaking', 'freaking out', 'freaked out', 'apprehensive', 'scared stiff',
    'butterflies', 'bricking it', 'frightening', 'flinch',
  ],
  shame: [
    'ashamed', 'shame', 'shameful', 'embarrassed', 'embarrassing', 'mortified', 'humiliated',
    'humiliating', 'cringe', 'cringing', 'cringed', 'guilty', 'guilt', 'regret', 'regretting', 'idiot',
    'stupid', 'pathetic', 'useless', 'blushing', 'my fault', 'messed up', 'screwed up', 'a joke',
    'feel small', 'let everyone down', 'red-faced',
  ],
  boredom: [
    'bored', 'boring', 'boredom', 'meh', 'dull', 'tedious', 'monotonous', 'nothing to do', 'whatever',
    'listless', 'restless', 'sluggish', 'uninspired', 'drag', 'dragging', 'lifeless',
    'underwhelmed', 'cba', "can't be bothered", 'uninterested', 'blah', 'same old', 'knackered',
    'exhausted', 'shattered', 'drained', 'yawn', 'lethargic',
  ],
  delight: [
    'happy', 'delighted', 'glad', 'thrilled', 'buzzing', 'over the moon', 'chuffed', 'elated', 'joy',
    'joyful', 'excited', 'excitement', 'brilliant', 'lovely', 'wonderful', 'fantastic', 'amazing',
    'great', 'stoked', 'giddy', 'grateful', 'relieved', 'proud', 'cheerful', 'content', 'pleased',
    'made my day', 'cloud nine', 'ecstatic', 'yay', 'hooray', 'lush', 'cracking', 'smashing',
  ],
};

const NEGATOR_WORDS = new Set(['not', 'no', 'never', 'nothing', 'nobody', 'cannot', 'nor', 'neither',
  'hardly', 'barely', 'nope', 'dont', 'cant', 'wont', 'isnt', 'arent', 'wasnt', 'werent', 'didnt',
  'doesnt', 'havent', 'hasnt', 'wouldnt', 'shouldnt', 'couldnt']);
const NEGATION_WINDOW = 3;

function isNegatorToken(t) {
  return NEGATOR_WORDS.has(t) || (t.length > 3 && t.endsWith("n't"));
}

/** Lowercase word tokens, apostrophes kept inside words. */
function tokensOf(text) {
  return String(text ?? '')
    .replace(/[‘’`´]/g, "'")
    .toLowerCase()
    .match(/[a-z0-9]+(?:'[a-z]+)*/g) || [];
}

// Cues pre-split into token lists, longest first so phrases win.
const CUES = Object.fromEntries(Object.entries(LEXICON).map(([emotion, cues]) => [
  emotion,
  cues.map((c) => ({ phrase: c, toks: tokensOf(c) }))
    .sort((a, b) => b.toks.length - a.toks.length),
]));

/** Simple word stem so a negated lemma such as "hate" matches "hated". */
function stemOf(t) {
  return t.replace(/(?:ed|ing|s)$/, '');
}

/**
 * Finds the cues in a token list. Each hit: { emotion, phrase, negated } with
 * negated true when the cue sits under negation.
 */
function findCues(toks, analysis) {
  const hits = [];
  const negatedSet = analysis && Array.isArray(analysis.negated)
    ? new Set(analysis.negated.map((w) => String(w).toLowerCase()))
    : null;
  const taken = new Array(toks.length).fill(false);

  for (const emotion of Object.keys(CUES)) {
    for (const { phrase, toks: cue } of CUES[emotion]) {
      if (cue.length === 0) continue;
      for (let i = 0; i + cue.length <= toks.length; i++) {
        let match = true;
        for (let j = 0; j < cue.length; j++) {
          if (toks[i + j] !== cue[j]) { match = false; break; }
        }
        if (!match) continue;
        // A longer phrase already took these tokens; do not count a shorter one inside it.
        if (taken.slice(i, i + cue.length).some(Boolean)) continue;
        for (let j = 0; j < cue.length; j++) taken[i + j] = true;

        let negated;
        if (negatedSet) {
          negated = cue.some((t) => negatedSet.has(t) || negatedSet.has(stemOf(t)));
        } else {
          const from = Math.max(0, i - NEGATION_WINDOW);
          negated = toks.slice(from, i).some(isNegatorToken);
        }
        hits.push({ emotion, phrase, negated });
      }
    }
  }
  return hits;
}

const WEAK_NEGATED_DELIGHT = 0.4; // a negated delight cue is weak grief, never delight

/**
 * Sync lexicon scoring. Cues under negation do not count, so "i'm not happy"
 * is not delight. A negated delight cue adds a weak grief score.
 * @param {string} text
 * @param {object|null} analysis optional result of understand.js analyze()
 * @returns {{ emotion: string, score: number }}
 */
export function emotionByLexicon(text, analysis = null) {
  try {
    const toks = tokensOf(text);
    if (toks.length === 0) return { emotion: 'neutral', score: 0 };

    const weights = Object.fromEntries(EMOTIONS.map((e) => [e, 0]));
    const seen = new Set();
    for (const hit of findCues(toks, analysis)) {
      const key = `${hit.emotion}:${hit.phrase}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!hit.negated) {
        weights[hit.emotion] += 1;
      } else if (hit.emotion === 'delight') {
        weights.grief += WEAK_NEGATED_DELIGHT;
      }
      // Other negated cues are ignored: "i'm not angry any more" is not anger.
    }

    let best = 'neutral';
    let bestWeight = 0;
    for (const e of EMOTIONS) {
      if (e === 'neutral') continue;
      if (weights[e] > bestWeight) { best = e; bestWeight = weights[e]; }
    }
    if (bestWeight === 0) return { emotion: 'neutral', score: 0 };
    const score = 1 - Math.exp(-0.9 * bestWeight);
    return { emotion: best, score: round3(score) };
  } catch {
    return { emotion: 'neutral', score: 0 };
  }
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Meaning
// ---------------------------------------------------------------------------

const DEFAULT_KEY = Object.freeze({ default: true });
const TOP_K = 3;

/** Per embedding function: a promise of { emotion: vec[] } or null. */
const prototypeCache = new WeakMap();

function cosine(a, b) {
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

function isVector(v) {
  return !!v && typeof v.length === 'number' && v.length > 0;
}

/** Embeds every prototype once per embedder; a failed load is not kept. */
function loadPrototypes(key, embedList) {
  let pending = prototypeCache.get(key);
  if (!pending) {
    pending = (async () => {
      try {
        const labels = [];
        const texts = [];
        for (const emotion of EMOTIONS) {
          for (const s of PROTOTYPES[emotion]) {
            labels.push(emotion);
            texts.push(s);
          }
        }
        const vecs = await embedList(texts);
        if (!Array.isArray(vecs) || vecs.length !== texts.length || !vecs.every(isVector)) return null;
        const byEmotion = Object.fromEntries(EMOTIONS.map((e) => [e, []]));
        labels.forEach((label, i) => byEmotion[label].push(vecs[i]));
        return byEmotion;
      } catch {
        return null;
      }
    })();
    prototypeCache.set(key, pending);
    pending.then((v) => {
      if (!v && prototypeCache.get(key) === pending) prototypeCache.delete(key);
    });
  }
  return pending;
}

/**
 * Meaning route. Averages the top three cosine similarities per emotion and
 * returns the best one when it reaches the threshold, otherwise neutral.
 * Uses embedFn when given, else the MiniLM embedder in embed.js when ready.
 * @param {string} text
 * @param {{ embedFn?: Function|null, threshold?: number }} [opts]
 * @returns {Promise<{ emotion: string, score: number } | null>} null when no embedder
 */
export async function emotionByMeaning(text, { embedFn = null, threshold = 0.35 } = {}) {
  try {
    const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!raw) return null;

    let key;
    let embedOne;
    let embedList;
    if (typeof embedFn === 'function') {
      key = embedFn;
      embedOne = embedFn;
      embedList = async (list) => {
        const out = [];
        for (const t of list) out.push(await embedFn(t));
        return out;
      };
    } else {
      if (!embedderReady()) return null;
      key = DEFAULT_KEY;
      embedOne = embed;
      embedList = embedMany;
    }

    const protos = await loadPrototypes(key, embedList);
    if (!protos) return null;
    const vec = await embedOne(raw);
    if (!isVector(vec)) return null;

    let best = null;
    for (const emotion of EMOTIONS) {
      const sims = protos[emotion].map((p) => cosine(vec, p)).sort((a, b) => b - a);
      const top = sims.slice(0, TOP_K);
      const score = top.reduce((s, x) => s + x, 0) / top.length;
      if (!best || score > best.score) best = { emotion, score };
    }
    if (!best) return null;
    const emotion = best.score >= threshold ? best.emotion : 'neutral';
    return { emotion, score: round3(best.score) };
  } catch {
    return null;
  }
}
