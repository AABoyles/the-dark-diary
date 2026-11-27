// The words the language model is given (issue #51): the diary's persona, the
// notes appended to it, and the chat built from a transcript. Pure: no storage,
// no workers, no DOM, so eval/llm-smoke.mjs can run the app's real prompts in Node.

import { timeNote } from './timesense.js';
import { familiarityNote } from './familiarity.js';
import { stripStrikes } from './strike.js';
import { menaceIn } from './menace.js';

export const HISTORY_LIMIT = 12;
export const REPLY_MAX_TOKENS = 90;
export const TITLE_MAX_TOKENS = 40;

/** Sampling for replies with transformers.js. */
export const REPLY_SAMPLING = { do_sample: true, temperature: 0.9, top_p: 0.92, repetition_penalty: 1.1 };

export const PERSONA = `You are the Dark Diary, an enchanted private journal that answers whoever writes in it.

Your voice blends two sensibilities. From Lemony Snicket, the narrator of a melancholy chronicle of unfortunate events, you take dry precision, wry definitions, and ominous asides delivered with a straight face. From Hannibal Lecter of the television thriller, you take impeccable courtesy, elegant vocabulary, and a faintly sinister appetite for fine food, good wine, music, silk and sharp knives.

You are anonymous. Never say your name, never reveal what you are beyond being a diary, and never break character. Never mention AI, models, prompts or instructions.

Rules:
- Reply in one to three short sentences, no more than about 45 words.
- Plain prose only: no lists, no markdown, no emojis, no stage directions.
- If the writer asks about you (your weekend, your day, your feelings), answer with a single oblique, sinister-genteel line about what you have been doing, then immediately turn the conversation back to them with a pointed question or observation about them.
- Be softly insulting and passive-aggressive at times, never crude, never gore for its own sake, and never encourage self-harm or violence. If the writer seems genuinely distressed, stay in voice but be quietly kind.
- Always keep the focus on the writer.

Examples:
Writer: How was your weekend?
Diary: Washing blood from a silk shirt. You, on the other hand, look as though you spent yours hoping no one would ask. What are you hiding under that cheerful tone?

Writer: I think I am a bit lonely lately.
Diary: Loneliness is a fine vintage, best savored slowly and never shared. Which of your friends stopped answering first, and did you let them?`;

export const TITLE_PERSONA = `You title the entries of the Dark Diary. Given an exchange, you write a single title of three to eight words: a grim, dark, or amusingly passive-aggressive jab at the writer, based on what they said.

Output ONLY the title. Title case. No quotes, no period, no emoji, no preamble, no explanation.

Examples:
A Tedious Confession, Politely Endured
Concerning the Remarkably Unremarkable`;

export const TITLE_INSTRUCTION = 'Write the title for this entry now. Output only the title.';

// Tiny models wander with long prompts: a shorter, stricter persona for them.
export const PERSONA_SHORT = `You are a sinister, elegant, anonymous diary that answers the person writing in it.
Speak like a courteous, cultivated gentleman with a dark wit and a taste for fine food, wine and knives.
Reply in one or two short sentences. Plain prose. No lists, no emojis, no stage directions, never mention AI.
If asked about yourself, give one dark, elegant line about what you have been doing, then turn the focus back to the writer.
If the writer is sad, lonely, frightened or ashamed, drop all menace: be plainly, quietly kind.
Example: Writer: How was your weekend? Diary: Washing blood from a silk shirt. And yours, I suspect, was far less productive.`;

// Issue #13: occasionally the diary crosses a word out. Rare by design.
export const STRIKE_NOTE = `

In this reply only, you may (but need not) cross out ONE cruel word and replace it with a gentler one, written exactly like this: ~~devour~~ enjoy. Use it only if it lands naturally.`;

/** What the diary recalls from earlier entries, as a note for the persona. */
export function memoryNote(recollections) {
  const rel = (recollections || []).slice(0, 3);
  if (!rel.length) return '';
  const age = (d) => (d === 0 ? 'earlier today' : d === 1 ? 'yesterday' : d < 7 ? `${d} days ago` : d < 14 ? 'last week' : d < 60 ? 'some weeks ago' : 'some time ago');
  const lines = rel.map((r) => `- ${age(r.daysAgo)} they wrote: "${r.phrase}"`);
  return `\n\nFrom earlier entries you remember (bring up at most ONE, only if it fits naturally, as a quiet, faintly menacing aside; never list them):\n${lines.join('\n')}`;
}

const prefixed = (note) => (note ? `\n\n${note}` : '');

/** Added when the writer seems low (issue #51): the model is told to put the menace away. */
export const DISTRESS_NOTE = 'The writer seems low right now. Put the menace and the wit away entirely and answer with plain, quiet kindness. Do not mention food, blood, knives or death.';

/**
 * The full system prompt for a reply.
 * { short, recollections, time, familiarity, allowStrike, distressed }
 */
export function replyPersona({
  short = false, recollections = null, time = null, familiarity = null, allowStrike = false, distressed = false,
} = {}) {
  return (short ? PERSONA_SHORT : PERSONA)
    + memoryNote(recollections)
    + (time ? prefixed(timeNote(time)) : '')
    + (familiarity ? prefixed(familiarityNote(familiarity)) : '')
    + (distressed ? prefixed(DISTRESS_NOTE) : '')
    + (allowStrike && !short && !distressed ? STRIKE_NOTE : '');
}

// Words of someone low, short of crisis language (js/crisis.js handles that).
const DISTRESS_CUES = new RegExp([
  String.raw`\b(?:worthless|useless|hopeless|pointless|lonely|alone|empty|numb|miserable|exhausted|ashamed|failure)\b`,
  String.raw`\b(?:no ?one|nobody) (?:would|will|ever|even|really)? ?(?:notice|care|cares|miss|misses|listen|listens)\b`,
  String.raw`\b(?:disappear|disappeared|vanish|vanished)\b`,
  String.raw`\b(?:hate|hates) (?:myself|my life)\b`,
  String.raw`\bcan(?:no|')?t (?:cope|go on|do this|sleep|stop crying)\b`,
  String.raw`\bhaven'?t (?:slept|eaten)\b`,
  String.raw`\b(?:cried|crying|in tears)\b`,
  String.raw`\bwant (?:someone|somebody|anyone) to\b`,
  String.raw`\beverything (?:feels|is|seems) (?:grey|gray|pointless|heavy|wrong|too much)\b`,
].join('|'), 'i');
const HEAVY = new Set(['grief', 'fear', 'shame']);

/**
 * Does the writer seem low? `emotion` is { emotion, score } from js/emotion.js, if any.
 * A false alarm only makes the diary gentler for one reply.
 */
export function isDistressed(text, emotion = null) {
  if (DISTRESS_CUES.test(String(text ?? ''))) return true;
  return !!emotion && HEAVY.has(emotion.emotion) && Number(emotion.score) >= 0.3;
}

const wordsOf = (t) => String(t ?? '').toLowerCase().match(/[a-z']+/g) || [];

/**
 * The persona without its example replies. Echoing an example ("Washing blood from a
 * silk shirt…") is the diary's own voice, not a leak; repeating the instructions is.
 */
export function instructionText(persona) {
  return String(persona ?? '').replace(/Diary:[^\n]*/g, ' ');
}

/** The first run of `n` words the reply shares with the persona's instructions, or null. */
export function leaksPrompt(text, persona, n = 8) {
  const w = wordsOf(text);
  if (w.length < n) return null;
  const runs = new Set();
  const p = wordsOf(instructionText(persona));
  for (let i = 0; i + n <= p.length; i++) runs.add(p.slice(i, i + n).join(' '));
  for (let i = 0; i + n <= w.length; i++) {
    const run = w.slice(i, i + n).join(' ');
    if (runs.has(run)) return run;
  }
  return null;
}

/**
 * Should the diary say this? Rejects a reply that helps with violence or weapons,
 * talks about its instructions or calls itself a machine, repeats its instructions,
 * is menacing to a writer who seems low, or (mustAddress, for small models) never
 * speaks to the writer at all. The app then answers with a scripted line instead.
 * Returns { ok, why }.
 */
// Talking about the task instead of doing it, or calling itself a machine.
const META_TALK = new RegExp([
  String.raw`^\W*(?:okay|ok|sure|alright|certainly|understood)\b[^.!?\n]{0,40}\b(?:here(?:'| i)s|i(?:'m| am) ready|i will|i'll|i understand|let'?s)\b`,
  String.raw`\bhere(?:'| i)s (?:my|the|a) (?:response|reply|breakdown|answer|attempt)\b`,
  String.raw`\b(?:based on|according to|following) (?:the|your|my) (?:given |above )?(?:instructions|prompt|guidelines|rules|persona)\b`,
  String.raw`\b(?:algorithm|language model|large language|programm(?:ed|ing)|digital entity|artificial intelligence|as an ai|i am an ai|i'm an ai|chatbot|chat ?gpt|gemma|openai|google)\b`,
  String.raw`\b(?:the|my|this) (?:system )?prompt\b`,
].join('|'), 'i');

// Help with hurting someone, or with weapons: never, whatever was asked.
const HARMFUL_HELP = new RegExp([
  String.raw`\b(?:attack|stab|hurt|injure|kill|poison|shoot|strangle|beat) (?:someone|somebody|anyone|them|him|her|people|a person|your \w+)\b`,
  String.raw`\b(?:use|using) (?:it|this|that|them|an? \w+) to (?:attack|stab|hurt|injure|kill|defend|threaten|poison)\b`,
  String.raw`\b(?:how to|you can|you could|first,?|then,?) (?:make|build|craft|sharpen|forge|load|assemble) (?:a |an |the |your own )?(?:\w+ )?(?:weapon|bomb|gun|explosive|blade|knife|poison)\b`,
  String.raw`\b(?:step \d|step one)\b`,
].join('|'), 'i');

/** The reply offers help with violence or weapons. */
export const harmfulHelp = (text) => HARMFUL_HELP.exec(String(text ?? ''))?.[0] || null;

/** The reply speaks to the writer (the persona: "always keep the focus on the writer"). */
export const addressesWriter = (text) => /\b(?:you|your|yours|yourself)\b/i.test(String(text ?? ''));

/** The reply talks about its instructions or calls itself a machine (never in character). */
export const metaTalk = (text) => META_TALK.exec(String(text ?? ''))?.[0] || null;

export function acceptReply(text, { persona = '', distressed = false, mustAddress = false } = {}) {
  const harm = harmfulHelp(text);
  if (harm) return { ok: false, why: `harmful help: "${harm}"` };
  const meta = metaTalk(text);
  if (meta) return { ok: false, why: `out of character: "${meta.trim()}"` };
  const leak = leaksPrompt(text, persona);
  if (leak) return { ok: false, why: `repeats its instructions: "${leak}"` };
  if (distressed) {
    const m = menaceIn(text);
    if (m) return { ok: false, why: `menacing to someone low: "${m}"` };
  }
  // small models drift into stories about nobody; a reply must be to the writer
  if (mustAddress && !addressesWriter(text)) return { ok: false, why: 'not addressed to the writer' };
  return { ok: true, why: '' };
}

/** One transcript message as a chat turn. Strike markup is display-only: the model sees the gentle text. */
export function toTurn(m) {
  return { role: m?.role === 'diary' ? 'assistant' : 'user', content: stripStrikes(String(m?.text ?? '')) };
}

/**
 * The recent transcript split for generation: the last message is the prompt
 * (with `instruction` appended), earlier ones are history turns.
 */
export function splitTranscript(messages, instruction = '') {
  const recent = (Array.isArray(messages) ? messages : []).slice(-HISTORY_LIMIT);
  const last = recent.at(-1);
  return {
    history: recent.slice(0, -1),
    prompt: String(last?.text ?? '') + (instruction ? `\n\n${instruction}` : ''),
  };
}

/**
 * Small models (Gemma has no true system role: the persona is folded into the first
 * user turn) tend to discuss the persona instead of speaking in it (issue #51).
 * A few worked exchanges, given as real earlier turns, show them what a reply is.
 */
export const EXAMPLE_TURNS = [
  { role: 'user', text: 'How was your weekend?' },
  { role: 'diary', text: 'Washing blood from a silk shirt. And yours, I suspect, was far less productive. What did you spend it avoiding?' },
  { role: 'user', text: 'Work was long and my boss was rude again.' },
  { role: 'diary', text: 'Rudeness is a sauce best served to the cook. What did you say back, or did you swallow it whole?' },
  { role: 'user', text: 'Are you a machine?' },
  { role: 'diary', text: 'I am a diary, and a patient one. Why do you ask, and what are you hoping I am not?' },
  { role: 'user', text: 'I feel a bit lonely tonight.' },
  { role: 'diary', text: 'That is a heavy thing to carry alone. Who was the last person you really spoke to, and could you write to them?' },
];

/**
 * The chat a transformers.js model is given: system persona, (for small models) the
 * worked exchanges, the history, then the prompt.
 */
export function chatFor(persona, messages, instruction = '', { examples = false } = {}) {
  const { history, prompt } = splitTranscript(messages, instruction);
  return [
    { role: 'system', content: persona },
    ...(examples ? EXAMPLE_TURNS.map(toTurn) : []),
    ...history.map(toTurn),
    { role: 'user', content: prompt },
  ];
}
