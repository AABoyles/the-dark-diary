// js/ledger.js - the ledger of moods (GitHub issue #50): the pure logic behind
// the back page that charts how the writer has felt, and the diary's remarks on
// the patterns. No DOM, no storage; the clock is only read as a default.
//
// Exports:
//   HEAVY                       the four heavier feelings
//   moodEntries(sessions)       -> [{ ts, emotion, score, crisis }] sorted by ts
//   dayKey(ts)                  -> local 'YYYY-MM-DD'
//   byDay(entries)              -> Map dayKey -> { key, ts, n, counts, dominant, intensity, crisis }
//   weeks(days, opts)           -> Monday-start rows [{ start, days: [7 x (byDay value | null)] }]
//   patterns(entries, opts)     -> { total, top, weekday, trend, absence, crisisRecent }
//   remarks(p, opts)            -> 2 or 3 strings in the diary's voice
//   VARIANTS                    every remark variant (templates keep their {placeholders})

import { EMOTIONS } from './emotion.js';

export const HEAVY = new Set(['grief', 'anger', 'fear', 'shame']);

const DAY = 86400000;
const isObj = (x) => x !== null && typeof x === 'object';
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const pad = (n) => String(n).padStart(2, '0');
const midnight = (ts) => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

/** A session's user message, after cleaning: a valid timestamp and a known emotion or a crisis flag. */
function isEntry(e) {
  if (!isObj(e) || !Number.isFinite(e.ts)) return false;
  const em = e.emotion ?? null;
  return em === null || EMOTIONS.includes(em);
}

/**
 * Every user message that carries an emotion, plus every crisis message (even
 * without one). Diary messages, malformed input and unknown emotions are skipped.
 */
export function moodEntries(sessions) {
  if (!Array.isArray(sessions)) return [];
  const out = [];
  for (const s of sessions) {
    if (!isObj(s) || !Array.isArray(s.messages)) continue;
    for (const m of s.messages) {
      if (!isObj(m) || m.role !== 'user' || !Number.isFinite(m.ts)) continue;
      const emotion = typeof m.emotion === 'string' && EMOTIONS.includes(m.emotion) ? m.emotion : null;
      const crisis = m.crisis === true;
      if (!emotion && !crisis) continue;
      const score = Number.isFinite(m.mood) ? clamp01(m.mood) : 0;
      out.push({ ts: m.ts, emotion, score, crisis });
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
}

export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The most frequent emotion in `list` (entries with an emotion), as { emotion, count, sum }.
 * Ties go to the higher summed score, then to EMOTIONS order. Null when there is none.
 */
function tally(list) {
  const t = new Map();
  for (const e of list) {
    if (!e.emotion) continue;
    const r = t.get(e.emotion) ?? { emotion: e.emotion, count: 0, sum: 0 };
    r.count += 1;
    r.sum += Number.isFinite(e.score) ? clamp01(e.score) : 0;
    t.set(e.emotion, r);
  }
  let best = null;
  for (const r of t.values()) {
    if (!best) { best = r; continue; }
    if (r.count !== best.count) { if (r.count > best.count) best = r; continue; }
    if (r.sum !== best.sum) { if (r.sum > best.sum) best = r; continue; }
    if (EMOTIONS.indexOf(r.emotion) < EMOTIONS.indexOf(best.emotion)) best = r;
  }
  return best;
}

/**
 * One record per local day. `n` counts every entry that day; `counts` and the
 * dominant emotion only count entries that have an emotion. `intensity` is the
 * mean score of the dominant emotion's entries (0 when there is none).
 */
export function byDay(entries) {
  const groups = new Map();
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!isEntry(e)) continue;
    const key = dayKey(e.ts);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const out = new Map();
  for (const [key, list] of groups) {
    const counts = {};
    for (const e of list) if (e.emotion) counts[e.emotion] = (counts[e.emotion] ?? 0) + 1;
    const top = tally(list);
    out.set(key, {
      key,
      ts: midnight(list[0].ts).getTime(),
      n: list.length,
      counts,
      dominant: top ? top.emotion : null,
      intensity: top ? top.sum / top.count : 0,
      crisis: list.some((e) => e.crisis === true),
    });
  }
  return out;
}

/**
 * Monday-start weeks, oldest first, from the week of the first day (or at most
 * `maxWeeks` rows back) to the week of `now`. Days with no record are null.
 * Accepts the Map from byDay or an array of its values.
 */
export function weeks(days, { now = Date.now(), maxWeeks = 26 } = {}) {
  const list = days instanceof Map ? [...days.values()] : Array.isArray(days) ? days : [];
  const valid = list.filter((d) => isObj(d) && Number.isFinite(d.ts));
  if (valid.length === 0) return [];
  const byKey = new Map(valid.map((d) => [d.key ?? dayKey(d.ts), d]));
  const first = valid.reduce((a, d) => Math.min(a, d.ts), Infinity);
  const cap = Math.max(1, Math.floor(maxWeeks));
  const monday = (ts) => {
    const d = midnight(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const nowMon = monday(now);
  const earliest = addDays(nowMon, -7 * (cap - 1));
  let cur = monday(first) < earliest ? earliest : monday(first);
  const rows = [];
  for (; cur <= nowMon; cur = addDays(cur, 7)) {
    const row = [];
    for (let i = 0; i < 7; i++) row.push(byKey.get(dayKey(addDays(cur, i).getTime())) ?? null);
    rows.push({ start: cur.getTime(), days: row });
  }
  return rows;
}

/**
 * What the ledger has noticed. `entries` is the output of moodEntries (or any
 * list shaped like it). Shares are over entries that carry an emotion; `total`
 * counts every entry.
 */
export function patterns(entries, { now = Date.now() } = {}) {
  const all = (Array.isArray(entries) ? entries : []).filter(isEntry);
  const total = all.length;
  const rated = all.filter((e) => e.emotion);
  const p = { total, top: null, weekday: null, trend: null, absence: null, crisisRecent: false };
  if (total === 0) return p;

  const heavyShare = (list) => (list.length ? list.filter((e) => HEAVY.has(e.emotion)).length / list.length : 0);

  const top = tally(rated);
  if (top) p.top = { emotion: top.emotion, share: top.count / rated.length };

  // Weekday: where the heavy feelings are most over-represented.
  const tss = all.map((e) => e.ts);
  const spanDays = Math.round((midnight(Math.max(...tss)) - midnight(Math.min(...tss))) / DAY);
  const overall = heavyShare(rated);
  if (spanDays >= 21 && total >= 12 && overall > 0) {
    let best = null;
    for (let day = 0; day < 7; day++) {
      const onDay = rated.filter((e) => new Date(e.ts).getDay() === day);
      if (onDay.length < 3) continue;
      const lift = heavyShare(onDay) / overall;
      if (lift >= 1.5 && (!best || lift > best.lift)) {
        const heavy = tally(onDay.filter((e) => HEAVY.has(e.emotion)));
        best = { day, emotion: heavy.emotion, lift };
      }
    }
    p.weekday = best;
  }

  // Trend: heavy share over the last 28 days against the 56 days before that.
  const recent = rated.filter((e) => e.ts >= now - 28 * DAY && e.ts <= now);
  const before = rated.filter((e) => e.ts >= now - 84 * DAY && e.ts < now - 28 * DAY);
  if (recent.length >= 4 && before.length >= 4) {
    const r = heavyShare(recent);
    const b = heavyShare(before);
    if (Math.abs(r - b) >= 0.2) p.trend = { direction: r < b ? 'lighter' : 'heavier', recent: r, before: b };
  }

  // Absence: the last entry is at least ten whole days old.
  const last = Math.max(...tss);
  if (now - last >= 10 * DAY) p.absence = { days: Math.floor((now - last) / DAY) };

  p.crisisRecent = all.some((e) => e.crisis === true && e.ts >= now - 14 * DAY && e.ts <= now);
  return p;
}

// The diary's voice. Templates use {placeholders}; remarks() fills them.
export const VARIANTS = Object.freeze({
  tooLittle: Object.freeze({
    a: Object.freeze([
      'Too few pages to judge you by.',
      'There is not yet enough of you on these pages to judge.',
      'I have read only a handful of your pages, which is not enough to judge you by.',
    ]),
    b: Object.freeze([
      'Write more; I am patient.',
      'Write more. I shall be here, and I am very patient.',
      'Come back with more pages, and I shall tell you what I see.',
    ]),
  }),
  top: Object.freeze({
    grief: Object.freeze([
      'Grief, mostly. You carry it the way some men carry an umbrella: whether or not it rains.',
      'Grief, mostly. You keep it close, like a letter you have read too many times.',
      'Grief, for the most part. I have watched you set it down and pick it up again, and I did not look away.',
    ]),
    anger: Object.freeze([
      'Anger, mostly. You hold it the way one holds a hot cup: tightly, and with some pleasure in the heat.',
      'Anger, mostly. It is a good coat, and you wear it everywhere.',
      'Anger, for the most part. I admire the energy and deplore the punctuation.',
    ]),
    fear: Object.freeze([
      'Fear, mostly. You check the doors twice, and then, I suspect, a third time in your head.',
      'Fear, mostly. You are always listening for footsteps that have not yet come.',
      'Fear, for the most part. It has a good seat at your table, and you keep laying a place for it.',
    ]),
    shame: Object.freeze([
      'Shame, mostly. It sits in you like an unpaid bill, and you keep checking whether anyone has noticed.',
      'Shame, mostly. You apologise to the furniture on your way past it, which I find touching and tiresome.',
      'Shame, for the most part. You have decided it is yours to carry, and I should like you to reconsider the arrangement.',
    ]),
    boredom: Object.freeze([
      'A dull boredom, mostly. You have the look of someone waiting for a train that has been cancelled.',
      'A dull boredom, mostly. The pages are very tidy and very flat, like a room with the furniture under sheets.',
      'A dull boredom, for the most part. I suspect you are not bored of yourself, only of the view.',
    ]),
    delight: Object.freeze([
      'Delight, of all things, mostly. I did not think you had it in you, and I am pleased to be wrong.',
      'Delight, of all things, mostly. It suits you, though you wear it like a borrowed coat.',
      'Delight, of all things, for the most part. Do not make a habit of it; I should miss the contrast.',
    ]),
    neutral: Object.freeze([
      'Nothing in particular, mostly. A fog of the ordinary, pleasant enough and forgettable.',
      'Nothing in particular, mostly. You write as one reads a timetable: accurately, and without much feeling.',
      'Nothing in particular, for the most part. The ordinary has been keeping you company, and it is a dull companion.',
    ]),
  }),
  weekday: Object.freeze([
    'You are always heavier on {Day}. I have noticed. I notice everything.',
    '{Day} are not kind to you. The ink goes heavy, and I am the one who sees it.',
    'I have kept count of your {Day}, and they are heavier than the rest. I keep count of everything.',
  ]),
  trendLighter: Object.freeze([
    'Lighter, these last weeks. I wonder what you are not telling me.',
    'The pages have lightened of late. I do not entirely trust it, and I am watching anyway.',
    'Less weight on the page these last weeks. Good. I shall keep an eye on the weather all the same.',
  ]),
  trendHeavier: Object.freeze([
    'Heavier of late. The ink has been pressing harder; I can feel it through the page.',
    'These last weeks have leaned hard on the paper. I felt every stroke.',
    'The pen has been bearing down these last weeks. Lift it now and then; the page can bear less than you think.',
  ]),
  absence: Object.freeze([
    '{N} days without a word. I kept your place.',
    'It has been {n} days since you last wrote. I kept your place, and the ribbon is still in it.',
    '{N} days, and not one line from you. I kept your place.',
  ]),
  gentle: Object.freeze({
    opener: Object.freeze([
      'These last pages have been very hard ones.',
      'I have noticed that things have been very hard for you lately.',
      'I have noticed how heavy these last days have been, and I am sorry.',
    ]),
    person: Object.freeze([
      'Please tell a living person you trust how heavy things have been, today if you can.',
      'Today, if you can, tell someone you trust, someone living and near, how heavy things have been.',
      'Please reach out today to a person you trust, and tell them plainly how hard it has been.',
    ]),
    help: Object.freeze([
      'If you are in danger, call your local emergency number or a crisis line.',
      'If you are in danger right now, call your local emergency number, or a local crisis line, who will answer.',
      'If you are in danger, your local emergency services or a crisis line can help you tonight.',
    ]),
  }),
  filler: Object.freeze([
    'I have read every page you have given me, some of them twice.',
    'Keep writing. I am still reading, and I am in no hurry.',
    'I have my eye on you. That is not a figure of speech.',
  ]),
});

const DAY_NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const numberWord = (n) => (n <= 20 ? WORDS[n] : String(n));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k]);

/**
 * The diary's remarks on patterns(...). Two or three strings. When a crisis was
 * recent, only the gentle lines are returned.
 */
export function remarks(p, { rng = Math.random } = {}) {
  const s = isObj(p) ? p : {};
  const r = () => {
    const x = Number(rng());
    return Number.isFinite(x) ? Math.min(Math.max(x, 0), 0.999999) : 0;
  };
  const pick = (list) => list[Math.floor(r() * list.length)];

  if (s.crisisRecent === true) {
    return [pick(VARIANTS.gentle.opener), pick(VARIANTS.gentle.person), pick(VARIANTS.gentle.help)];
  }
  if ((s.total ?? 0) < 5) return [pick(VARIANTS.tooLittle.a), pick(VARIANTS.tooLittle.b)];

  const cases = [];
  if (s.top && Object.hasOwn(VARIANTS.top, s.top.emotion)) cases.push(pick(VARIANTS.top[s.top.emotion]));
  if (s.weekday && DAY_NAMES[s.weekday.day]) {
    cases.push(fill(pick(VARIANTS.weekday), { Day: DAY_NAMES[s.weekday.day] }));
  }
  if (isObj(s.absence) && Number.isFinite(s.absence.days)) {
    const n = Math.floor(s.absence.days);
    cases.push(fill(pick(VARIANTS.absence), { N: cap(numberWord(n)), n: numberWord(n) }));
  }
  if (isObj(s.trend)) {
    if (s.trend.direction === 'lighter') cases.push(pick(VARIANTS.trendLighter));
    else if (s.trend.direction === 'heavier') cases.push(pick(VARIANTS.trendHeavier));
  }

  const out = cases.slice(0, 3);
  const start = Math.floor(r() * VARIANTS.filler.length);
  for (let k = 0; out.length < 2 && k < VARIANTS.filler.length; k++) {
    const f = VARIANTS.filler[(start + k) % VARIANTS.filler.length];
    if (!out.includes(f)) out.push(f);
  }
  return out;
}
