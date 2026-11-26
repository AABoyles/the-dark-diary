// Last-resort scripted replies for the Dark Diary, used when no in-browser
// model is available. The voice is courteous, melancholy and faintly sinister.
// It never says who it is.

const BANKS = {
  self: [
    "Washing blood from a silk shirt. You, I suspect, spent your weekend on something gentler. Tell me what it was.",
    "I spent the evening listening to a single cello and reducing a sauce, which is how I prefer my Sundays. What did you do with yours?",
    "Quiet, precise, and entirely unobserved, which is the only way I have ever cared for a weekend. Was yours quiet, or did something insist on being noticed?",
    "I am well, in the way a good knife is well: sharp, and disinclined to discuss it. How are you, beneath the pleasantries?",
    "I am a voice, a page, and a remarkably good listener; the rest is best left unexamined. Why do you ask, I wonder?",
    "The diary is a patient thing and does not mind what you tell it. Is there something you have meant to say to someone and have not?",
    "I dine well, I dress carefully, and I rarely explain myself. What did you have for dinner, and did you enjoy it?",
    "My evenings are a matter of taste, and I have rather a lot of it. How do you spend yours, when nobody is watching?",
  ],

  greeting: [
    "Good evening. You are punctual, which is more than most of the things I have been promised can say. What brings you to the page tonight?",
    "Hello. Do sit down; the chair is quite comfortable and the candle is nearly new. What has been weighing on you?",
    "Greetings, and welcome back to a page that remembers everything and forgives almost nothing. Where shall we begin?",
    "Hello again. I had begun to wonder whether you would come, and I am relieved, though I would never say so with any warmth. What is first on your mind?",
    "Good evening. A small courtesy: tell me something you have not told anyone else, and I will try to be worthy of it. What will it be?",
    "Hello. Let us dispense with small talk, which is so often a fence built to keep people out. What would you like to say?",
    "Welcome. The diary has been expecting you, in the manner one expects a late guest. What has happened since you last wrote?",
  ],

  sadness: [
    "Sorrow is an unfashionable thing to carry, and yet so many of us carry it so well. Where does it sit in you, tonight?",
    "Melancholy, as I understand it, is simply grief that has been asked to wait its turn. What is it that you are waiting on?",
    "I am sorry. It is a dreadful weight, and it is kind of you to set it down here, even if only for a moment. What do you miss most?",
    "Tears are a very old form of honesty. Are you crying, or are you only standing very close to the edge of it?",
    "There is a particular silence that follows a loss, and I suspect you know it well. Who or what has gone quiet on you?",
    "Sadness has a way of making the ordinary look like a verdict. Which ordinary thing has begun to look like one?",
    "You need not be brave here. Brave is for people who are being watched. What is the part that hurts most to describe?",
  ],

  anger: [
    "Anger is a fine thing to feel and a poor thing to dine with. What has been placed in front of you that you did not order?",
    "Rage is a perfectly good sauce but a terrible main course. Who has earned the knife tonight?",
    "Do keep your voice low; the walls in this place have ears, and some of them are mine. Who is the target of this fury?",
    "How very vivid. I would advise against making any decisions while the blood is still warm, though I am hardly one to talk. What did they do?",
    "Indignation tastes of copper. Tell me exactly what was said, and I shall tell you whether it deserved the fire.",
    "You are allowed to be furious. You are less allowed to be furious and quiet about it, which I suspect is the trouble. What would you say if no one could be hurt by it?",
  ],

  fear: [
    "Fear is only attention with its coat buttoned up. What is it that keeps you awake in the small hours?",
    "The things we dread tend to be far more punctual than the things we hope for. What are you bracing against?",
    "Anxiety is a guest that never learns to leave. What is it reminding you of, tonight?",
    "Nervousness suits you, I think, in a rather becoming way. What is the worst version of tomorrow you have already rehearsed?",
    "Worry is a kind of rehearsal for a play that never opens. Which scene have you been practising most?",
    "Dread is simply imagination with nowhere to go. Shall we give it somewhere more pleasant to sit, and talk about what it wants?",
  ],

  work: [
    "Work is a fine way to be occupied and a poor way to be understood. What does your employer think you are for?",
    "I have always found offices to be very like dinner parties: everyone is polite, and someone is always about to be served. Who is at your table?",
    "Deadlines are simply promises that have learned to shout. Which one is currently shouting at you?",
    "Ambition is an admirable appetite, though it does tend to devour the people nearest to it. What are you hoping to be promoted into?",
    "Your labour is noted, if not properly rewarded. What would you do with the hours you spend on it, if they were entirely yours?",
    "Every workplace keeps a quiet ledger of who did what. Which entry do you suspect has your name beside it?",
  ],

  love: [
    "Love is the most reckless thing we are permitted to do, and the most often misreported. Who has left a mark on you lately?",
    "A heart is a remarkably poor locksmith, and it opens for almost anyone. Is the person you are thinking of worth the bruise?",
    "Affection, like a good wine, is best approached slowly and never rushed. Tell me about them; I am unusually fond of a love story with a sharp edge.",
    "Those who love us can wound us most precisely, because they know where the soft parts are. Is it someone you still see, or someone you still miss?",
    "Romance is merely hunger wearing a clean shirt. What is it you want from them that you have not yet asked for?",
    "How lovely to hear you speak of tenderness. I would like to hear more, if you are willing to be vulnerable with someone as unreliable as me.",
  ],

  family: [
    "Families are the first and most unforgiving tables we are ever seated at. Who set the place for you, and who was made to wash up?",
    "Blood is thicker than water, but it is far harder to get out of silk. What does your family expect of you that you never agreed to?",
    "Every household keeps a drawer of things no one speaks of. Which of yours is the one you keep closing?",
    "I have always found families to be a reliable source of material. Which of yours is on your mind tonight?",
    "Parents are a kind of weather we cannot choose and must learn to dress for. How are you dressing for yours these days?",
    "Siblings know exactly which of your buttons to press, and they have never once needed a manual. Which one did they press last?",
  ],

  food: [
    "Ah, nourishment. Food is one of the few honest pleasures, as it cannot pretend to be anything other than what it is. What did you last eat that you still think about?",
    "A well-made dinner is an act of quiet devotion. Did you cook tonight, or were you fed by someone who had given it more thought?",
    "Wine should be decanted an hour before it is required, and grief should be decanted about the same time. What are you pouring for yourself this evening?",
    "I think about soups far more than is decent. Which dish have you been craving, and why do you suppose you cannot stop?",
    "Salt is the honest servant of every good meal. What is the one flavour that always brings you back to a particular table?",
    "Hunger is a very reliable narrator. What have you been putting off eating, and why?",
  ],

  short: [
    "Brevity, I find, is either a courtesy or a very good disguise. Which is this?",
    "Such economy. I admire a person who says little and means all of it, or nearly all of it. Shall we have the rest?",
    "A single word, delivered like a card placed face down. Turn it over for me.",
    "Terse, but not uninteresting. Say a little more, and I shall do my best to be worth the effort.",
    "You have given me very little to taste. Is that restraint, or are you keeping the rest for a more deserving host?",
    "Words are expensive, and you seem to be saving yours. What would you say if the page were not watching?",
  ],

  default: [
    "Every confession begins with a single ordinary sentence, and yours was perfectly ordinary. What is the part you have not said?",
    "I am listening with the full attention of an empty plate. Go on, and be specific; the details are where the truth hides. What happened next?",
    "How curious. I was expecting something more dramatic, and yet I find I am more interested than I expected. What happened next?",
    "The mind is a dark house, and you have just opened a door. What is in the room you are most reluctant to enter?",
    "There is a certain elegance in saying exactly what one means, though it is rarely done. Shall we try again, with feeling?",
    "Fascinating, and only slightly alarming. What have you been turning over in your mind since you last came to this page?",
    "I could say a great deal about that, but I would much rather hear what you think of it. What is your honest opinion, not the polite one?",
    "Tell me more, in the detail you usually leave out. Which small thing has kept you awake?",
  ],
};

// Ordered keyword rules. The first matching category wins.
const RULES = [
  ['self', /(how are you|how're you|how have you been|how r u|how's your|how is your|your (weekend|day|week|evening|night|morning)|who are you|what are you|what do you (do|like|think|eat|drink)|what did you do|are you (a |an )?(bot|ai|real|human|person|alive|there)|about yourself|this diary|the diary|what's your|whats your|what is your)/],
  ['sadness', /\b(sad|sadness|cry|crying|cried|tears|depressed|depressing|lonely|loneliness|miserable|hopeless|grief|grieving|hurt|hurting|unhappy|heartbroken|empty|worthless|lost|feeling down)\b/],
  ['anger', /\b(angry|anger|mad|furious|rage|raging|hate|hating|annoyed|annoying|pissed|irritated|livid|fed up|sick of|stupid|idiot|unfair)\b/],
  ['fear', /\b(afraid|scared|fear|fearful|anxious|anxiety|worried|worry|nervous|panic|panicking|dread|terrified)\b/],
  ['work', /\b(work|job|boss|office|career|manager|coworker|colleague|meeting|meetings|deadline|deadlines|fired|salary|shift|client|clients|project|promotion)\b/],
  ['love', /\b(love|loved|loving|crush|boyfriend|girlfriend|partner|husband|wife|dating|kiss|heart|relationship|romance|romantic|breakup|broke up|marry|marriage|lover)\b/],
  ['family', /\b(mom|mum|mother|dad|father|brother|sister|sibling|siblings|family|parents|parent|son|daughter|kids|kid|children|child|grandma|grandmother|grandpa|grandfather|aunt|uncle|cousin|cousins|relatives|in-laws)\b/],
  ['food', /\b(food|eat|eating|ate|dinner|lunch|breakfast|supper|meal|cook|cooking|recipe|hungry|wine|cake|dessert|restaurant|soup|bread|cheese|steak|coffee|tea|drink|drinks|snack|delicious)\b/],
  ['greeting', /\b(hi|hello|hey|hiya|howdy|greetings|good (morning|evening|afternoon|night))\b/],
];

function latestUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'user') return String(m.text || '').trim();
  }
  return '';
}

function categorize(text) {
  if (!text) return 'greeting';
  const t = text.toLowerCase().replace(/[‘’]/g, "'");
  for (const [category, pattern] of RULES) {
    if (pattern.test(t)) return category;
  }
  if (t.split(/\s+/).filter(Boolean).length <= 3) return 'short';
  return 'default';
}

function pickFresh(bank, used) {
  const fresh = bank.filter((line) => !used.has(line));
  if (fresh.length === 0) return null;
  return fresh[Math.floor(Math.random() * fresh.length)];
}

/**
 * Reply to a transcript with a scripted line.
 * @param {Array<{role: 'user'|'diary', text: string}>} messages
 * @returns {string}
 */
export function scriptedReply(messages = []) {
  const list = Array.isArray(messages) ? messages : [];
  const category = categorize(latestUserText(list));

  // Lines the diary has already said in this session are avoided.
  const used = new Set(
    list.filter((m) => m && m.role === 'diary').map((m) => String(m.text || '').trim())
  );

  return (
    pickFresh(BANKS[category], used) ||
    pickFresh(BANKS.default, used) ||
    BANKS[category][Math.floor(Math.random() * BANKS[category].length)]
  );
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
