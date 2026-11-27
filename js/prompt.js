// The words the language model is given (issue #51): the diary's persona, the
// notes appended to it, and the chat built from a transcript. Pure: no storage,
// no workers, no DOM, so eval/llm-smoke.mjs can run the app's real prompts in Node.

import { timeNote } from './timesense.js';
import { familiarityNote } from './familiarity.js';
import { stripStrikes } from './strike.js';

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

/**
 * The full system prompt for a reply.
 * { short, recollections, time, familiarity, allowStrike }
 */
export function replyPersona({ short = false, recollections = null, time = null, familiarity = null, allowStrike = false } = {}) {
  return (short ? PERSONA_SHORT : PERSONA)
    + memoryNote(recollections)
    + (time ? prefixed(timeNote(time)) : '')
    + (familiarity ? prefixed(familiarityNote(familiarity)) : '')
    + (allowStrike && !short ? STRIKE_NOTE : '');
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

/** The chat a transformers.js model is given: system persona, history, then the prompt. */
export function chatFor(persona, messages, instruction = '') {
  const { history, prompt } = splitTranscript(messages, instruction);
  return [{ role: 'system', content: persona }, ...history.map(toTurn), { role: 'user', content: prompt }];
}
