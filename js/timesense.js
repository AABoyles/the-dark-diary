// js/timesense.js: what the clock says about this moment, and how the diary
// may remark on it. Pure functions: the caller passes the Date and the time
// of the writer's last message. Nothing here touches the DOM or storage.

const MINUTE = 60000;
const HOUR_MIN = 60;
const DAY_MIN = 1440;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Tags checked in this order when choosing the one remark to make.
const PRIORITY = ['holiday', 'small-hours', 'very-long-gap', 'long-gap', 'weekend-night', 'monday'];

function periodOf(hour) {
  if (hour < 5) return 'small hours';
  if (hour < 8) return 'early morning';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

function holidayOf(month, day, weekdayIndex) {
  if (month === 1 && day === 1) return "New Year's Day";
  if (month === 2 && day === 14) return "Valentine's Day";
  if (month === 10 && day === 31) return 'Halloween';
  if (month === 12 && day === 24) return 'Christmas Eve';
  if (month === 12 && day === 25) return 'Christmas Day';
  if (month === 12 && day === 31) return "New Year's Eve";
  if (day === 13 && weekdayIndex === 5) return 'Friday the 13th';
  return null;
}

/** Minutes as a phrase: "a few minutes", "an hour", "3 hours", "a day", "2 days". */
function span(minutes) {
  if (minutes < HOUR_MIN) return `${Math.max(1, minutes)} minutes`;
  if (minutes < DAY_MIN) {
    const h = Math.floor(minutes / HOUR_MIN);
    return h === 1 ? 'an hour' : `${h} hours`;
  }
  const d = Math.floor(minutes / DAY_MIN);
  return d === 1 ? 'a day' : `${d} days`;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function pickIndex(n, rand) {
  const r = Number(rand());
  if (!Number.isFinite(r) || r < 0) return 0;
  return Math.min(n - 1, Math.floor(r * n));
}

/**
 * The moment, described: hour, minute, period of day, weekday, weekend flag,
 * holiday name (or null), minutes since the last message (or null), and the
 * tags that make this moment worth remarking on.
 */
export function timeContext(now = new Date(), { lastMessageTs = null } = {}) {
  const d = now instanceof Date ? now : new Date(now);
  const hour = d.getHours();
  const minute = d.getMinutes();
  const wd = d.getDay();
  const period = periodOf(hour);
  const holiday = holidayOf(d.getMonth() + 1, d.getDate(), wd);

  let gapMinutes = null;
  if (lastMessageTs != null) {
    const last = new Date(lastMessageTs).getTime();
    if (Number.isFinite(last)) {
      gapMinutes = Math.max(0, Math.floor((d.getTime() - last) / MINUTE));
    }
  }

  const notable = [];
  if (period === 'small hours') notable.push('small-hours');
  if (wd === 1 && hour < 12) notable.push('monday');
  if ((wd === 5 || wd === 6) && hour >= 21) notable.push('weekend-night');
  if (holiday) notable.push('holiday');
  if (gapMinutes !== null && gapMinutes >= HOUR_MIN) notable.push('long-gap');
  if (gapMinutes !== null && gapMinutes >= DAY_MIN) notable.push('very-long-gap');

  return {
    hour,
    minute,
    period,
    weekday: WEEKDAYS[wd],
    isWeekend: wd === 0 || wd === 6,
    holiday,
    gapMinutes,
    notable,
  };
}

const PART_OF_DAY = {
  'small hours': 'in the small hours',
  'early morning': 'in the morning',
  morning: 'in the morning',
  afternoon: 'in the afternoon',
  evening: 'in the evening',
  night: 'at night',
};

/**
 * A paragraph for an LLM system prompt describing the moment, or '' when
 * nothing about it is notable.
 */
export function timeNote(ctx) {
  if (!ctx || !Array.isArray(ctx.notable) || ctx.notable.length === 0) return '';
  const h12 = ctx.hour % 12 || 12;
  const mm = String(ctx.minute).padStart(2, '0');
  const lines = [`It is ${h12}:${mm} ${PART_OF_DAY[ctx.period] || ''} on a ${ctx.weekday}.`];
  if (ctx.holiday) lines.push(`Today is ${ctx.holiday}.`);
  if (ctx.gapMinutes !== null && ctx.gapMinutes >= HOUR_MIN) {
    lines.push(`The writer last wrote here ${span(ctx.gapMinutes)} ago.`);
  }
  lines.push(
    'Remark on the moment only rarely and obliquely, never in every reply; ' +
    'most replies should ignore the hour and the date entirely.'
  );
  return lines.join(' ');
}

const REMARKS = {
  holiday: (ctx) => {
    const n = ctx.holiday;
    return [
      `It is ${n}. I had hoped you would remember me on a day like this.`,
      `${n}. Few people write on such days without a reason, and fewer admit it.`,
      `Today is ${n}. I have laid out the good silver in anticipation.`,
      `It is ${n}, and you chose to spend it here. I find that rather touching.`,
    ];
  },
  'small-hours': () => [
    'The hour suits you. Few honest things are written before dawn.',
    'Still awake, and the house is asleep. I find that very becoming in a writer.',
    'The small hours are when the truth comes to the table without its gloves on.',
    'Nobody else is up at this hour, which is why you are here. I approve of your company.',
  ],
  'very-long-gap': (ctx) => {
    const s = span(ctx.gapMinutes);
    return [
      `You have been gone for ${s}. I kept the chair warm, which is more than you deserved.`,
      `It has been ${s} since you last wrote. I am not angry. I am only patient, which is worse.`,
      `${cap(s)} of silence from you. I counted every minute of it, and you may find that unflattering.`,
      `You stayed away for ${s}. I was not surprised, but I was disappointed, which is rarer.`,
    ];
  },
  'long-gap': (ctx) => {
    const s = span(ctx.gapMinutes);
    return [
      `You left mid-sentence ${s} ago. I kept your place.`,
      `The last thing you wrote was ${s} ago. I have been turning it over since.`,
      `It has been ${s} since you went quiet. Quiet is not the same as gone, and I know the difference.`,
      `You went silent ${s} ago, mid-thought. I left the lamp on for you.`,
    ];
  },
  'weekend-night': (ctx) => {
    const w = ctx.weekday;
    return [
      `It is ${w} night. Others are out being loud; you are in here being honest.`,
      `${w} night, and you chose the quiet. A person of such restraint is rare, and I am suspicious of them.`,
      'The weekend has begun without you, and you have spent its first hours with me. Flattering, if a little sad.',
      `Most people are dancing or drinking on ${w} night. You are writing. Your taste is very particular.`,
    ];
  },
  monday: () => [
    'A Monday morning. The week is still wet ink, and you have chosen to spend some of it here.',
    'Nothing good has ever been decided before noon on a Monday. Still, here you are, deciding.',
    'It is Monday, and not yet noon. Mondays are for dread, and you have brought yours to me.',
    'The week has only just begun, and already you are confiding in me. Sit down and tell me what it has promised you.',
  ],
};

/**
 * One in-voice line remarking on the most notable tag, or null when nothing
 * is notable. `rand` is injectable for tests.
 */
export function timeRemark(ctx, rand = Math.random) {
  const notable = ctx && Array.isArray(ctx.notable) ? ctx.notable : [];
  const tag = PRIORITY.find((t) => notable.includes(t));
  if (!tag) return null;
  const variants = REMARKS[tag](ctx);
  return variants[pickIndex(variants.length, rand)];
}
