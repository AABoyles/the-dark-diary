// grammar.js: Tracery-style generation of the diary's replies.
//
// A grammar is a map from symbol to a list of expansions. An expansion is a
// string that may reference other symbols as '#symbol#', or with modifiers as
// '#symbol.capitalize#' and '#symbol.a#' (indefinite article). Symbols may carry
// a ':q' suffix ('#grief:q#'), which is simply another symbol.
//
// Each entry symbol builds a complete reply of one to three short sentences from
// interchangeable pieces: an opening, an observation and a closing (or, for the
// ':q' forms, a closing question). Statements never contain a question mark.
//
// Variables passed at expand time ('name', 'topic') are referenced as '#name#'
// and '#topic#'. Their values are inserted verbatim, with '#', '{' and '}'
// removed. A symbol named 'name' in GRAMMAR is a template that uses #name#;
// the variable of that name is looked up first when a token is resolved.

export const GRAMMAR = {
  // -------------------------------------------------------------------------
  // Entry symbols
  // -------------------------------------------------------------------------
  grief: [
    '#grief_open# #grief_obs# #grief_close#',
    '#grief_open# #grief_obs# #grief_close#',
    '#grief_open# #grief_obs# #grief_close#',
    '#grief_open# #grief_close#',
    '#grief_obs# #grief_close#',
    '#grief_open# #grief_obs#',
  ],
  anger: [
    '#anger_open# #anger_obs# #anger_close#',
    '#anger_open# #anger_obs# #anger_close#',
    '#anger_open# #anger_obs# #anger_close#',
    '#anger_open# #anger_close#',
    '#anger_obs# #anger_close#',
    '#anger_open# #anger_obs#',
  ],
  fear: [
    '#fear_open# #fear_obs# #fear_close#',
    '#fear_open# #fear_obs# #fear_close#',
    '#fear_open# #fear_obs# #fear_close#',
    '#fear_open# #fear_close#',
    '#fear_obs# #fear_close#',
    '#fear_open# #fear_obs#',
  ],
  shame: [
    '#shame_open# #shame_obs# #shame_close#',
    '#shame_open# #shame_obs# #shame_close#',
    '#shame_open# #shame_obs# #shame_close#',
    '#shame_open# #shame_close#',
    '#shame_obs# #shame_close#',
    '#shame_open# #shame_obs#',
  ],
  boredom: [
    '#boredom_open# #boredom_obs# #boredom_close#',
    '#boredom_open# #boredom_obs# #boredom_close#',
    '#boredom_open# #boredom_obs# #boredom_close#',
    '#boredom_open# #boredom_close#',
    '#boredom_obs# #boredom_close#',
    '#boredom_open# #boredom_obs#',
  ],
  delight: [
    '#delight_open# #delight_obs# #delight_close#',
    '#delight_open# #delight_obs# #delight_close#',
    '#delight_open# #delight_obs# #delight_close#',
    '#delight_open# #delight_close#',
    '#delight_obs# #delight_close#',
    '#delight_open# #delight_obs#',
  ],
  neutral: [
    '#neutral_open# #neutral_obs# #neutral_close#',
    '#neutral_open# #neutral_obs# #neutral_close#',
    '#neutral_open# #neutral_obs# #neutral_close#',
    '#neutral_open# #neutral_close#',
    '#neutral_obs# #neutral_close#',
    '#neutral_open# #neutral_obs#',
  ],

  'grief:q': [
    '#grief_open# #grief_obs# #grief_ask#',
    '#grief_open# #grief_obs# #grief_ask#',
    '#grief_open# #grief_obs# #grief_ask#',
    '#grief_open# #grief_ask#',
    '#grief_obs# #grief_ask#',
  ],
  'anger:q': [
    '#anger_open# #anger_obs# #anger_ask#',
    '#anger_open# #anger_obs# #anger_ask#',
    '#anger_open# #anger_obs# #anger_ask#',
    '#anger_open# #anger_ask#',
    '#anger_obs# #anger_ask#',
  ],
  'fear:q': [
    '#fear_open# #fear_obs# #fear_ask#',
    '#fear_open# #fear_obs# #fear_ask#',
    '#fear_open# #fear_obs# #fear_ask#',
    '#fear_open# #fear_ask#',
    '#fear_obs# #fear_ask#',
  ],
  'shame:q': [
    '#shame_open# #shame_obs# #shame_ask#',
    '#shame_open# #shame_obs# #shame_ask#',
    '#shame_open# #shame_obs# #shame_ask#',
    '#shame_open# #shame_ask#',
    '#shame_obs# #shame_ask#',
  ],
  'boredom:q': [
    '#boredom_open# #boredom_obs# #boredom_ask#',
    '#boredom_open# #boredom_obs# #boredom_ask#',
    '#boredom_open# #boredom_obs# #boredom_ask#',
    '#boredom_open# #boredom_ask#',
    '#boredom_obs# #boredom_ask#',
  ],
  'delight:q': [
    '#delight_open# #delight_obs# #delight_ask#',
    '#delight_open# #delight_obs# #delight_ask#',
    '#delight_open# #delight_obs# #delight_ask#',
    '#delight_open# #delight_ask#',
    '#delight_obs# #delight_ask#',
  ],
  'neutral:q': [
    '#neutral_open# #neutral_obs# #neutral_ask#',
    '#neutral_open# #neutral_obs# #neutral_ask#',
    '#neutral_open# #neutral_obs# #neutral_ask#',
    '#neutral_open# #neutral_ask#',
    '#neutral_obs# #neutral_ask#',
  ],

  name: [
    '#name_open# #name_obs# #name_close#',
    '#name_open# #name_obs# #name_close#',
    '#name_open# #name_obs# #name_close#',
    '#name_open# #name_close#',
    '#name_obs# #name_close#',
    '#name_open# #name_obs#',
  ],
  'name:q': [
    '#name_open# #name_obs# #name_ask#',
    '#name_open# #name_obs# #name_ask#',
    '#name_open# #name_obs# #name_ask#',
    '#name_open# #name_ask#',
    '#name_obs# #name_ask#',
  ],

  topic: [
    '#topic_open# #topic_obs# #topic_close#',
    '#topic_open# #topic_obs# #topic_close#',
    '#topic_open# #topic_obs# #topic_close#',
    '#topic_open# #topic_close#',
    '#topic_obs# #topic_close#',
    '#topic_open# #topic_obs#',
  ],
  'topic:q': [
    '#topic_open# #topic_obs# #topic_ask#',
    '#topic_open# #topic_obs# #topic_ask#',
    '#topic_open# #topic_obs# #topic_ask#',
    '#topic_open# #topic_ask#',
    '#topic_obs# #topic_ask#',
  ],

  // Sentence-level pieces. Statements contain no question mark; the *_ask
  // pieces are single questions and are only reached through ':q' symbols.
  grief_open: [
    'Forgive me for lingering over that.',
    'I am sorry to hear it, and I mean that more than is comfortable.',
    'Some losses arrive like unwelcome guests, and never quite learn to leave.',
    'That is a heavy thing to set down in a quiet room.',
    'I have read your words twice, which is my habit with things that hurt.',
    'The house has grown very still since you wrote that.',
    'Grief keeps its own calendar, and it is rarely kind about the dates.',
    'There is a particular hush that follows a sentence like that one.',
  ],
  grief_obs: [
    'The chair by the window still waits for someone who will not return.',
    'We often keep the best cutlery for the people we have already lost.',
    'A wound like that surfaces at the most civilised hours, over the soup.',
    'Nobody warns you that the ordinary things become the hardest to bear.',
    'The photographs are kept face down, as if they were too much for dinner.',
    'Some mornings the silence is the only company, and a poor one.',
    'You have set a place at the table, and then you remembered.',
    'The coat still hangs in the hall, and you walk around it carefully.',
    'Mourning is a long supper with a very patient host.',
    'It is strange how one absence can rearrange an entire house.',
  ],
  grief_close: [
    'Take whatever time the evening requires; it will not be hurried.',
    'There is no need to be composed here, not on these pages.',
    'Pour yourself something dark and let the candle burn a while.',
    'Sit with it a moment; sorrow is less frightening once it has a chair.',
    'The page will hold whatever you cannot carry just now.',
    'Grief is a debt paid slowly, and I am in no hurry to collect.',
    'Tell me as much as you can bear, and not one word more.',
    'Let the quiet stay; it has earned its place at the table tonight.',
  ],
  grief_ask: [
    'Who was it that you lost, if you are willing to say?',
    'What did you reach for, that first morning, when it was gone?',
    'Would you tell me about the one you miss?',
    'Which of their small habits do you catch yourself repeating?',
    'What is the thing you keep meaning to say to them?',
    'Did they leave you anything you still cannot bring yourself to use?',
    'Is it the loudness of the absence, or its quiet, that keeps you awake?',
    'How long has the house been this quiet?',
  ],

  anger_open: [
    'Your temper is plain on the page, and I find it rather refreshing.',
    'Do not apologise for the heat; a good fire needs it.',
    'Anger is an honest dish, served too hot, and I respect the cook.',
    'You are furious, and I suspect you have every right to be.',
    'There is a knife in those words, and you have held it quite steadily.',
    'Ah. The velvet has come off, and the steel is showing.',
    'Such rage deserves a proper audience, and you have one.',
    'I can hear the glass set down rather harder than it needed.',
  ],
  anger_obs: [
    'Somebody has been careless with something you treasured, and ought to know it.',
    'Politeness is a fine instrument, but it does not always cut through.',
    'The people who wrong us are rarely troubled by the wrong itself.',
    'Patience can curdle into something sharper, given enough time.',
    'You have smiled across the table for so long that your jaw must ache.',
    'Injustice tastes of metal, and you have been chewing on it for days.',
    'Those most apologetic about their conduct are seldom the ones who regret it.',
    'You were owed a better hearing, and you were not given one.',
    'Some slights are small enough to swallow and too large to digest.',
    'Every grudge keeps a careful ledger, and yours has been filling nicely.',
  ],
  anger_close: [
    'Say it as loudly as you like; these pages have heard worse.',
    'Let the anger speak first; it is always more honest than good manners.',
    'Do not swallow it whole. Give me the particulars and we shall look at them.',
    'The wine is breathing, and so, I suspect, are you. Go on.',
    'Strike the table if you must; the candlesticks are used to it.',
    'Be as cruel as you like on paper, and then be kind to yourself.',
    'Anger is a door, and we may stand in it together for a while.',
  ],
  anger_ask: [
    'Who gave you this wound, and did they know what they were doing?',
    'What would you say to them, if you were certain of being heard?',
    'Is it the act that galls you, or the calm with which it was done?',
    'Shall I hear the whole account, or only the part that burns?',
    'Who has been spared the consequences of this, do you suppose?',
    'What, precisely, would make the room feel fair again?',
    'Did you say anything at the time, or only reach for the bread?',
    'How long has this been waiting for a proper hearing?',
  ],

  fear_open: [
    'Fear tends to arrive before its reasons do, and you have my sympathy.',
    'There is nothing shameful in a racing pulse at this hour.',
    'I can feel the draught in that sentence, and I have not left my chair.',
    'Dread is an intimate guest; it knows exactly where you keep your keys.',
    'The shadows have grown long, and you have noticed them.',
    'Some nights the house creaks in a voice you have never heard before.',
    'Your words have gone very careful, the way a cat crosses a cold floor.',
    'Courage is a late-evening habit, and you are still practising it.',
  ],
  fear_obs: [
    'Fear is a clever cook; it makes the smallest room seem the largest.',
    'Some corners of the mind were built for nothing but waiting in the dark.',
    'What frightens us is seldom the thing itself, but the imagining around it.',
    'The mind invents the worst possible guest and seats it beside you.',
    'You are listening for a footstep that may never come, and that is tiring.',
    'Danger and dread are different, though the stomach rarely knows it.',
    'Every unanswered message becomes a small door left ajar at night.',
    'The knife that frightens you most is usually the one not yet shown.',
    'Fear makes a fine stock and a poor meal; it simmers for hours.',
    'The silence after a certain telephone call can be louder than speech.',
  ],
  fear_close: [
    'Keep the lamp lit and the door in view; nothing here will rush you.',
    'Breathe slowly, and let me hold the lamp while you look.',
    'Whatever waits at the foot of the stairs can wait until your wine is finished.',
    'You are braver than you feel, which is the usual condition of the brave.',
    'Stay where it is warm, and we shall go down together when you are ready.',
    'The worst of it is nearly always the waiting. The rest is only weather.',
  ],
  fear_ask: [
    'What is it you are most afraid will happen next?',
    'Is the fear in your body, or only in the story you keep telling?',
    'When did you first notice the cold coming in?',
    'Shall we name it, so that it has less room to pretend?',
    'What would you do tomorrow if you were not listening for trouble tonight?',
    'Who would you call if the lights went out, and who would you rather not?',
    'What does the worst version look like, if you describe it plainly?',
    'Has anything in the house moved, or is it only the thought of moving?',
  ],

  shame_open: [
    'Please do not blush on my account; I have heard far worse over dinner.',
    'There is nothing so tender as a confession that costs something to make.',
    'You are carrying something heavy, and setting it down here takes courage.',
    'I shall not look away, though I may look at the candle for a moment.',
    'Embarrassment becomes you less than you imagine, and more than you would like.',
    'You have said more than you meant to, and I am glad of it.',
  ],
  shame_obs: [
    'Shame is an old sauce, and it clings to whatever it touches.',
    'We tend to replay our small failures long after the guests have gone home.',
    'Nobody remembers our clumsiest moments as vividly as we do.',
    'You have measured yourself against a standard nobody else was keeping.',
    'The mind is an unkind housekeeper; it dusts the old mistakes and forgets the good.',
    'Some regrets are merely the price of having tried something worth the trouble.',
    'There is a particular silence kept after saying the wrong thing at a dinner.',
    'The memory returns at inconvenient hours, usually while one is trying to sleep.',
  ],
  shame_close: [
    'Hold it a moment longer, then decide whether it is yours to keep.',
    'You are allowed to be imperfect in this room; the candles have seen worse.',
    'Let us take the wrong thing out and look at it under the lamp.',
    'Nothing you have said here is beyond the reach of a good night sleep.',
    'Pour yourself a little courage and go on, if you wish.',
  ],
  shame_ask: [
    'Who was watching when it happened, and do they remember it as you do?',
    'Would it help to say what you wish you had done instead?',
    'Is it the act that troubles you, or what it seems to say about you?',
    'What would you tell a friend who had done the very same thing?',
    'How long do you intend to keep this one on the mantelpiece?',
    'Was there anyone who tried to help, and did you let them?',
    'What part of it is the hardest to say out loud?',
  ],

  boredom_open: [
    'Ah, the grey hour, when even the wallpaper seems to be yawning.',
    'I know the feeling well; a long afternoon is a dinner nobody has cooked.',
    'Nothing much is happening, and yet something in you has noticed.',
    'The clock has grown rather too interested in itself.',
    'There is a stillness that comes before something interesting, or before nothing.',
    'A dull day is only a plain plate waiting for the right sauce.',
    'You sound as though the hours have been walking past without stopping.',
    'Idleness has a flavour of its own, faintly bitter, like tea left too long.',
  ],
  boredom_obs: [
    'Monotony is a slow poison, though it is served in very small spoonfuls.',
    'Everything in the room seems to have agreed to stop happening at once.',
    'The empty moments are the dangerous ones, when the mind goes looking for amusement.',
    'Routine presses its face against the window until someone opens it.',
    'There is a great deal of silver in this house, all of it tarnished.',
    'Time, left unsupervised, begins to behave like a cat on a windowsill.',
    'A well-kept boredom is a marvellous instrument, if one learns to play it.',
    'You have been waiting for something to begin, and it is taking its time.',
  ],
  boredom_close: [
    'Let us make something of the hour, even if it is only a small mischief.',
    'Tell me something you have been meaning to do, and we shall give it attention.',
    'Pour a glass and invent a better afternoon; I shall be your audience.',
    'Boredom is appetite without a menu, and I have several dishes in mind.',
    'Sit down; the evening has more in it than it appears to.',
  ],
  boredom_ask: [
    'What have you been putting off, that you are too tired to begin?',
    'If you could be anywhere else this evening, where would you go?',
    'What did you used to do with afternoons like this one?',
    'Would you care to hear something not yet said in this house?',
    'What would make the hour feel as though it belonged to you?',
    'Is the day dull, or only the way you are looking at it?',
    'Shall I tell you a story, or would you rather tell one?',
  ],

  delight_open: [
    'How splendid. I should have liked to be there when it happened.',
    'What a pleasure to read that, and I am not easily pleased.',
    'Something in your words has warmed the room considerably.',
    'Your happiness is audible from here, which is rare in this house.',
    'Well. That is a rather fine thing to have found on an ordinary day.',
    'You sound like someone who has tasted something unexpectedly perfect.',
    'Joy of that sort is fine wine, and you are pouring generously.',
    'I confess I am delighted, and I do not say that lightly.',
  ],
  delight_obs: [
    'Pleasure is the most underrated seasoning, and you have been generous with it.',
    'There is music in the way you describe it, a small unhurried melody.',
    'Happiness arrives without invitation, then sits as if it owned the chair.',
    'A single good moment can rearrange the entire week, quite cheerfully.',
    'Good news has a fragrance, and yours fills the whole page.',
    'Such a day deserves silk, a good glass, and time to savour it.',
    'The best things arrive quietly, like a letter slipped under the door.',
    'You have found something to treasure, and I can see its glint from here.',
  ],
  delight_close: [
    'Tell me every detail; I should like to take a small share of it.',
    'Keep the feeling as long as you can; such things are rare.',
    'Raise a glass to it, and let no one talk you out of the toast.',
    'Savour it slowly; joy is best eaten without hurry.',
    'Go on, I am delighted to be the one you tell.',
  ],
  delight_ask: [
    'What was the first thing you noticed, when it happened?',
    'Who else knows, and are they as pleased as you are?',
    'Shall we mark the occasion with something rich and a little outrageous?',
    'How long has it been since you felt quite this light?',
    'Would you share the best part before the candle burns down?',
    'What will you do with the rest of the evening now?',
    'Did it arrive as a surprise, or had you been hoping for it all along?',
  ],

  neutral_open: [
    'Good. The page is listening, and it has nowhere else it would rather be.',
    'Thank you for writing, which is more than the furniture manages.',
    'I have considered your words with the seriousness they deserve.',
    'Very well. Let us see where this sentence wishes to take us.',
    'A quiet remark, but I have noticed it, as I notice everything.',
    'Such a plain statement, and yet it sits rather prettily on the paper.',
    'I have set your words beside the candle and studied them for a moment.',
  ],
  neutral_obs: [
    'Most people reveal far more in ordinary remarks than in confessions.',
    'There is always something worth noticing beneath a plain sentence.',
    'Conversation is a kind of dinner, and the first course is the most revealing.',
    'One rarely says exactly what one means, and that is where it gets interesting.',
    'Plain words are a good disguise; they hide the knife rather well.',
    'An ordinary evening hides its surprises in the corners.',
    'Everything said here is a small piece of furniture, arranged with care.',
    'It is curious how little we must say before the house begins to speak.',
  ],
  neutral_close: [
    'Go on, then. I have the time and the inclination, which is a rare pairing.',
    'Let it sit a moment; the best remarks improve with a little air.',
    'There is more here, and I am patient as only a page can be.',
    'Say whatever comes next; I shall know it when I see it.',
    'We can wander as slowly as you like. The wine is still good.',
  ],
  neutral_ask: [
    'What made you think of that, just now?',
    'Is there more to it, or was that the whole of the matter?',
    'How did the rest of your day find you?',
    'Shall we take the thought somewhere more interesting?',
    'What would you say if you were sure nobody would repeat it?',
    'Was that a remark you intended, or one that slipped out?',
    'Where would you like the conversation to go from here?',
  ],

  name_open: [
    '#name.capitalize# has been on my mind, and I suspect that was the intention.',
    'I notice that #name# has been mentioned with some care.',
    'Do tell me more about #name#; I am already quite curious.',
    '#name.capitalize# is a name that sits heavily in your sentences.',
    'You have spoken of #name# as though the words were a little dangerous to hold.',
    'Ah, #name#. A name always arrives with its own furniture.',
    'I have been turning #name# over, like a good spoon in the light.',
    'There is a great deal folded inside the mention of #name#.',
  ],
  name_obs: [
    'Some people linger in our sentences long after they have left the room.',
    'The way one speaks of a person says more than most of the facts.',
    'A name carries its own weight, and it is rarely the weight we expect.',
    'Affection, resentment and curiosity all dine at one table, and rarely agree.',
    'It is remarkable how a single name can turn a whole evening.',
    'People we cannot quite forget often have the most interesting handwriting.',
    'Whoever they are, they have left a mark, and marks are what I collect.',
    'Relationships are a long supper, with courses nobody quite agreed to.',
  ],
  name_close: [
    'Tell me as much as you are willing to, and keep the rest cellared.',
    'Take your time with it; a name deserves a proper introduction.',
    'We can leave the particulars for later, if they are too sharp for tonight.',
    'Pour a little something and tell me how they came to matter so much.',
    'I should like to hear the story from the beginning, if you will indulge me.',
  ],
  name_ask: [
    'What is it about #name# that you cannot put down?',
    'Does #name# know how much room they take up in your thoughts?',
    'Have you spoken to #name# about any of this, or only to the page?',
    'When did #name# first become someone you thought of at night?',
    'What would you say to #name#, if you knew it would be received kindly?',
  ],

  topic_open: [
    '#topic.capitalize# is a subject I would happily sit with all evening.',
    'I have been thinking about #topic# since you mentioned it.',
    'There is something about #topic# that refuses to stay quietly on the shelf.',
    'Few things reveal a person as well as the way they speak of #topic#.',
    'You mention #topic# as though it were a very good wine, carefully kept.',
    'Ah, #topic#. A small word carrying a great deal of weight.',
    '#topic.capitalize# seems to be doing more than its share of the talking.',
    'I notice #topic# has crept into your sentences, like a cat under a table.',
  ],
  topic_obs: [
    'Every object we care for casts a little shadow, and this one a generous one.',
    'We tend to describe our passions in the language of appetite.',
    'What we return to again and again is usually what we explain least well.',
    'A preoccupation is a lamp that throws long shadows across the rest of life.',
    'Things we love and things we fear often share the same chair at dinner.',
    'There is a particular tenderness in the way you place that word.',
    'Attention is a currency, and you have been spending a good deal of it.',
    'Some subjects arrive with their own tablecloth, silver and quiet.',
  ],
  topic_close: [
    'Tell me what absorbs you most about it, and leave the rest to the candle.',
    'Let it be as large as it likes here; the page has room.',
    'Take the thought slowly; I should like to see it from every side.',
    'Pour yourself a glass and consider the matter at leisure.',
    'There is no hurry. Good subjects keep well in a cool room.',
  ],
  topic_ask: [
    'What is it about #topic# that keeps drawing you back?',
    'When did #topic# first become so important to you?',
    'Does #topic# bring you comfort, or only keep you company?',
    'What would you lose, if #topic# were taken from you tomorrow?',
    'Who else in your life shares your fascination with #topic#?',
    'How much of #topic# is truly yours, and how much was handed to you?',
    'Have you ever tried to explain #topic# to someone who did not care?',
    'Where does #topic# sit in your thoughts when the house is silent?',
  ],

  // Used by the test suite to check the '.a' modifier against a known word.
  object_probe: [
    'There is #topic.a# on the sill, and it has been there all winter.',
  ],
};

// Fallbacks for '#name#' and '#topic#' when the caller passes no value.
const DEFAULT_VARS = { name: 'your friend', topic: 'that matter' };
const VARIABLE_NAMES = Object.keys(DEFAULT_VARS);

const MAX_DEPTH = 12;
const TOKEN = /#([A-Za-z_][\w:]*)((?:\.[a-z]+)*)#/g;
const EMOTIONS = ['grief', 'anger', 'fear', 'shame', 'boredom', 'delight', 'neutral'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Indefinite article by sound, with the common exceptions.
function articleFor(word) {
  if (/^h(our|onest|onou?r|eir)/i.test(word)) return 'an';
  if (/^(uni|use|usu|eu|one|once|ewe|ubi|uri|ure)/i.test(word)) return 'a';
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

function applyModifier(text, mod) {
  switch (mod) {
    case 'capitalize':
      return text.charAt(0).toUpperCase() + text.slice(1);
    case 'a':
      return text ? `${articleFor(text)} ${text}` : text;
    default:
      return text;
  }
}

// Variables are plain text: strip anything that could be read as markup.
function cleanVars(vars) {
  const scope = { ...DEFAULT_VARS };
  if (!vars || typeof vars !== 'object') return scope;
  for (const key of VARIABLE_NAMES) {
    const value = vars[key];
    if (value === undefined || value === null) continue;
    const cleaned = String(value).replace(/[#{}]/g, '').trim();
    if (cleaned) scope[key] = cleaned;
  }
  return scope;
}

function pick(list, rand) {
  const index = Math.min(list.length - 1, Math.floor(rand() * list.length));
  return list[index];
}

function expandSymbol(symbol, rand, scope, depth) {
  if (depth > MAX_DEPTH) return '';
  if (!Object.prototype.hasOwnProperty.call(GRAMMAR, symbol)) return '';
  const options = GRAMMAR[symbol];
  if (!Array.isArray(options) || options.length === 0) return '';
  return expandTemplate(pick(options, rand), rand, scope, depth + 1);
}

function expandTemplate(template, rand, scope, depth) {
  if (depth > MAX_DEPTH) return '';
  return template.replace(TOKEN, (_, name, modifiers) => {
    let text;
    if (Object.prototype.hasOwnProperty.call(scope, name)) {
      text = scope[name];
    } else {
      text = expandSymbol(name, rand, scope, depth);
    }
    const mods = modifiers ? modifiers.split('.').filter(Boolean) : [];
    for (const mod of mods) text = applyModifier(text, mod);
    return text;
  });
}

// Collapse whitespace, tidy punctuation spacing and capitalise sentence starts.
function finish(raw) {
  let text = raw.replace(/#/g, '').replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
  text = text.replace(/([.!?]\s+)([a-z])/g, (_, stop, letter) => stop + letter.toUpperCase());
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Expands a symbol into text. Unknown symbols give ''.
export function expand(symbol, { rand = Math.random, vars = {} } = {}) {
  const scope = cleanVars(vars);
  return finish(expandSymbol(String(symbol), rand, scope, 0));
}

// Chooses a reply for an emotion. Uses the name or topic symbols when the
// writer has mentioned one: the name 40% of the time when a name is given,
// otherwise the topic 30% of the time when a topic is given.
export function compose(emotion, { rand = Math.random, name = null, topic = null, wantQ = false } = {}) {
  const base0 = EMOTIONS.includes(emotion) ? emotion : 'neutral';
  let base = base0;
  if (name && rand() < 0.4) base = 'name';
  else if (topic && rand() < 0.3) base = 'topic';
  const symbol = wantQ ? `${base}:q` : base;
  const text = expand(symbol, { rand, vars: { name: name || undefined, topic: topic || undefined } });
  return { text, q: text.endsWith('?') };
}
