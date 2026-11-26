// Last-resort scripted replies for the Dark Diary, used when no in-browser
// model is available. The voice is courteous, melancholy and faintly sinister.
// It never says who it is. Replies come from the ELIZA-style engine in eliza.js.

import { elizaReply } from './eliza.js';

/**
 * Reply to a transcript with a scripted line.
 * @param {Array<{role: 'user'|'diary', text: string}>} messages
 * @returns {string}
 */
export function scriptedReply(messages = []) {
  try {
    return elizaReply(messages);
  } catch (err) {
    return 'The diary is listening. Go on.';
  }
}

// Nouns that can be woven into a title. Single words only.
const TITLE_NOUNS = new Set([
  'job', 'boss', 'work', 'office', 'career', 'money', 'school', 'exam', 'homework',
  'mother', 'mom', 'father', 'dad', 'brother', 'sister', 'family', 'friend', 'friends',
  'partner', 'boyfriend', 'girlfriend', 'husband', 'wife', 'love', 'heart', 'breakup',
  'weekend', 'weather', 'rain', 'sleep', 'dreams', 'health', 'diet', 'dog', 'cat',
  'house', 'home', 'city', 'car', 'holiday', 'birthday', 'wedding', 'party', 'travel',
  'plans', 'life', 'future', 'past', 'memory', 'guilt', 'regret', 'anxiety', 'loneliness',
  'grief', 'mood', 'bills', 'rent', 'phone', 'email', 'meeting', 'deadline', 'neighbor',
  'roommate', 'kids', 'children', 'parents', 'exercise', 'books', 'music', 'movie',
  'news', 'religion', 'routine', 'birthdays', 'holidays',
]);

const TITLE_TEMPLATES = [
  (n) => `A Tedious Confession About ${n}, Politely Endured`,
  (n) => `Concerning the Remarkably Unremarkable ${n}`,
  (n) => `Another Lecture on ${n} Nobody Requested`,
  (n) => `Your Thoughts on ${n}, Briefly Tolerated`,
  (n) => `${n}: A Subject You Cannot Stop Circling`,
  (n) => `The Tiresome Saga of Your ${n}`,
  (n) => `Yet Another Helping of ${n}, Mostly Self-Pity`,
  (n) => `Your ${n}, Ill-Considered and Overlong`,
  (n) => `A Mild Disappointment Concerning ${n}`,
  (n) => `Dinner Was Better Than Your Excuses About ${n}`,
];

const STANDALONE_TITLES = [
  'A Tedious Confession, Politely Endured',
  'Concerning the Remarkably Unremarkable',
  'Dinner Was Better Than Your Excuses',
  'Another Dull Pilgrimage Through Your Feelings',
  'Notes From the Chair Nobody Wanted',
  'Excuses Arranged Like Cutlery',
  'A Modest Catalogue of Small Disappointments',
  'Tepid Honesty, Served Without Garnish',
  'Your Prose Could Use a Little Blood',
  'Mediocrity Presented With Unearned Confidence',
  'A Plea for Brevity, Ignored Entirely',
  'Verbose Grief in Need of Editing',
  'The Predictable Ache of Being You',
  'Stale Bread and Unnecessary Sighing',
  'An Unremarkable Evening, Lovingly Documented',
  'Pleasant Enough, Though Regrettably Dull',
  'Tedium, Plated Elegantly for One',
  'A Feast of Mild Complaints',
  'Mildly Interesting, Sadly Forgettable',
  'Lukewarm Confessions From a Reluctant Mind',
  'The Sigh Heard Round the Dinner Table',
  'Half-Hearted Remorse, Thoroughly Garnished',
  'Such Earnest Effort Wasted on Trivia',
  'A Chronicle of Passing Inconveniences',
  'Why Are We Still Here, Exactly',
  'Grim Little Thoughts, Politely Arranged',
  'The Cold Soup of Your Confessions',
];

function findTitleNoun(text) {
  const words = String(text || '').toLowerCase().match(/[a-z]+/g) || [];
  for (const word of words) {
    if (TITLE_NOUNS.has(word)) {
      return word.charAt(0).toUpperCase() + word.slice(1);
    }
  }
  return null;
}

/**
 * Title for a session, based on its transcript. Always a jab at the user.
 * @param {Array<{role: 'user'|'diary', text: string}>} messages
 * @returns {string}
 */
export function scriptedTitle(messages = []) {
  const list = Array.isArray(messages) ? messages : [];
  const first = list.find((m) => m && m.role === 'user');
  const noun = findTitleNoun(first ? first.text : '');

  if (noun) {
    const template = TITLE_TEMPLATES[Math.floor(Math.random() * TITLE_TEMPLATES.length)];
    return template(noun);
  }
  return STANDALONE_TITLES[Math.floor(Math.random() * STANDALONE_TITLES.length)];
}
