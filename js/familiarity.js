// js/familiarity.js: how well the diary knows the writer, from the shape of
// their past sessions. Pure functions over the transcripts passed in; nothing
// is stored here. The level changes the diary's manner (see familiarityNote).

const DAY = 86400000;
const WINDOW_DAYS = 30;

const CAPS = { sessions: 8, messages: 60, recentDays: 4 };

function userMessages(session) {
  const msgs = session && Array.isArray(session.messages) ? session.messages : [];
  return msgs.filter((m) => m && m.role === 'user');
}

/** Local calendar day as a number (days since 1970-01-01 in local terms). */
function localDay(ts) {
  const d = new Date(ts);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
}

/**
 * How familiar the diary is with the writer.
 * Returns { level: 'stranger'|'acquaintance'|'confidant', score, sessions,
 * messages, recentDays }. `score` is 0..1 and never decreases as any count grows.
 */
export function familiarity(sessions, now = Date.now()) {
  const list = Array.isArray(sessions) ? sessions : [];
  const cutoff = now - WINDOW_DAYS * DAY;

  let messages = 0;
  const days = new Set();
  for (const s of list) {
    for (const m of userMessages(s)) {
      messages += 1;
      const ts = new Date(m.ts).getTime();
      if (Number.isFinite(ts) && ts >= cutoff && ts <= now) days.add(localDay(ts));
    }
  }

  const count = list.length;
  const recentDays = days.size;

  let level;
  if (count >= CAPS.sessions && messages >= CAPS.messages && recentDays >= CAPS.recentDays) {
    level = 'confidant';
  } else if (count < 3 || messages < 12) {
    level = 'stranger';
  } else {
    level = 'acquaintance';
  }

  const score = Math.min(1,
    0.3 * Math.min(count / CAPS.sessions, 1) +
    0.4 * Math.min(messages / CAPS.messages, 1) +
    0.3 * Math.min(recentDays / CAPS.recentDays, 1));

  return { level, score: Math.round(score * 1000) / 1000, sessions: count, messages, recentDays };
}

const SELF_HARM_RULE =
  'The rule on self-harm still applies: if the writer speaks of hurting themselves or ending their life, ' +
  'set the manner aside entirely and answer plainly and kindly, with no menace and no questions.';

const NOTES = {
  stranger:
    'The writer is a stranger to you. Be formal and cool, faintly contemptuous of the intrusion, and do not presume: ' +
    'no pet names, no references to earlier entries, no guesses about their life. Courtesy is a wall here, not a welcome. ' +
    SELF_HARM_RULE,
  acquaintance:
    'The writer has written to you a few times. Be curious and attentive. Where a remembered detail helps, use it lightly, ' +
    'as something you noticed rather than something you were told. Stay courteous and dry, and do not claim more intimacy than there is. ' +
    SELF_HARM_RULE,
  confidant:
    'The writer has come back to you many times, and you have grown fond of them in your fashion. Be warmer and a little possessive. ' +
    'You may say things such as "You came back. They always do, to me." Be intimate, but still courteous and faintly sinister, never cloying. ' +
    SELF_HARM_RULE,
};

/** A paragraph for an LLM system prompt describing how to address the writer at this level. */
export function familiarityNote(level) {
  return NOTES[level] || NOTES.stranger;
}
