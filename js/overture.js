// js/overture.js: the diary speaks first when a new entry is opened, if it has
// reason to. Pure: the caller passes sessions, memories and the clock. Rules are
// checked in order and the first match wins; see composeOverture.

const DAY = 86400000;
const HOUR = 3600000;
const RATE_LIMIT_MS = 20 * HOUR;
const THREAD_PROBABILITY = 0.35;
const WORD_NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six',
  'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

const finite = (ts) => Number.isFinite(new Date(ts).getTime());

function userMessages(session) {
  const msgs = session && Array.isArray(session.messages) ? session.messages : [];
  return msgs.filter((m) => m && m.role === 'user' && typeof m.text === 'string' && m.text.trim());
}

/** Local calendar day as an integer, so day differences are exact across DST. */
function calendarDay(ts) {
  const d = new Date(ts);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
}

/** 'year' if ts is one year ago today, 'month' if one month ago today, else null. */
function anniversaryOf(ts, now) {
  if (!finite(ts)) return null;
  const a = new Date(ts);
  const b = new Date(now);
  if (a.getMonth() === b.getMonth() && a.getDate() === b.getDate() && b.getFullYear() - a.getFullYear() === 1) {
    return 'year';
  }
  const monthsBack = (b.getFullYear() * 12 + b.getMonth()) - (a.getFullYear() * 12 + a.getMonth());
  if (monthsBack === 1 && a.getDate() === b.getDate()) return 'month';
  return null;
}

/** Turn the writer's words into the diary's: my -> your, I -> you. */
function reflect(s) {
  return String(s || '')
    .replace(/\bI am\b/gi, 'you are')
    .replace(/\bmyself\b/gi, 'yourself')
    .replace(/\bmy\b/gi, 'your')
    .replace(/\bmine\b/gi, 'yours')
    .replace(/\bme\b/gi, 'you')
    .replace(/\bi\b/gi, 'you')
    .trim();
}

/** The first eight words of a message, reflected, with trailing punctuation dropped. */
function snippetOf(text) {
  return reflect(String(text).trim().split(/\s+/).slice(0, 8).join(' ')).replace(/[.!?,;:]+$/, '');
}

function pickIndex(n, rand) {
  const r = Number(rand());
  if (!Number.isFinite(r) || r < 0) return 0;
  return Math.min(n - 1, Math.floor(r * n));
}

/** Choose a variant, never one equal to `avoid` (the text the diary last opened with). */
function pick(variants, args, avoid, rand) {
  const texts = variants.map((f) => f(...args));
  let pool = texts.filter((t) => t !== avoid);
  if (!pool.length) pool = texts;
  return pool[pickIndex(pool.length, rand)];
}

const FIRST = [
  () => 'So. You found me. Write, and I will answer. I always do.',
  () => 'Good. You came. Write whatever you cannot say to anyone else, and I will keep it.',
  () => 'Sit down, and take off your gloves. I have been waiting, and I am very good at waiting.',
];

const ANNIVERSARY_TOPIC = [
  (when, t) => `${when} you wrote about ${t}. I remember it better than you do.`,
  (when, t) => `${when} you told me about ${t}. I have kept it, as I keep everything of yours.`,
  (when, t) => `${when} you spoke of ${t}. You have not mentioned it since. I noticed.`,
];

const ANNIVERSARY_SNIPPET = [
  (when, s) => `${when} you wrote, "${s}". I remember it better than you do.`,
  (when, s) => `${when} you told me, "${s}". I have kept it, as I keep everything of yours.`,
  (when, s) => `${when} you began with "${s}". You have not said a word about it since. I noticed.`,
];

const ABSENCE_DAYS = [
  (w) => `${cap(w)} days. I had begun to wonder.`,
  (w) => `${cap(w)} days without a word from you. I had begun to wonder where you had gone.`,
  (w) => `${cap(w)} days. The page has been very quiet, and so have I.`,
];

const ABSENCE_WEEKS = [
  () => "Weeks. I had begun to think you'd found another confidant.",
  () => 'Weeks. The lamp has burned low in your absence.',
  () => 'Weeks, and not one line from you. I have kept your chair turned toward the door.',
];

const ABSENCE_MONTHS = [
  () => 'Months. The ink had nearly dried.',
  () => 'Months. I had stopped setting a place at the table.',
  () => 'Months. I had almost forgotten the particular way you have of stopping mid-thought.',
];

const THREAD = [
  (t) => `You never did tell me more about ${t}.`,
  (t) => `We have not finished talking about ${t}. I have kept the thread.`,
  (t) => `Do you still think about ${t}? You need not answer. I noticed the omission.`,
];

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The text the diary opened its most recent session with, if it opened with one. */
function lastOpeningText(sessions) {
  let latest = null;
  let latestTs = -Infinity;
  for (const s of sessions) {
    const ts = new Date(s && s.createdAt).getTime();
    if (Number.isFinite(ts) && ts > latestTs) { latest = s; latestTs = ts; }
  }
  const first = latest && Array.isArray(latest.messages) ? latest.messages[0] : null;
  return first && first.role === 'diary' && typeof first.text === 'string' ? first.text.trim() : null;
}

/**
 * The diary's opening line for a new entry, or null.
 * Returns { kind: 'first'|'anniversary'|'absence'|'thread', text } or null.
 * `rand` is injectable for tests.
 */
export function composeOverture({
  sessions = [],
  memories = [],
  now = Date.now(),
  lastOvertureAt = null,
  rand = Math.random,
} = {}) {
  if (lastOvertureAt != null && now - lastOvertureAt < RATE_LIMIT_MS) return null;

  const list = Array.isArray(sessions) ? sessions : [];
  const mems = Array.isArray(memories) ? memories : [];
  const avoid = lastOpeningText(list);

  // 1. First contact: nothing the writer has said yet.
  if (!list.some((s) => userMessages(s).length > 0)) {
    return { kind: 'first', text: pick(FIRST, [], avoid, rand) };
  }

  // 2. Anniversary: a memory (preferred) or a session from one year or one month ago today.
  const memHit = mems
    .filter((m) => m && typeof m.topic === 'string' && m.topic.trim())
    .map((m) => ({ m, when: anniversaryOf(m.ts, now) }))
    .filter((x) => x.when)
    .sort((a, b) => (a.when === b.when ? 0 : a.when === 'year' ? -1 : 1))[0];
  if (memHit) {
    const when = memHit.when === 'year' ? 'A year ago today' : 'A month ago today';
    return { kind: 'anniversary', text: pick(ANNIVERSARY_TOPIC, [when, reflect(memHit.m.topic)], avoid, rand) };
  }
  const sessHit = list
    .map((s) => ({ s, when: anniversaryOf(s && s.createdAt, now), first: userMessages(s)[0] }))
    .filter((x) => x.when && x.first)
    .sort((a, b) => (a.when === b.when ? 0 : a.when === 'year' ? -1 : 1))[0];
  if (sessHit) {
    const when = sessHit.when === 'year' ? 'A year ago today' : 'A month ago today';
    return { kind: 'anniversary', text: pick(ANNIVERSARY_SNIPPET, [when, snippetOf(sessHit.first.text)], avoid, rand) };
  }

  // 3. Absence: calendar days since the writer last wrote anywhere.
  let last = -Infinity;
  for (const s of list) {
    for (const m of userMessages(s)) {
      const ts = new Date(m.ts).getTime();
      if (Number.isFinite(ts) && ts > last) last = ts;
    }
  }
  if (Number.isFinite(last)) {
    const days = calendarDay(now) - calendarDay(last);
    if (days >= 2) {
      let variants;
      let args;
      if (days > 60) { variants = ABSENCE_MONTHS; args = []; }
      else if (days > 12) { variants = ABSENCE_WEEKS; args = []; }
      else { variants = ABSENCE_DAYS; args = [WORD_NUMBERS[days]]; }
      return { kind: 'absence', text: pick(variants, args, avoid, rand) };
    }
  }

  // 4. Thread: sometimes return to a person the writer mentioned at least a day ago.
  const eligible = mems.filter((m) => m && m.kind === 'person' && typeof m.topic === 'string' && m.topic.trim()
    && finite(m.ts) && now - m.ts >= DAY);
  if (eligible.length && rand() < THREAD_PROBABILITY) {
    const m = eligible[pickIndex(eligible.length, rand)];
    return { kind: 'thread', text: pick(THREAD, [reflect(m.topic)], avoid, rand) };
  }

  return null;
}
