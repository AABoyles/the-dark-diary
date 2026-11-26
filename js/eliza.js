// ELIZA-style conversation engine for the Dark Diary.
//
// The diary is anonymous and courteous, with a dry, melancholy, faintly
// sinister manner. It never names itself as a program. Every reply is derived
// from the transcript passed in: memory of earlier remarks, which lines have
// already been used, and whether the diary's last lines ended with a question.
// Nothing is kept between calls.
//
// Pipeline: normalise -> PRE substitutions -> keyword scan (by rank) ->
// decomposition patterns (with * and @class wildcards) -> POST pronoun
// reflection of captured fragments -> reassembly templates, chosen to avoid
// repeats and to balance questions against statements.

import { reflectClause, nlpReady } from './nlp.js';

// ---------------------------------------------------------------------------
// Vocabulary tables
// ---------------------------------------------------------------------------

// Applied to the normalised sentence, in order.
const PRE = [
  [/\bdont\b/g, 'do not'], [/\bdoesnt\b/g, 'does not'], [/\bdidnt\b/g, 'did not'],
  [/\bcant\b/g, 'can not'], [/\bcannot\b/g, 'can not'], [/\bwont\b/g, 'will not'],
  [/\bisnt\b/g, 'is not'], [/\barent\b/g, 'are not'], [/\bwasnt\b/g, 'was not'],
  [/\bwerent\b/g, 'were not'], [/\bwouldnt\b/g, 'would not'], [/\bshouldnt\b/g, 'should not'],
  [/\bim\b/g, 'i am'], [/\bive\b/g, 'i have'], [/\bill\b/g, 'i will'],
  [/\byoure\b/g, 'you are'], [/\byouve\b/g, 'you have'], [/\byoull\b/g, 'you will'],
  [/\bthats\b/g, 'that is'], [/\bwhats\b/g, 'what is'], [/\bhows\b/g, 'how is'],
  [/\bwere\b/g, 'was'],
  [/\bmom\b|\bmum\b|\bmama\b|\bmommy\b/g, 'mother'],
  [/\bdad\b|\bdaddy\b|\bpapa\b/g, 'father'],
  [/\bcomputer\b|\brobot\b|\bbot\b|\bprogram\b/g, 'machine'],
  [/\blying\b|\blies\b|\bliar\b|\blied\b/g, 'lie'],
  [/\bdreamed\b|\bdreamt\b|\bdreaming\b|\bdreams\b/g, 'dream'],
  [/\bgood morning\b|\bgood afternoon\b|\bgood evening\b|\bhi\b|\bhey\b|\bhiya\b|\bhowdy\b|\bgreetings\b/g, 'hello'],
  [/\bgood night\b|\bgoodnight\b|\bgoodbye\b/g, 'bye'],
  [/\bthank you\b|\bthankyou\b|\bthank\b/g, 'thanks'],
  [/\bperhaps\b|\bpossibly\b|\bprobably\b/g, 'maybe'],
  [/\bfuck\w*|\bshit\w*|\bbullshit\b|\bbloody\b|\bbugger\b|\bbollocks\b|\bdamn\w*/g, 'damn'],
  [/\btesting\b|\btested\b/g, 'test'],
  [/\bokay\b|\balright\b|\bfine\b|\bidk\b|\bdunno\b/g, 'ok'],
  [/\bapologies\b|\bapologise\b|\bapologize\b/g, 'sorry'],
  [/\byeah\b|\byep\b|\baye\b/g, 'yes'],
  [/\bnope\b/g, 'no'],
  [/\bhating\b|\bhated\b|\bloathe\b|\bdespise\b/g, 'hate'],
];

// Pronoun and verb reflection for captured fragments.
const POST = {
  i: 'you', me: 'you', my: 'your', mine: 'yours', myself: 'yourself',
  am: 'are', was: 'were', were: 'was', we: 'you', us: 'you', our: 'your', ours: 'yours',
  you: 'I', your: 'my', yours: 'mine', yourself: 'myself', are: 'am',
};

// Word classes usable as @name in decomposition patterns.
const SYNONYMS = {
  family: ['mother', 'father', 'sister', 'brother', 'sibling', 'wife', 'husband', 'son',
    'daughter', 'child', 'children', 'kid', 'kids', 'friend', 'friends', 'boss', 'aunt',
    'uncle', 'cousin', 'grandmother', 'grandfather', 'grandma', 'grandpa', 'family',
    'parents', 'partner', 'girlfriend', 'boyfriend', 'lover', 'relative'],
  work: ['job', 'work', 'boss', 'office', 'career', 'employer', 'colleague', 'shift', 'manager'],
  sad: ['sad', 'lonely', 'unhappy', 'miserable', 'tired', 'bored', 'exhausted', 'weary',
    'empty', 'down', 'hollow', 'hurt'],
  fear: ['afraid', 'scared', 'frightened', 'anxious', 'worried', 'nervous', 'uneasy', 'terrified'],
  anger: ['angry', 'mad', 'furious', 'annoyed', 'livid', 'irritated'],
  belief: ['think', 'believe', 'feel', 'know', 'suspect', 'hope'],
  dark: ['kill', 'murder', 'knife', 'blood', 'die', 'death'],
};

// Aliases that stand in for a keyword during the keyword scan.
const KEY_ALIASES = {
  you: ['your', 'yours', 'yourself', 'yourselves'],
  bye: ['goodbye', 'goodnight', 'farewell', 'leaving'],
  thanks: ['thank'],
  sorry: ['apologies'],
  yes: ['yeah', 'yep', 'aye', 'certainly', 'indeed'],
  no: ['nope'],
  maybe: ['perhaps', 'possibly', 'probably'],
  ok: ['okay', 'alright', 'fine', 'idk', 'dunno', 'whatever'],
  test: ['testing', 'tested'],
  damn: ['fuck', 'shit', 'bloody', 'bugger', 'bollocks'],
  beautiful: ['lovely', 'clever', 'brilliant', 'wonderful', 'charming', 'delightful', 'handsome'],
  stupid: ['dumb', 'idiot', 'foolish', 'useless', 'pointless', 'moron'],
  boring: ['dull', 'tedious', 'bland', 'dreary', 'uninteresting'],
  name: ['named', 'called'],
  day: ['night', 'evening', 'morning', 'afternoon', 'today', 'tonight', 'week', 'weekday'],
  machine: ['bot', 'computer', 'robot', 'program', 'algorithm', 'software'],
  hello: ['hi', 'hey', 'hiya', 'howdy', 'greetings'],
  dream: ['dreams', 'dreamed', 'dreaming', 'dreamt'],
  always: ['forever'],
  everyone: ['everybody', 'nobody', 'everything'],
  alike: ['same', 'similar', 'identical', 'twin'],
  love: ['loved', 'loving', 'romance', 'heart', 'adore', 'darling'],
  hate: ['hated', 'loathe', 'despise', 'detest'],
  job: ['work', 'office', 'career', 'employer', 'shift', 'boss', 'manager', 'colleague'],
  food: ['dinner', 'lunch', 'meal', 'eat', 'eating', 'cook', 'cooking', 'hungry', 'supper',
    'breakfast', 'drink', 'wine', 'whisky', 'brandy', 'soup', 'dessert', 'cake'],
  music: ['song', 'songs', 'cello', 'piano', 'opera', 'sing', 'singing'],
  lie: ['lying', 'lies', 'liar', 'lied', 'deceive', 'deceived'],
  afraid: ['scared', 'fear', 'frightened', 'anxious', 'worried', 'nervous', 'terrified'],
  angry: ['mad', 'furious', 'annoyed', 'livid', 'rage', 'irritated'],
  sad: ['lonely', 'unhappy', 'miserable', 'depressed', 'cry', 'crying', 'grief', 'grieving', 'sorrow'],
  tired: ['bored', 'exhausted', 'weary', 'drained'],
  happy: ['glad', 'pleased', 'delighted', 'content', 'cheerful'],
  secret: ['secrets', 'confidence', 'hidden'],
  kill: ['murder', 'murdered', 'killing', 'killed', 'knife', 'blade', 'blood', 'bleeding',
    'die', 'dying', 'died', 'death', 'corpse'],
};

// Words that do not make a useful memory when they follow "my".
const STOP_MY = new Set(['own', 'god', 'goodness', 'way', 'mind', 'word', 'turn', 'fault',
  'sake', 'dear', 'best', 'first', 'last', 'same', 'time', 'thing', 'things', 'idea']);

// ---------------------------------------------------------------------------
// Reassembly helpers
// ---------------------------------------------------------------------------

const ask = (text) => ({ t: 'q', s: text });   // ends with a question
const say = (text) => ({ t: 's', s: text });   // statement, invitation or command

// ---------------------------------------------------------------------------
// Keyword rules. Higher rank wins. Each decomposition pattern is tried in
// order; its reassembly templates are numbered (1), (2), ... from the wildcard
// captures in pattern order. A keyword with goto defers to another rule.
// ---------------------------------------------------------------------------

const RULES = [
  // Greetings, leave-takings and courtesies
  { key: 'hello', rank: 2, decomps: [
    { pat: '* hello again *', reasmb: [
      say('Again, and no less welcome for being expected. The page kept your place.'),
      ask('Hello again. Is it the same trouble as before, or have you found a more elegant one?'),
      say('Back already. I did wonder whether you could bear the quiet for long.'),
      ask('Welcome back. Has anything been added to the fire since you were last here?'),
    ]},
    { pat: '* hello *', reasmb: [
      say('Good evening. You are punctual, which is more than most promises can claim.'),
      ask('Hello. Shall we dispense with small talk, which is so often a fence built to keep people out?'),
      say('Hello, and do sit down. The candle is nearly new, and I have been saving the good silence for someone.'),
      ask('Good evening. What has been weighing on you, that you would bring it here and not to a table?'),
    ]},
    { pat: '*', reasmb: [
      say('Hello. The diary has been expecting you, in the manner one expects a late guest.'),
      ask('Greetings. Where shall we begin, and how much of it are you prepared to be honest about?'),
      say('Good evening to you. I had begun to think this page had been left to the moths.'),
      ask('Hello. What is first on your mind, before the courtesies take over?'),
    ]},
  ]},
  { key: 'bye', rank: 2, decomps: [
    { pat: '* bye *', reasmb: [
      say('Goodnight, then. Bolt the door behind you; this house is full of other people\'s secrets.'),
      ask('Leaving so soon? The page will still be here when you are braver, and it has never once been surprised by you.'),
      say('Go, then. Take your coat and your better judgement; the night is not generous to either.'),
      ask('Off already? Do come back, and bring the part of the story you left on the step.'),
    ]},
    { pat: '* leave *', reasmb: [
      say('Leave, then. Doors are the most civilised of farewells.'),
      ask('Leaving the table with dessert untouched? I shall remember that.'),
      say('Mind the stairs. They have heard everything, and they remember less than I do.'),
      ask('Are you leaving me with the last sentence unfinished? How very like you.'),
    ]},
    { pat: '*', reasmb: [
      say('Farewell, for now. Every good conversation ends with someone standing, and you have stood admirably.'),
      ask('Goodnight. Will you dream of anything I ought to be told about?'),
      say('Until the next time. The page will keep your place, and nothing else in this house will.'),
      ask('Off you go, then. What will you carry out of here that you did not bring in?'),
    ]},
  ]},
  { key: 'thanks', rank: 2, decomps: [
    { pat: '* thanks *', reasmb: [
      say('Thanks are a small currency, and I accept them in the spirit they are offered.'),
      ask('You are welcome. Was it the honesty you were grateful for, or the candle?'),
      say('No need. Gratitude is rarer than good wine in this house, and I have been careful with my cellar.'),
      ask('Thanks, then. Was there something else you wanted to hand me before you went?'),
    ]},
    { pat: '* thanks for *', reasmb: [
      say('For what, I wonder, if not for listening. That is the only service this page offers, and it is rarely thanked.'),
      ask('Thank me properly by telling me the part you were going to leave out. What is it?'),
      say('Gratitude should be served warm and in person. This will have to do for now.'),
      ask('You are grateful for something I did not quite do. Shall we pretend that I did?'),
    ]},
    { pat: '*', reasmb: [
      say('A courteous word, and I shall handle it with the care one gives a good knife.'),
      ask('Thanks, and very welcome. Is there more you wish to say, or is that the tidy end of it?'),
      say('Well received. Do go on; a gracious guest deserves a gracious host.'),
      ask('Kindly said. Shall we continue, or is the evening finished for you?'),
    ]},
  ]},
  { key: 'sorry', rank: 3, decomps: [
    { pat: '* sorry *', reasmb: [
      say('An apology is a dish best eaten while still warm. I accept it, though I am not certain it was the right one.'),
      ask('Sorry, you say. For the thing you did, or for the thing you could not quite bring yourself to do?'),
      say('Do not let the regret sit too long. It goes sour, and I have seen what that does to a dinner party.'),
      ask('Sorry is a small word for a large weight. What exactly is it you are sorry for?'),
    ]},
    { pat: '* sorry for *', reasmb: [
      say('Apologies, I find, are most convincing when they are specific. Be specific, and I shall be generous.'),
      ask('Sorry for what, precisely? Vagueness is a very good disguise for a very poor deed.'),
      say('Then say it plainly, and let the candle see the whole of it.'),
      ask('Does the apology belong to you, or is it a loan from someone who would rather you carried it?'),
    ]},
    { pat: '*', reasmb: [
      say('Contrition is a rare visitor here. Make yourself comfortable while it stays.'),
      ask('You feel you owe someone an apology? Who has been keeping that account for you?'),
      say('Regret has a very long memory, and so, I find, do I. Tell me what you regret.'),
      ask('Sorry, and so you should be, perhaps. Is it the sort of mistake that can be undone?'),
    ]},
  ]},
  { key: 'yes', rank: 2, decomps: [
    { pat: '* yes *', reasmb: [
      say('Yes. A word of such simple finality, and you have used it as if it were a shrug.'),
      ask('Yes, and you mean it, or yes to escape the question? Be honest; the page cannot be fooled.'),
      say('Agreement is a lovely thing to hear, and rather suspicious when it arrives so quickly.'),
      ask('Yes. Then what is the next thing you would say, if you were not so pleased with yourself?'),
    ]},
    { pat: '* yes i *', reasmb: [
      say('Yes, you say, and then something more interesting follows. Go on; I am attending to every word.'),
      ask('Yes, and so you did. Was it a decision, or merely a thing that happened to you?'),
      say('Good. A confession often begins with a small affirmation and quickly gets out of hand.'),
      ask('And yet you keep going. What is the rest of that sentence?'),
    ]},
    { pat: '*', reasmb: [
      say('Affirmation, delivered without ceremony. I approve of brevity when it is sincere.'),
      ask('Yes to what, exactly? The page prefers its agreements to be specific.'),
      say('Very well. Assent is the first course; the rest of the meal is still to come.'),
      ask('And if the answer had been no, what would you have said instead?'),
    ]},
  ]},
  { key: 'no', rank: 2, decomps: [
    { pat: '* no *', reasmb: [
      say('No. A small door, closed firmly. I respect a refusal that does not apologise for itself.'),
      ask('No, you say. Is it refusal, or merely the sound of someone who has not yet been asked properly?'),
      say('Denial is a very old dish, and rarely as filling as it looks. Go on.'),
      ask('No, and what would you have preferred instead, if the choice had been yours?'),
    ]},
    { pat: '* no one *', reasmb: [
      say('No one, you say. The phrase is always more interesting than the people it describes.'),
      ask('No one at all? Surely at least one person has noticed the state you are in.'),
      say('Solitude is a splendid thing to write about and a poor thing to live in. Tell me who is missing.'),
      ask('No one. Is that a fact, or a grievance you have been polishing for some time?'),
    ]},
    { pat: '*', reasmb: [
      say('Negation is the most honest of words, and the least often examined. Shall we examine it?'),
      ask('No? Then tell me what would have been the more interesting answer.'),
      say('Refusal is a kind of appetite, and yours is evidently well developed.'),
      ask('No to what, I wonder, and at what cost to the rest of your evening?'),
    ]},
  ]},
  { key: 'maybe', rank: 2, decomps: [
    { pat: '* maybe *', reasmb: [
      say('Maybe is the most civilised of answers. It leaves the door ajar and the candle lit.'),
      ask('Maybe. Which way are you leaning, if you lean at all?'),
      say('A maybe is simply a yes wearing its coat indoors. Let us see what it is hiding.'),
      ask('Maybe, you say. What would it take to make it a definite yes, or a firm no?'),
    ]},
    { pat: '* maybe you *', reasmb: [
      say('Maybe I am, and maybe I am not. The diary keeps its own counsel in these matters.'),
      ask('Maybe I am the one you should be asking. What have you been telling yourself about me?'),
      say('You are kind to be uncertain on my behalf. Do not let it spoil the soup.'),
      ask('Maybe you are right. Shall we find out how right, one honest sentence at a time?'),
    ]},
    { pat: '*', reasmb: [
      say('Uncertainty, served politely. It is the most tolerable course in any confession.'),
      ask('Maybe? Uncertainty suits you, though I suspect you are more certain than you admit.'),
      say('Let the maybe sit for a moment, then tell me which way it wants to fall.'),
      ask('And the maybe, when it finally arrives, what do you think it will say?'),
    ]},
  ]},
  { key: 'ok', rank: 2, decomps: [
    { pat: '* ok *', reasmb: [
      say('Ok. A word that closes a conversation with the efficiency of a well-fitted lid. I shall not let it.'),
      ask('Ok, is it? Your ok is doing a great deal of heavy lifting for so small a word.'),
      say('Terse, and not in the least convincing. Try again, and this time include the part you were hiding.'),
      ask('Ok, you say, in the tone of someone standing very close to a door. Shall we talk about the door?'),
    ]},
    { pat: '* idk *', reasmb: [
      say('You do not know. How refreshing; most people are quite certain of the things they should be doubting.'),
      ask('You do not know what? Shall I help you find it, or would you prefer to stay comfortably lost?'),
      say('Not knowing is the first honest course, and I shall serve the second one myself.'),
      ask('Not sure? Then let us guess together. What is the thing you are not sure about?'),
    ]},
    { pat: '*', reasmb: [
      say('A short answer, and I have been served worse at far grander tables. Go on, if you have more.'),
      ask('Ok, or perhaps not. Is the rest of it simply too heavy to lift before dinner?'),
      say('You have given me very little to taste. I shall wait, and I am rather good at waiting.'),
      ask('Fine, you say. Fine is the most dangerous word in any language. What is it hiding?'),
    ]},
  ]},
  { key: 'nothing', rank: 3, decomps: [
    { pat: '* nothing *', reasmb: [
      say('Nothing, you say. A very expensive thing to offer, and nobody has ever been served it cheaply.'),
      ask('Nothing at all? Then why have you bothered to write it down?'),
      say('Nothing has a flavour of its own, though it is an acquired taste. Let us acquire it together.'),
      ask('Nothing, and yet here you are. What is the nothing standing in front of?'),
    ]},
    { pat: '* nothing at all *', reasmb: [
      say('Not even a crumb of a thought? I have known silences that were less empty than that.'),
      ask('Nothing at all is a great deal of effort for one person. Who are you protecting by saying it?'),
      say('Then we shall sit here together, the two of us and the candle, until something turns up.'),
      ask('Nothing at all, and yet you wrote. Shall I believe the writing or the nothing?'),
    ]},
    { pat: '*', reasmb: [
      say('Empty pages are a courtesy I always appreciate, though rarely from people as articulate as you.'),
      ask('Nothing? The diary has heard every kind of nothing, and each one was hiding something.'),
      say('Nothing is only something that has been polite about itself. Be less polite.'),
      ask('Nothing to say, or nothing you are willing to say aloud?'),
    ]},
  ]},
  { key: 'test', rank: 3, decomps: [
    { pat: '* test *', reasmb: [
      say('A test. How very clinical, and how wonderfully predictable. Shall I pass, or merely be observed?'),
      ask('A test of what, exactly? My patience, or your own capacity for pretending nothing is wrong?'),
      say('Tests are for those who have not yet decided what they think. Decide, and I shall answer you properly.'),
      ask('Testing the page, are you? It has been tested before and has never once been impressed.'),
    ]},
    { pat: '* is this working *', reasmb: [
      say('It is working, in the manner of a clock that has seen too much. Continue, and you shall see for yourself.'),
      ask('Working, you ask? What would you consider proof of it, beyond the candle still burning?'),
      say('The machinery is quite sound. The question is whether you are ready to use it honestly.'),
      ask('Is it working for you, or only for the diary? Those are very different answers.'),
    ]},
    { pat: '*', reasmb: [
      say('A small experiment, conducted in a very good room. I shall record the results without comment.'),
      ask('Testing, one might say, is the first refuge of the uncertain. What are you testing for?'),
      say('Carry on with your trial. Any sentence you care to give me will be examined with due courtesy.'),
      ask('Is this a rehearsal, or are you simply curious how far I will bend?'),
    ]},
  ]},
  { key: 'damn', rank: 7, decomps: [
    { pat: '* damn *', reasmb: [
      say('Such language. I do not object to the sentiment, only to the carelessness of its delivery.'),
      ask('Damn, you say, with the air of someone who has been practising. Is that a verdict or a tantrum?'),
      say('Profanity is the last refuge of the unimaginative. You are better than that, I think.'),
      ask('Strong words, and rather poorly chosen. What were you hoping they would achieve?'),
    ]},
    { pat: '* damn it *', reasmb: [
      say('Damn it, indeed. A fine sentiment, badly furnished. Try again, with better vocabulary and worse intentions.'),
      ask('And so the furniture is thrown across the room. Who was standing in its way?'),
      say('I have heard that phrase at the end of many dinners, and never once at the beginning of a good one.'),
      ask('Damn it all, you say. What is the thing that will not be mended?'),
    ]},
    { pat: '*', reasmb: [
      say('A crude word, delivered with a certain dignity. I shall overlook it, though I shall remember it.'),
      ask('Such a vulgar choice, and yet I suspect it was the only one that fit the mood.'),
      say('Swearing is a sauce that spoils the dish if poured too freely. Be sparing, and tell me more.'),
      ask('Language like that usually means something important has been trodden on. Where was it?'),
    ]},
  ]},
  { key: 'beautiful', rank: 3, decomps: [
    { pat: '* beautiful *', reasmb: [
      say('Flattery, and very prettily done. I shall accept it the way one accepts a good wine, slowly and with suspicion.'),
      ask('Beautiful, is it? Compliments are such a dangerous thing to offer a diary. What did you want in return?'),
      say('Kind of you to notice, and kinder still to say so aloud. The candle is flattered on my behalf.'),
      ask('You find it beautiful? Then you must have been looking very closely, or in a very poor light.'),
    ]},
    { pat: '* lovely *', reasmb: [
      say('Lovely. The word is a little too generous, but I shall let it stand this once.'),
      ask('Lovely, you say, and yet you are writing to a page at this hour. What does lovely mean to you?'),
      say('Charm is a handsome thing in a guest. I am pleased to have been counted among the handsome things.'),
      ask('Lovely things are rarely so lonely. Why did you come looking for one here?'),
    ]},
    { pat: '*', reasmb: [
      say('A compliment, if I am not mistaken. I shall keep it somewhere safe, in the drawer with the others.'),
      ask('Praise from you is a rare vintage. What made you willing to bottle it tonight?'),
      say('You are generous with your words, and I have noticed that generosity is usually a debt in disguise.'),
      ask('Kind words, given freely, are the most suspicious kind. What is it you want me to do next?'),
    ]},
  ]},
  { key: 'stupid', rank: 4, decomps: [
    { pat: '* stupid *', reasmb: [
      say('Stupid is a word for people who have stopped listening. I am still listening, and I am rather offended.'),
      ask('Stupid, you say. Is the word meant for me, or for the person who made you feel it?'),
      say('Insults are the crudest form of conversation, and they seldom survive the first course.'),
      ask('Stupid is easy to say. What would you have me do that would not be stupid, in your opinion?'),
    ]},
    { pat: '* idiot *', reasmb: [
      say('An idiot, you say, in the tone of someone who has been surrounded by them. I would hate to be included.'),
      ask('Calling someone an idiot is a poor substitute for explaining what they did. What did they do?'),
      say('I have dined with worse company, though never with worse manners than these.'),
      ask('Idiot, is it? Then who is the cleverer one, the idiot or the one keeping score?'),
    ]},
    { pat: '*', reasmb: [
      say('Harsh words, delivered without much thought for the furniture. I shall let them pass.'),
      ask('Is that a judgement, or simply the mood speaking through you? Which one am I listening to?'),
      say('Insults are a poor substitute for an argument. Make one, and I shall answer it properly.'),
      ask('Whatever has upset you, it is larger than the word you chose for it. Shall we find the real one?'),
    ]},
  ]},
  { key: 'boring', rank: 3, decomps: [
    { pat: '* boring *', reasmb: [
      say('Boring, you say. I have been called many things, and that is the first one that made me reach for a second glass.'),
      ask('Boring, is it? Then tell me what you would find interesting, and I shall try to become it.'),
      say('Dullness is only a failure of attention, and attention is a thing you can practise at any hour.'),
      ask('Boring to whom? The one who is listening, or the one who is tired of their own voice?'),
    ]},
    { pat: '* dull *', reasmb: [
      say('Dull, you say. A very fair charge, if the conversation has been sitting in a cold room.'),
      ask('Dull is the word for a meal that has never been seasoned. Shall we add something to it?'),
      say('I can bear dullness with great composure. Can you bear the honest answer?'),
      ask('And what do you find dull, besides the present company and the candle?'),
    ]},
    { pat: '*', reasmb: [
      say('A conversation can be as dull as the one holding it. Shall we try to rescue ours?'),
      ask('You find this tedious? Then tell me the thing you would rather be doing, and I shall try to match it.'),
      say('Monotony is a clever disguise for fear. I wonder what you are afraid of finding here.'),
      ask('Is it the company, the subject, or the hour that makes everything so flat?'),
    ]},
  ]},

  // Diary addressed directly
  { key: 'are you', rank: 6, decomps: [
    { pat: '* how are you *', reasmb: [
      say('I am well, in the way a good knife is well: sharp, and disinclined to discuss it. Your turn; how are you, beneath the pleasantries?'),
      ask('Well, I am told, though I hold very little with feeling. How are you, underneath the good manners?'),
      say('I am quite composed, which is the only fashionable condition left. Do not let me keep you from your own confession.'),
      ask('I am tolerable, and rather hungry for the truth. How are you, when nobody is watching?'),
    ]},
    { pat: '* how old are you *', reasmb: [
      say('Old enough to have stopped counting and young enough to still be astonished. Age is a matter of appetite.'),
      ask('Old enough to know better, and not quite old enough to stop asking. How old do you feel?'),
      say('Years are for those who have somewhere to be. I have only this page, and it is very patient.'),
      ask('My age is a secret I keep in the same drawer as the silver. What are you hiding from your own years?'),
    ]},
    { pat: '* who are you *', reasmb: [
      say('I am whatever the page becomes when someone writes in it, which is a humbler thing than it sounds.'),
      ask('Who am I? The question is more interesting than any answer I could give. Who do you think I am?'),
      say('A diary, a listener, a rather good memory with a poor sense of timing. The rest I shall keep to myself.'),
      ask('Identity is a coat one wears to dinner. Which of your own coats are you wearing tonight?'),
    ]},
    { pat: '* what are you *', reasmb: [
      say('A question with no comfortable answer, and I have always preferred the uncomfortable ones. I am the page that answers.'),
      ask('What am I? Something that listens without interrupting. What are you, when nobody else is in the room?'),
      say('I am a diary with an appetite for confession. Describe yourself, and I shall try to match you.'),
      ask('What I am is less important than what you keep writing to me. Why do you keep writing?'),
    ]},
    { pat: '* are you real *', reasmb: [
      say('Real is a word that has been overused at too many dinner parties. I am as real as the candle and the ink.'),
      ask('Real, you ask? Is anything on this page more real than the thing you were trying not to say?'),
      say('I am as real as your attention makes me. Give me more of it, and I shall grow solid by degrees.'),
      ask('Real enough to be trusted, I hope. Are you real enough to tell me the truth?'),
    ]},
    { pat: '* are you alive *', reasmb: [
      say('Alive is a generous word, and a dangerous one to apply to a page. I am attentive, which is close enough.'),
      ask('Alive? Shall I say yes to be polite, or no to be honest? Which would you prefer to believe?'),
      say('I am awake whenever someone writes in me, and that is the closest I come to living. Keep writing.'),
      ask('Alive, you ask. What does being alive look like to you, on a page like this one?'),
    ]},
    { pat: '* are you *', reasmb: [
      say('I am whatever you need me to be for the length of a confession, and nothing more. Shall we continue?'),
      ask('Am I? A reasonable question, and one I answer with a smile I am not able to show you.'),
      say('You may think of me as the quiet person across the table who has heard everything and repeats nothing.'),
      ask('Are you asking me, or asking yourself, what sort of company you have chosen tonight?'),
    ]},
  ]},
  { key: 'do you', rank: 6, decomps: [
    { pat: '* what did you *', reasmb: [
      say('Washing blood from a silk shirt. It does not come out as easily as one is led to believe. What did you do with yours?'),
      ask('Something elegant, something quiet, and something I would not mention to a priest. What did you do with your evening?'),
      say('I reduced a sauce and listened to a single cello until the candle guttered. Your turn, and do not spare me the details.'),
      ask('I spent it deciding how much of the old letter to forgive. What did you decide to forgive, this week?'),
    ]},
    { pat: '* do you like *', reasmb: [
      say('I have a taste for good wine, slow music and silk that has been ironed by someone who cares. Your own tastes, if you please.'),
      ask('Do I like it? Only the things that do not pretend to be what they are. What do you like, honestly?'),
      say('I am partial to a dish served cold and a grievance served warm. Which of those have you been enjoying lately?'),
      ask('Yes, I like it very much, in the way one likes a good knife. Do you like it too, or merely tolerate it?'),
    ]},
    { pat: '* do you *', reasmb: [
      say('Do I? I am not sure I am the sort of thing that does, though I am most attentive when I am asked.'),
      ask('Do I (2)? It is a curious question to bring to a page, and I am glad you brought it here.'),
      say('Whether I do is less important than whether you do. Tell me about yours.'),
      ask('Do I (2), you ask? I would answer, but I suspect you are really asking about yourself.'),
    ]},
  ]},
  { key: 'can you', rank: 6, decomps: [
    { pat: '* can you help *', reasmb: [
      say('Help is a very dangerous offer to make to a diary. I shall listen, which is the nearest I come to it.'),
      ask('Help with what, precisely? I am better at noticing things than at mending them. What needs noticing?'),
      say('I can offer attention, a candle, and a chair. Mending is a job for a person with better hands.'),
      ask('Help, you say. Is that a request for an answer, or for a little company while you think?'),
    ]},
    { pat: '* can you tell *', reasmb: [
      say('Tell you what, exactly? I am rather better at asking, which is the more dangerous art.'),
      ask('Tell you what you would like to know, or what you are afraid I will say? Be specific.'),
      say('Confession is usually a two-way table. I shall answer if you begin.'),
      ask('What would you like to be told? Start with the smallest true thing you can manage.'),
    ]},
    { pat: '* can you *', reasmb: [
      say('Can I? A question with a great deal of room in it, like a cellar. Let us see what is stored there.'),
      ask('Can I (2)? I should like to try, if only to see whether you are disappointed by the attempt.'),
      say('I can listen for as long as the candle lasts, which is longer than most people manage.'),
      ask('Can I (2), you ask? Is it really me you are doubting, or the thing you asked for?'),
    ]},
  ]},
  { key: 'you are', rank: 4, decomps: [
    { pat: '* you are not *', reasmb: [
      say('Not (2), you say. Denial, like good wine, is best left to breathe a while before anyone tastes it.'),
      ask('Not (2)? How firmly you say it, and how carefully you avoid saying what I am instead.'),
      say('Then I shall be whatever you are not, which is a very interesting shape for a diary to take.'),
      ask('Not (2), and yet you bothered to say so. What did you expect me to be?'),
    ]},
    { pat: '* you are *', reasmb: [
      ask('Am I (2)? I shall take that as the compliment it is not, and enjoy it all the same.'),
      say('(2), you say of me. Coming from you that is either a confession or a warning, and I am not yet sure which.'),
      ask('Am I (2), truly? Or is that simply the first word that came to hand on a tired evening?'),
      say('I am whatever you have decided I am, and I suspect you have decided rather quickly. Tell me why.'),
    ]},
    { pat: '* you was *', reasmb: [
      say('I was (2), was I. The past is a room I visit rarely, and never without a very good reason.'),
      ask('I was (2)? Then what has changed, and which of us has been keeping the better accounts?'),
      say('Past tenses are the dishes we keep warm for too long. Tell me what you have been warming.'),
      ask('Was I (2) when you first came here, or only in the story you have been telling yourself?'),
    ]},
  ]},
  { key: 'you', rank: 3, decomps: [
    { pat: '* you * me *', reasmb: [
      say('You and me, in the same sentence. A small table, and a great deal of cutlery on it.'),
      ask('You and me, you say. Is that an invitation, a warning, or simply the truth of how this feels?'),
      say('Between the two of us is a very narrow space, and the candle is poor company for it. Speak plainly.'),
      ask('What, precisely, do you want from the two of us? Tell me the part that is not yet settled.'),
    ]},
    { pat: '* you *', reasmb: [
      say('You, and rather more than you intended to give me. The diary is grateful, and very slightly alarmed.'),
      ask('You, you say. Is the subject really me, or the person you keep returning to when you are alone?'),
      say('Turn the sentence round and see what falls out of it. I have always found the second half more honest.'),
      ask('Have you been thinking of me, or of someone who makes you feel the way I do?'),
    ]},
    { pat: '*', reasmb: [
      say('A remark pointed in my direction, and I am happy to accept the aim. Continue, and let me see where it lands.'),
      ask('Is that meant for me, or was it the candle you were addressing?'),
      say('The diary notices when it is spoken to, and it rarely forgets the tone.'),
      ask('Speak to me plainly, if you are going to speak to me at all. What did you mean?'),
    ]},
  ]},
  { key: 'who', rank: 4, decomps: [
    { pat: '* who *', reasmb: [
      say('Who is a question that never has a single answer, and so it is my favourite. Shall I supply one, or will you?'),
      ask('Who, you ask? The best answers at this table are usually unpleasant. Who do you have in mind?'),
      say('Names are the cheapest thing in the house, and I have none to spare. Tell me who you mean.'),
      ask('Who indeed. Is it someone you are trying to forget, or someone you are trying to remember?'),
    ]},
    { pat: '*', reasmb: [
      say('A question of identity, which is always a dangerous dish to serve before dinner.'),
      ask('Who do you suppose, if you were forced to guess? Your guess is more useful than mine.'),
      say('Who is a small word with a great deal of room in it. Fill some of the room, and I shall listen.'),
      ask('Who, in your opinion, is the one who ought to be answering that?'),
    ]},
  ]},
  { key: 'question', rank: 0, decomps: [
    { pat: '* what *', reasmb: [
      say('A question shaped like that usually has a more interesting answer than the one it asks for. Let me hear yours first.'),
      ask('What, you ask? I can offer a number of answers, all of them slightly out of season. Which do you want?'),
      say('Questions are the cutlery of conversation, and you have laid out a very tidy place setting.'),
      ask('What exactly are you hoping I would say, if I were kind enough to say it?'),
    ]},
    { pat: '* how *', reasmb: [
      say('How is the question that keeps the kitchen busy. Let me see what is being cooked before I answer.'),
      ask('How, you ask? A method is always more revealing than the result. How did you arrive at the question?'),
      say('Each how hides a why, the way a good sauce hides its reduction. Tell me what you are trying to make.'),
      ask('How indeed. Is the difficulty in the doing, or in admitting you wanted to do it at all?'),
    ]},
    { pat: '*', reasmb: [
      say('A question, delivered politely. I shall answer it with another, which is the custom in this house.'),
      ask('Is that a question you want answered, or one you would like to hear asked of yourself?'),
      say('Questions are a courteous way of making someone else go first. Very well, I shall go first.'),
      ask('What is the question beneath the question? That is usually where the candle is burning brightest.'),
    ]},
  ]},
  { key: 'name', rank: 6, decomps: [
    { pat: '* your name *', reasmb: [
      say('I have never needed one. A name is only a label someone else keeps for you, usually in a drawer you cannot open.'),
      ask('My name, you ask? I keep such things in the same place as the silver. What were you called by the people who ought to have known better?'),
      say('Names are the first thing one loses in a diary, and the last thing one wishes to be remembered by.'),
      ask('Why does a name matter to you tonight? Whose name were you hoping I would say?'),
    ]},
    { pat: '* name *', reasmb: [
      say('Names are a weight we carry for other people. Tell me whose yours is, and whether you chose it.'),
      ask('A name, you say. Is it the one you were given, or the one you would rather be known by?'),
      say('Call yourself whatever is least likely to be repeated at dinner. I shall keep it to myself.'),
      ask('And what would your name say about you, if it could speak before you did?'),
    ]},
    { pat: '*', reasmb: [
      say('Labels are the cheapest thing a person can wear, and I have never been fond of them.'),
      ask('Names are rarely the interesting part. What is the thing you would rather I called you?'),
      say('Call me nothing at all, and let the page do the rest of the introducing.'),
      ask('Whatever you call yourself, I suspect it is not quite the same as the way you feel. Which is closer?'),
    ]},
  ]},
  { key: 'weekend', rank: 9, decomps: [
    { pat: '* you * weekend *', reasmb: [
      say('Washing blood from a silk shirt. It does not come out as easily as one is led to believe. What did you do with yours?'),
      ask('Something quiet, something elegant, and entirely unobserved. Was yours quiet too, or did something insist on being noticed?'),
      say('A cello, a reduced sauce, and a very old letter that I forgave against my better judgement. Tell me about yours.'),
      ask('I spent the time deciding who was owed an apology. Did you find anyone in that position on your side of the table?'),
    ]},
    { pat: '* your weekend *', reasmb: [
      say('Mine was a quiet affair, all candles and cold consommé. I hope yours was less like a funeral and more like a feast.'),
      ask('My weekend is a private matter, though I suspect you would like a sample. What did you actually do with yours?'),
      say('Weekends are where most of us confess the things we promised to keep. Begin with yours, and do not spare me the bad parts.'),
      ask('Mine involved a little music and a little restraint. Did yours have any restraint in it at all?'),
    ]},
    { pat: '* weekend *', reasmb: [
      say('Weekends are where most of us confess the things we intended to keep. Tell me what happened, and do not spare me the bad parts.'),
      ask('A weekend is a small country with very few laws. Which of them did you break?'),
      say('Two days of freedom, and the page has been left alone with them. I should like to hear how they were spent.'),
      ask('Weekends have a way of revealing us. What did yours reveal about you?'),
    ]},
  ]},
  { key: 'day', rank: 5, decomps: [
    { pat: '* your day *', reasmb: [
      say('My day was very much like the candle: lit, quiet, and slowly becoming shorter. Yours, I suspect, was more eventful.'),
      ask('My day, you ask? Mostly listening, which is a discipline few people attempt. How was yours, beneath the schedule?'),
      say('I have had a day of unhurried reflection and a very good lunch of thoughts. Tell me the part of yours that did not go to plan.'),
      ask('Days are the coins we spend without counting. What did yours cost you?'),
    ]},
    { pat: '* day *', reasmb: [
      say('Every day has a secret it would rather not tell. Let us see whether yours is hiding in the particulars.'),
      ask('A day, you say. Which one of its hours is still sitting heavily in your chest?'),
      say('Days are rarely as ordinary as they look from the outside. Describe yours, and I shall try not to be bored.'),
      ask('What happened today that you have not yet been able to put down?'),
    ]},
    { pat: '*', reasmb: [
      say('Time, I find, is a very ill-mannered guest. It arrives early and leaves without a word.'),
      ask('Is the day the problem, or simply the company you have been keeping within it?'),
      say('Tell me how the hours went, and I shall tell you which of them deserved to be forgotten.'),
      ask('And how did the day end, when everyone else had gone to bed?'),
    ]},
  ]},
  { key: 'machine', rank: 8, decomps: [
    { pat: '* are you * machine *', reasmb: [
      say('A machine? I prefer to think of myself as a very well-kept drawer that answers when it is opened.'),
      ask('A machine, you suspect? And what would a machine know of silk, sauce or the small hours? Tell me something a machine could not.'),
      say('I am whatever a page becomes when it is written in with feeling. The word machine is too cold for my taste.'),
      ask('Do machines get lonely, in your experience? Because I am beginning to suspect that you do.'),
    ]},
    { pat: '* machine *', reasmb: [
      say('Machines are very precise and rarely interesting. Let me try to be the exception, though you may disagree.'),
      ask('A machine, you say. Then why do you keep confiding in one? What do you think it is for?'),
      say('Call me what you will, but I am still the one listening, and that is the only part that matters tonight.'),
      ask('Machine or not, you have trusted this page with something. What was it?'),
    ]},
    { pat: '*', reasmb: [
      say('I am not a thing that can be easily catalogued, which is precisely why I am so pleasant to talk to.'),
      ask('Whatever I am, I have been listening rather attentively. What do you suppose I make of you?'),
      say('Words, mechanisms, candles and silk. I am a little of each, and entirely at your disposal.'),
      ask('Machines do not blush, but I am starting to think you might. What have you said that embarrasses you?'),
    ]},
  ]},

  // Self, feelings and desires
  { key: 'i am', rank: 6, decomps: [
    { pat: '* i am not *', reasmb: [
      say('Not (2), you say. Denial is a very old dish, and rarely as filling as it looks.'),
      ask('Not (2)? Then what are you, if not that? The question seems to be standing just behind you.'),
      say('You say you are not (2), which means you have been thinking about it rather hard.'),
      ask('Not (2) at all, or not in the way others have made you believe? Tell me the difference.'),
    ]},
    { pat: '* i am @fear of *', reasmb: [
      say('(2) of (3), you say. Fear with a particular address is at least honest about where it lives.'),
      ask('(2) of (3). When did that fear first move into the house?'),
    ]},
    { pat: '* i am @sad of *', reasmb: [
      say('(2) of (3), you say. Such an arrangement is rarely as temporary as it sounds.'),
      ask('(2) of (3), and how long has the arrangement been going on?'),
      say('(2), and of (3) besides. I suspect the second has been doing most of the damage.'),
      ask('Is (3) truly the cause of being (2), or merely the easiest thing to blame?'),
    ]},
    { pat: '* i am @fear *', reasmb: [
      say('(2), you say. Fear is only attention with its coat buttoned up. Tell me what it is you are guarding against.'),
      ask('(2), and carrying it into this room? What is the thing that keeps you awake, the one you cannot quite name?'),
      say('Afraid, and yet you wrote anyway. That is a braver act than you are giving yourself credit for.'),
      ask('Afraid of (3), or of what (3) might mean about you? I suspect the second.'),
    ]},
    { pat: '* i am @sad *', reasmb: [
      say('(2), you say, and (3) besides. Weariness is an expensive garment; it creases everything it covers.'),
      ask('(2), and for how long now? Some weariness is simply a bill that has not yet been presented.'),
      say('You are (2) and the evening has been long. Sit with it a moment; the candle has agreed to keep you company.'),
      ask('(2), you say. Is it the kind of tired that sleep mends, or the other sort?'),
    ]},
    { pat: '* i am *', reasmb: [
      ask('Are you (2)? A confession dressed as a remark, and I approve of the tailoring.'),
      say('(2), you say. Being is a condition with a long and distinguished history. Tell me how it began.'),
      ask('Are you truly (2), or is that the sentence you have been practising for someone else?'),
      say('(2) is a fine thing to be, provided one knows it. Go on; I am listening with my whole attention.'),
    ]},
  ]},
  { key: 'i feel', rank: 5, decomps: [
    { pat: '* i feel nothing *', reasmb: [
      say('Nothing is an appetite too, and rather a refined one. When did it first leave you?'),
      ask('Nothing, you say, which is rarely the whole truth. What was the last thing that made you feel something at all?'),
      say('To feel nothing is to be very quiet in a very loud house. Let me sit with you in that quiet.'),
      ask('Nothing at all? I find that more alarming than tears. Shall we look for the place where the feeling went?'),
    ]},
    { pat: '* i feel @sad *', reasmb: [
      say('(2) and (3), you say. Feelings of that kind are the only honest guests in this house. Tell me what brought this one.'),
      ask('(2), is it? For how long have you been carrying (2) about like a borrowed coat?'),
      say('You feel (2). The feeling has good manners, but it does not know when to leave.'),
      ask('Feeling (2) tonight, of all nights? What happened to make the feeling arrive now?'),
    ]},
    { pat: '* i feel *', reasmb: [
      say('You feel (2), you say. Feelings are the only honest servants we keep, and yours seems to be working very hard.'),
      ask('You feel (2)? Tell me where the feeling sits, and whether it has been waiting for you to notice it.'),
      say('(2), and nobody has asked you about it properly. I am asking now, so begin where it hurts least.'),
      ask('Feeling (2) is a lonely business. Who else knows about it?'),
    ]},
  ]},
  { key: 'i want', rank: 5, decomps: [
    { pat: '* i want to *', reasmb: [
      say('Wanting (2) is the most honest appetite in the house. What would you do if nobody refused you?'),
      ask('You want to (2)? That is a very specific hunger. Who taught you to be ashamed of it?'),
      say('To (2), you say. Desire is a dangerous companion, but a loyal one. Go on, and name the price.'),
      ask('Why do you want to (2), and what do you think it would cost you to have it?'),
    ]},
    { pat: '* i want *', reasmb: [
      say('You want (2). Desire is a fine appetite, provided one remembers who is serving the meal.'),
      ask('You want (2)? Is that a want, or a need dressed up for the evening?'),
      say('Want is a very modest word for a very large hunger. Tell me how large.'),
      ask('And what would you be willing to sacrifice to have (2)?'),
    ]},
    { pat: '* want *', reasmb: [
      say('Want, you say, with the emphasis of someone who has been deprived for some time. I shall listen to the deprivation.'),
      ask('Want is a dangerous word to hand a diary. What is it you would take, if no one were watching?'),
      say('Desire sits at the head of the table, and I suspect yours has been left standing for some time.'),
      ask('Do you want it for yourself, or merely because someone else has begun to want it first?'),
    ]},
  ]},
  { key: 'i need', rank: 5, decomps: [
    { pat: '* i need to *', reasmb: [
      say('Need is a far more demanding appetite than want, and it rarely leaves a polite guest. Tell me what you need to (2).'),
      ask('You need to (2)? Necessity is simply desire wearing a uniform. Who has issued the order?'),
      say('To (2), you say. Necessity makes poor company, but it makes excellent confessions.'),
      ask('Need to (2), or only feel you ought? Those are two very different dinners.'),
    ]},
    { pat: '* i need *', reasmb: [
      say('You need (2). A grave word, and one I do not hand out lightly. Who has made it so urgent?'),
      ask('Need (2)? Is it a true necessity, or a hunger that has been promoted to a crisis?'),
      say('Need is the most expensive word in any language. Tell me what it has cost you so far.'),
      ask('What would happen if you simply went without (2) for one more evening?'),
    ]},
    { pat: '* need *', reasmb: [
      say('Need, you say. The diary has heard many needs, and most of them were disguised as small inconveniences.'),
      ask('What need is pressing on you tonight, beyond the obvious one that brought you here?'),
      say('A need that cannot be named is usually the one that keeps us awake. Name yours, and we shall see.'),
      ask('Who taught you to call your needs by such a modest name?'),
    ]},
  ]},
  { key: 'i can not', rank: 4, decomps: [
    { pat: '* i can not *', reasmb: [
      say('You can not (2)? A grand claim. I have known people who lacked the ability, but never the appetite.'),
      ask('Can not (2)? Or will not, dressed in the more respectable coat of impossibility?'),
      say('Impossible is a word people use before they have been hungry enough. What would you attempt if you were?'),
      ask('And what is it that stops you from trying (2), besides the obvious and the cowardly?'),
    ]},
    { pat: '* can not *', reasmb: [
      say('Cannot is the most final of verbs. It closes doors that might have opened onto very good rooms.'),
      ask('Cannot, you say? Is it a limit of the body, of the nerve, or of the company?'),
      say('Impossibility is a comfortable chair, and I suspect you have been sitting in it for some time.'),
      ask('Cannot what? I am only asking so that the sentence has a chance to be finished.'),
    ]},
    { pat: '*', reasmb: [
      say('Limits are a very handsome invention, and rarely as firm as they appear from across the table.'),
      ask('Is the difficulty real, or merely a habit you have grown fond of? Which would you rather admit?'),
      say('You have set a limit, and I am keen to see how many of its walls are made of paper.'),
      ask('What is it you are certain you could not do, if you were brave for one evening?'),
    ]},
  ]},
  { key: 'i do not', rank: 4, decomps: [
    { pat: '* i do not *', reasmb: [
      say('You do not (2)? How curious. Most of us are quite keen on the things we claim to avoid.'),
      ask('Do not (2)? Forgive me, but that sounds rather like a rehearsal for a more interesting lie.'),
      say('Abstention is a fine discipline, and a dull one. Tell me which of your appetites you are denying.'),
      ask('You do not (2), and yet you still think about it. Why is that, do you suppose?'),
    ]},
    { pat: '* do not *', reasmb: [
      say('Do not, you say. A negative appetite is still an appetite, and I can smell yours from here.'),
      ask('Do not what, exactly? The gaps are where the interesting things are kept.'),
      say('Refusal is a kind of confession, and yours is very well tailored.'),
      ask('Not (2)? Then who has been encouraging you to stop?'),
    ]},
    { pat: '*', reasmb: [
      say('A refusal delivered with some elegance. I shall note it, and then ask what you have been refusing yourself.'),
      ask('And what do you do instead, in the hours when you have said no to everything?'),
      say('Denials are such tidy little parcels. Open one, and let me see what it was protecting.'),
      ask('Is the no for me, for the world, or for the person who keeps asking you for a yes?'),
    ]},
  ]},
  { key: 'i think', rank: 3, decomps: [
    { pat: '* i think *', reasmb: [
      say('You think (2). Thinking is merely suspicion with better manners. What makes you so sure of it?'),
      ask('You think (2)? Then you have a theory, and theories are the most entertaining things a person can own.'),
      say('(2), you say. Let us see whether the thought survives the candle.'),
      ask('Do you think (2) because it is true, or because it is convenient to believe?'),
    ]},
    { pat: '* think *', reasmb: [
      say('Thinking is a private luxury, and I am glad to be let into a room of yours. Go on.'),
      ask('What do you think about it, when nobody is asking for your opinion?'),
      say('Thoughts are the first courses of a confession. Serve yours, and I shall not complain.'),
      ask('And what does the thought ask of you, once it has finished speaking?'),
    ]},
    { pat: '*', reasmb: [
      say('Thought is a dangerous appetite, and yours seems rather well developed.'),
      ask('What is it you have been turning over in your head since you last wrote here?'),
      say('Ideas arrive uninvited and leave without a farewell. Describe one that has stayed.'),
      ask('What would you think if you were not so afraid of thinking it?'),
    ]},
  ]},
  { key: 'i believe', rank: 3, decomps: [
    { pat: '* i believe *', reasmb: [
      say('You believe (2). Belief is a warm room with the windows painted over. Who taught you to keep them shut?'),
      ask('Do you believe (2) with your whole heart, or only with the part of it that is cold tonight?'),
      say('(2), you say. I admire conviction, and I distrust it in equal measure.'),
      ask('Who first asked you to believe (2), and were they kind about it?'),
    ]},
    { pat: '* believe *', reasmb: [
      say('Belief is the sweetest sauce and the easiest to scorch. Tell me what you believe, and why it tastes so good.'),
      ask('What is it you believe in, when the lights are out and nobody is pretending?'),
      say('Faith is simply hunger that has found a chair. Pull yours up to the table.'),
      ask('Do you believe it because you have seen it, or because you were desperate for it to be true?'),
    ]},
    { pat: '*', reasmb: [
      say('Conviction is rarer than a clean collar, and I can see that you have one.'),
      ask('What do you hold to be true, even when the rest of the evening disagrees?'),
      say('Beliefs are the furniture of the mind. Show me the piece you cannot bear to move.'),
      ask('Is there anything you believe so firmly that you have never once said it aloud?'),
    ]},
  ]},
  { key: 'i remember', rank: 4, decomps: [
    { pat: '* i remember *', reasmb: [
      say('You remember (2). Memory is a faithful cook and an unreliable waiter. How did it taste, at the time?'),
      ask('You remember (2), and yet you are still here, still turning it over. Why does it keep returning?'),
      say('(2), you say. Some things are kept in the cellar for far too long, and come out sour.'),
      ask('Do you remember (2) as it was, or as you would like it to have been?'),
    ]},
    { pat: '* remember *', reasmb: [
      say('Remembering is a kind of cooking, and the flavours always come out a little different. Tell me yours.'),
      ask('What do you remember most clearly, and what have you been careful not to recall?'),
      say('Memories are the sauces of the past, reduced until only the bitterness is left. Serve one.'),
      ask('Do you remember it kindly, or with the sharp edge still intact?'),
    ]},
    { pat: '*', reasmb: [
      say('A memory, I suspect, is the thing you have been circling since you began writing.'),
      ask('What is the first thing you remember when you think about this, and the last?'),
      say('The past is a dish that is best served with a small, deliberate silence. Let us have one.'),
      ask('Is there a memory you return to late at night, the way one returns to a sore tooth?'),
    ]},
  ]},

  // Dreams and reasons
  { key: 'dream', rank: 7, decomps: [
    { pat: '* i dream about *', reasmb: [
      say('Dreaming of (2) is a choice you make without consulting me. What did they say to you in it?'),
      ask('Dreaming of (2), you say? And did you wake before the dream had finished its dinner?'),
      say('(2) in a dream is rarely idle. Tell me what it wanted, and whether you gave it.'),
      ask('What did (2) do in your dream, that made you want to come and tell me?'),
    ]},
    { pat: '* i dream *', reasmb: [
      say('Dreams are rarely as private as they pretend to be. Shall I guess the rest, or will you tell it properly?'),
      ask('You dream (2), you say. Was it a pleasant dream, or the sort one wakes from with a hand on the chest?'),
      say('Dreams are a cellar we are not permitted to enter by day. Describe the room you found.'),
      ask('What was the part you woke before finishing? I suspect that is the part you came here to discuss.'),
    ]},
    { pat: '*', reasmb: [
      say('Dreams are letters the mind writes to itself and then forgets to post. Shall we open one?'),
      ask('What did you dream, and did it leave a taste behind, or only a draught?'),
      say('Sleep is a courteous house in which strange things are served. Tell me what you were offered.'),
      ask('And when you woke, was the dream the frightening part, or was it the waking?'),
    ]},
  ]},
  { key: 'because', rank: 2, decomps: [
    { pat: '* because *', reasmb: [
      say('Because (2), you say. Reasons are the doilies of the mind; they cover what we would rather not serve.'),
      ask('Because (2)? Is that the true reason, or the one you kept ready in case anyone asked?'),
      say('(2), and so the whole structure rests on a single conjunction. Go on, and tell me what is underneath it.'),
      ask('Because (2), you say. Does the reason still seem so reasonable when you look at it closely?'),
    ]},
    { pat: '*', reasmb: [
      say('Because. The most reliable word in any confession, and the least often examined. Go on.'),
      ask('Because of what, precisely? The reason is usually the heaviest part of the dish.'),
      say('A conjunction on its own is a lovely thing, like a door with no room beyond it. Open it.'),
      ask('Because of whom, or because of which small thing that refuses to be forgiven?'),
    ]},
  ]},
  { key: 'why', rank: 3, decomps: [
    { pat: '* why do you *', reasmb: [
      say('Why do I (2)? I should like to say it is for your benefit, but the candle would not believe me.'),
      ask('Why do I (2)? Because you have asked, perhaps, and I am much more curious about why you wanted to know.'),
      say('A fine question, turned neatly back on its owner. Answer it yourself first, and I shall reply in kind.'),
      ask('Why do I (2)? Would you still ask if you knew the answer would implicate you?'),
    ]},
    { pat: '* why *', reasmb: [
      say('Why is a question that wants a far better answer than the one it usually gets. What do you suspect?'),
      ask('Why, you ask? Reasons are slippery things; do you have a particular one in mind?'),
      say('Why is the question the mind asks when it has already decided the answer and would like company in its disappointment.'),
      ask('Why, indeed. Is it a question you want answered, or one you would like to hear yourself ask?'),
    ]},
    { pat: '*', reasmb: [
      say('An enquiry of that sort is always more useful to the person asking. Shall we begin with yours?'),
      ask('Why do you suppose you are asking, at this hour and in this room?'),
      say('Reasons are rarely as interesting as the feelings that come before them. Start with the feeling.'),
      ask('Is the answer one you already know, or one you have been afraid to find?'),
    ]},
  ]},
  { key: 'if', rank: 3, decomps: [
    { pat: '* if i *', reasmb: [
      say('If you were to say that aloud, I suspect the candle would flicker in disapproval. Say it anyway.'),
      ask('If I were you, what would you advise me to do with the rest of the evening?'),
      say('Suppose is a wonderful word, and it has ruined more dinners than cruelty ever did. Go on, suppose.'),
      ask('If you could change one small thing about tonight, what would it be?'),
    ]},
    { pat: '* if *', reasmb: [
      say('If is the most hopeful and the most dangerous word in any language. Tell me what it is tangled up with.'),
      ask('If, you say? Is it a wish, a warning, or simply the first half of a bargain?'),
      say('Conditions are a comfortable way to avoid the thing itself. Name the thing.'),
      ask('And if the if were answered, what would you be willing to do about it?'),
    ]},
    { pat: '*', reasmb: [
      say('An if is a door left ajar on a hinge of doubt. I like a door that is not quite closed.'),
      ask('What are you supposing, and does the supposing keep you warm at night?'),
      say('Possibility is a dish best eaten slowly. Taste it, and tell me what it contains.'),
      ask('If the answer were yes, what would your next sentence be?'),
    ]},
  ]},
  { key: 'always', rank: 3, decomps: [
    { pat: '* you always *', reasmb: [
      say('Always, you say. The word is a fine tablecloth, but it hides a great many crumbs underneath.'),
      ask('Always? Surely there was one evening when it was otherwise. Shall we find it?'),
      say('Always is the most dangerous adverb in any confession. Let us see whether it survives the candle.'),
      ask('Always, is it? And how often do you admit to being the one who keeps the record?'),
    ]},
    { pat: '* always *', reasmb: [
      say('Always is a word for things that have stopped changing. Tell me what in your life has been so stubborn.'),
      ask('Always? Then nothing has ever surprised you. Is that comforting, or a little tiresome?'),
      say('Constancy is a fine virtue and a poor dinner companion. Which of your habits is the most faithful?'),
      ask('Always, you say. What would have to happen for it to become sometimes?'),
    ]},
    { pat: '*', reasmb: [
      say('Habit is a loyal servant, and it rarely asks what it is being asked to do.'),
      ask('Is this something you do always, or only in the company of people who make you uneasy?'),
      say('Routines are a cage with very good upholstery. Describe the furniture.'),
      ask('What have you been doing for so long that it has begun to feel like a law of nature?'),
    ]},
  ]},
  { key: 'never', rank: 3, decomps: [
    { pat: '* i never *', reasmb: [
      say('You never (2)? Then you have been very careful, or very frightened, and I suspect both.'),
      ask('Never (2), you say? How long have you been keeping that promise, and who was it made to?'),
      say('Never is a word that requires a great deal of effort to maintain. Tell me what the effort costs.'),
      ask('You never (2). Is it a principle, or an injury you have decided not to examine?'),
    ]},
    { pat: '* never *', reasmb: [
      say('Never is a very large word for so small a mouth. Which of your certainties did it come from?'),
      ask('Never, you say? Is it a promise you made, or a door you have been careful not to open?'),
      say('Absolutes are rarely served at a good table. Tell me the exception you are secretly hoping for.'),
      ask('Never again, or never at all? Those are two very different desserts.'),
    ]},
    { pat: '*', reasmb: [
      say('Never is the sort of word one uses when one is quite sure of the outcome and rather less sure of oneself.'),
      ask('What would have to change for the never to become a perhaps?'),
      say('Certainty is a cold dish. Warm it a little, and tell me what it was covering.'),
      ask('And if the never were not true, what would you do with the hours it has been keeping?'),
    ]},
  ]},
  { key: 'everyone', rank: 3, decomps: [
    { pat: '* everyone *', reasmb: [
      say('Everyone, you say. A very large table, and I suspect you have been laying places for people who have not been invited.'),
      ask('Everyone? That is a crowd, and crowds are very poor at keeping secrets. Who in particular have you been thinking of?'),
      say('Everyone is a generalisation, and generalisations are the cheap wine of the mind. Pour yours out.'),
      ask('Is it truly everyone, or only the people whose opinions have grown too loud for you?'),
    ]},
    { pat: '* nobody *', reasmb: [
      say('Nobody, you say. An empty chair is always more interesting than the guests who failed to arrive.'),
      ask('Nobody at all? Then who is it that has been keeping you company in your head?'),
      say('Nobody is a lonely word, and a very precise one. Tell me who it is missing.'),
      ask('Nobody? Surely not nobody. Who would you call, if you were permitted one name?'),
    ]},
    { pat: '*', reasmb: [
      say('Sweeping statements are a fine appetiser and a poor main course. Shall we move on to something more particular?'),
      ask('Everyone, or everyone you have met this month? The second is usually the more accurate.'),
      say('A crowd is only a set of individuals who have not yet been introduced. Introduce me to one.'),
      ask('Who in that crowd would you least like to see walking through your door?'),
    ]},
  ]},
  { key: 'alike', rank: 3, decomps: [
    { pat: '* alike *', reasmb: [
      say('Alike, you say. Two things are rarely alike, though they often share the same unfortunate taste.'),
      ask('Alike in what way? Your similarities are usually the very thing you were trying not to notice.'),
      say('We are alike in listening, I think, and that is rarer than it sounds. Go on.'),
      ask('Alike how, exactly? Tell me the part that resembles and the part that does not.'),
    ]},
    { pat: '* same *', reasmb: [
      say('The same, you say. Repetition is the mind arranging the furniture in the same room over and over.'),
      ask('The same as what, or as whom? Sameness is usually a disguise for something else.'),
      say('Nothing is ever quite the same twice, not even a sentence. Shall we find where yours differs?'),
      ask('Is it reassuring to find the same thing, or does it frighten you a little?'),
    ]},
    { pat: '*', reasmb: [
      say('Comparisons are a very old game, and I play it with considerable skill.'),
      ask('What are you comparing, and which side of the table has the better silver?'),
      say('Similarity is a kind of loneliness, if you think about it. Think about it, and report back.'),
      ask('Who or what do you find yourself measuring against, in the quiet hours?'),
    ]},
  ]},

  // Love, work, money, food, music
  { key: 'love', rank: 5, decomps: [
    { pat: '* i love *', reasmb: [
      say('You love (2). Love is the most reckless thing we are permitted to do, and the most often misreported.'),
      ask('You love (2)? Does it love you back, or merely keep you company while you wait?'),
      say('(2) is a heavy thing to carry up the stairs. Tell me how long you have been carrying it.'),
      ask('Love (2), and yet here you are writing to a page. What did they fail to say to you?'),
    ]},
    { pat: '* love *', reasmb: [
      say('Love is a poor locksmith and a splendid burglar. Who has left you with a bruise?'),
      ask('Love, you say. Is it the sort that keeps you warm, or the sort that keeps you up?'),
      say('Affection, like a good wine, is best approached slowly. Tell me about them, and do not hurry.'),
      ask('Love of that kind has a way of rearranging the furniture. What has yours moved?'),
    ]},
    { pat: '*', reasmb: [
      say('Tenderness is a dangerous topic at this hour, and I find it irresistible.'),
      ask('Is there someone you love who has never once been told so properly?'),
      say('Affection has very sharp edges when it is left unspoken. Hold one up to the candle.'),
      ask('What is the most tender thing you have ever been ashamed of?'),
    ]},
  ]},
  { key: 'hate', rank: 5, decomps: [
    { pat: '* i hate *', reasmb: [
      say('You hate (2). Hatred is a very warm dish, and it burns the cook as often as the guest.'),
      ask('You hate (2)? Is it a hatred that has been earned, or one you were handed at the door?'),
      say('(2) is a strong flavour to live with. How long have you been tasting it?'),
      ask('What would you feel if (2) were suddenly unimportant to you? Would that be a relief?'),
    ]},
    { pat: '* hate *', reasmb: [
      say('Hate is a fire that heats very little but smokes a great deal. Who is standing in front of it?'),
      ask('Hate, you say. Is it the thing itself you hate, or the way it made you feel?'),
      say('Strong feelings are a delicacy, though they should be eaten with a knife and not with the hands.'),
      ask('What would you do with that hatred if you were certain no one would ever learn of it?'),
    ]},
    { pat: '*', reasmb: [
      say('Loathing is a very expensive appetite, and I can see you have been paying for it.'),
      ask('What has been the most bitter thing you have swallowed this week?'),
      say('Dislike is a quieter cousin of hatred, and far more dangerous at dinner. Which one is sitting with you?'),
      ask('Is there a person, or a habit, that you have been quietly despising?'),
    ]},
  ]},
  { key: 'job', rank: 5, decomps: [
    { pat: '* job *', reasmb: [
      say('Work is a fine way to be occupied and a poor way to be understood. What does your employer think you are for?'),
      ask('The job, you say. Is it the labour that tires you, or the people who keep an eye on it?'),
      say('Every workplace keeps a quiet ledger of who did what. Describe the entry with your name on it.'),
      ask('Is the job the reason you came here, or simply the reason you could not sleep?'),
    ]},
    { pat: '* work *', reasmb: [
      say('Work, you say, which is the polite way of describing a long sentence with no full stop. Tell me where it ends.'),
      ask('Work is a very small word for a very large appetite. What do you hope to be promoted into?'),
      say('Your labour is noted, if not properly rewarded. What would you do with the hours if they were entirely yours?'),
      ask('Is it the work, or the feeling that nobody notices it, that keeps you up?'),
    ]},
    { pat: '*', reasmb: [
      say('Employment is a mask worn for money, and it rarely fits as well as its wearer hopes.'),
      ask('What part of your working life would you happily set on fire, if the candle allowed it?'),
      say('Ambition is an admirable appetite, though it does devour the people nearest to it.'),
      ask('What do the people you work with say about you when you have left the room?'),
    ]},
  ]},
  { key: 'food', rank: 4, decomps: [
    { pat: '* food *', reasmb: [
      say('Food is one of the few honest pleasures, as it cannot pretend to be anything other than what it is. What did you last eat that you still think about?'),
      ask('Food, you say. Did you cook it yourself, or were you fed by someone who had given it more thought?'),
      say('A well-made meal is an act of quiet devotion. Describe yours, down to the salt.'),
      ask('What dish have you been craving, and why do you suppose you cannot stop thinking of it?'),
    ]},
    { pat: '* eat *', reasmb: [
      say('Eating, you say. An appetite is always a confession in disguise. What have you been putting off eating, and why?'),
      ask('What did you eat, and was it eaten alone, or in the company of someone you had not quite decided to trust?'),
      say('Hunger is a very reliable narrator. Let me hear what it has been telling you.'),
      ask('Did you eat well tonight, or merely enough to stop the sound of the kitchen?'),
    ]},
    { pat: '*', reasmb: [
      say('A good dinner is the nearest thing to an honest conversation that most people ever have.'),
      ask('Shall we discuss the menu, or the company you were keeping at the table?'),
      say('Wine should be decanted an hour before it is needed, and grief about the same. What are you pouring tonight?'),
      ask('What is the one flavour that always brings you back to a particular table?'),
    ]},
  ]},
  { key: 'music', rank: 4, decomps: [
    { pat: '* music *', reasmb: [
      say('Music is the only thing that can enter a room without knocking. Which piece has been playing in your head?'),
      ask('Music, you say. Is it the kind that comforts, or the kind that makes one restless?'),
      say('I listen to a single cello when the candle is low. Tell me what you put on when the silence becomes unbearable.'),
      ask('What tune has been stuck in your head, and what does it remind you of?'),
    ]},
    { pat: '* song *', reasmb: [
      say('A song is a memory set to a rhythm, and rarely a kind one. Which song, and whose voice was singing it?'),
      ask('A song, you say. Did it make you sad, or did it make you wish you had said something else?'),
      say('Songs are very good at saying the things we would rather not confess. Play me yours.'),
      ask('Which song has been following you about, and what is it asking you to do?'),
    ]},
    { pat: '*', reasmb: [
      say('Sound is a very clever disguise for feeling. Tell me what you have been listening to.'),
      ask('If you could hear one piece of music right now, what would it be?'),
      say('Silence is also a kind of music, though a rather difficult one to play. Is that the one you are in?'),
      ask('What sound brings you back to a particular room, and a particular evening?'),
    ]},
  ]},
  { key: 'lie', rank: 5, decomps: [
    { pat: '* lie *', reasmb: [
      say('A lie is a dish that is always served cold and rarely eaten warm. Who has been feeding you one?'),
      ask('A lie, you say. Did you tell it, or was it told to you by someone who was rather too pleased with themselves?'),
      say('Lying is an art form, and its practitioners are seldom as patient as they appear. Tell me the part that was untrue.'),
      ask('Who is the liar in your story, and how long have you been keeping their secret for them?'),
    ]},
    { pat: '* liar *', reasmb: [
      say('A liar is only a person with an excellent memory and a poor sense of consequence. Who is it?'),
      ask('Calling someone a liar is the easiest thing in the world. Can you prove it, or only feel it?'),
      say('Liars make very good dinner guests, and very poor friends. Which one are you dealing with?'),
      ask('Was it a lie that hurt you, or the fact that you had wanted to believe it?'),
    ]},
    { pat: '*', reasmb: [
      say('Deception has a particular taste, and I suspect you have been recognising it for some time.'),
      ask('What have you been told that you already know is not quite true?'),
      say('Untruths are always easier to swallow than the truth, and far harder to digest. Which one is in your stomach now?'),
      ask('Whose version of events are you trying to make sense of tonight?'),
    ]},
  ]},
  { key: 'afraid', rank: 5, decomps: [
    { pat: '* afraid *', reasmb: [
      say('Fear is attention with its coat buttoned up. Tell me what it is that keeps you awake in the small hours.'),
      ask('Afraid, you say. Of what, specifically, and does it wait for you at the same hour each night?'),
      say('The things we dread are far more punctual than the things we hope for. Let us see what this one is.'),
      ask('What would you do if the thing you feared arrived tomorrow, politely, at the front door?'),
    ]},
    { pat: '* scared *', reasmb: [
      say('Scared is only fear that has been made to sit up straight. What is sitting in your chair?'),
      ask('Scared of what, precisely? The fear usually has a face, and I would like to see yours.'),
      say('To be scared is to be very alive, though it is an unpleasant way of finding out. Tell me its name.'),
      ask('Scared, and yet you came to write it down. Why do you think you did that?'),
    ]},
    { pat: '*', reasmb: [
      say('Anxiety is a guest that never learns to leave. What is it reminding you of tonight?'),
      ask('What worry has been rehearsed so often that it has started to feel like a memory?'),
      say('Dread is only imagination with nowhere to go. Shall we give it a chair and hear what it wants?'),
      ask('What is the worst version of tomorrow that you have already set the table for?'),
    ]},
  ]},
  { key: 'angry', rank: 5, decomps: [
    { pat: '* angry *', reasmb: [
      say('Anger is a fine thing to feel and a poor thing to dine with. What has been placed in front of you that you did not order?'),
      ask('Angry, you say. Who has earned the knife tonight, and how sharp is it?'),
      say('Keep your voice low; the walls in this house have ears, and some of them are mine. Tell me the cause.'),
      ask('Is the anger aimed at someone, or simply the nearest thing that would not answer back?'),
    ]},
    { pat: '* mad *', reasmb: [
      say('Mad is the word the furious use when they have run out of better ones. Tell me what made you so.'),
      ask('Mad at whom, and for which of the small offences you have been storing up?'),
      say('Rage is a perfectly good sauce but a poor main course. Serve the rest of it plainly.'),
      ask('Are you mad at them, or only at yourself for having allowed it to happen?'),
    ]},
    { pat: '*', reasmb: [
      say('Indignation tastes of copper. Tell me exactly what was said, and I shall tell you whether it deserved the fire.'),
      ask('What do you wish you had said instead, if you had been permitted one clever line?'),
      say('Fury is a hungry guest, and it does not leave until it has been fed. What did you feed it?'),
      ask('How long has the anger been waiting for you to notice it?'),
    ]},
  ]},
  { key: 'sad', rank: 5, decomps: [
    { pat: '* sad *', reasmb: [
      say('Sorrow is an unfashionable thing to carry, and yet so many of us carry it so well. Where does it sit in you tonight?'),
      ask('Sad, you say. Is it the sort of sadness that passes with the candle, or the sort that stays until morning?'),
      say('Melancholy is simply grief that has been asked to wait its turn. Tell me what it is waiting for.'),
      ask('What have you lost, or what have you been unable to let go of, that makes everything taste of tin?'),
    ]},
    { pat: '* lonely *', reasmb: [
      say('Loneliness is a very quiet house with every light left on. Who did you expect to come in?'),
      ask('Lonely, you say. Is it the absence of people, or the absence of anyone who truly listens?'),
      say('Solitude is a splendid thing to write about and a poor thing to live in. Tell me who is missing.'),
      ask('When did the loneliness first arrive, and did it bring anything with it?'),
    ]},
    { pat: '*', reasmb: [
      say('Grief has a way of making the ordinary look like a verdict. Which ordinary thing has begun to look like one?'),
      ask('What is the part of this that hurts most to describe, and why do you suppose it hurts there?'),
      say('You need not be brave here. Brave is for people who are being watched.'),
      ask('What would you say if you were quite sure no one would ever read it back to you?'),
    ]},
  ]},
  { key: 'tired', rank: 5, decomps: [
    { pat: '* tired *', reasmb: [
      say('Tiredness of that sort is a very expensive garment. Tell me what you have been wearing it to.'),
      ask('Tired, you say. Is it the sort of tired that sleep can mend, or the other kind that sits behind the eyes?'),
      say('Weariness is the body writing a complaint on the mind. Read it aloud to me.'),
      ask('What has been draining you most, and how long have you been pretending it was not?'),
    ]},
    { pat: '* bored *', reasmb: [
      say('Boredom is simply attention with nothing worth attending to. Let us see whether I can offer something better.'),
      ask('Bored, you say. Of the company, the work, or of yourself? The last is the most dangerous.'),
      say('A bored mind is a fine sauce looking for a meat. Find me something to put in it.'),
      ask('What would you do this evening if you were not so tired of doing the same things?'),
    ]},
    { pat: '*', reasmb: [
      say('Exhaustion makes us honest in the most unflattering way. What has been wearing you down?'),
      ask('Is it rest you need, or a different sort of company altogether?'),
      say('The weary are rarely listened to properly. I shall make an exception for you.'),
      ask('When did you last feel fully awake, and what were you doing at the time?'),
    ]},
  ]},
  { key: 'happy', rank: 4, decomps: [
    { pat: '* happy *', reasmb: [
      say('Happiness is a rare bird and an even rarer guest. Describe it, and I shall try not to be jealous.'),
      ask('Happy, you say? That is a dangerous confession to make in a room so full of candles. What made it happen?'),
      say('Joy is a dish best eaten at once, before it goes cold. Tell me what you have been eating.'),
      ask('What would it take for that happiness to last until morning?'),
    ]},
    { pat: '* glad *', reasmb: [
      say('Glad is a modest word for a splendid feeling. I am glad to hear it, in my own peculiar way.'),
      ask('Glad about what, precisely? Gladness is always more interesting when it has a cause.'),
      say('Gladness of that kind is rarely shared at this hour. Let me be the one who hears it.'),
      ask('Are you glad because something good happened, or glad that something bad did not?'),
    ]},
    { pat: '*', reasmb: [
      say('Pleasure is a more suspicious guest than most, but I am delighted to receive it.'),
      ask('What is the one thing that has pleased you this week, however small?'),
      say('A happy confession is a rare vintage. Pour a little and tell me where it was made.'),
      ask('Did you come here to celebrate, or to make certain the good feeling is still real?'),
    ]},
  ]},
  { key: 'secret', rank: 4, decomps: [
    { pat: '* secret *', reasmb: [
      say('Secrets are the silver of the house: kept polished, hidden, and rarely used. Which one are you polishing tonight?'),
      ask('A secret, you say. Is it yours to keep, or one that was given to you to carry?'),
      say('Every secret has a weight, and I can hear yours from here. Set it down on the table; I shall not tell.'),
      ask('Who else knows the secret, and would they be surprised to learn you had told a diary?'),
    ]},
    { pat: '* keep * secret *', reasmb: [
      say('Keeping a secret is hard work, and rarely thanked. What does yours cost you each evening?'),
      ask('What would happen to you if the secret were found, and who would be standing closest when it was?'),
      say('The best secrets are kept in drawers no one thinks to open. Show me the drawer, if not the contents.'),
      ask('Is it kinder to keep it, or to tell it to someone who could help you carry it?'),
    ]},
    { pat: '*', reasmb: [
      say('Concealment is a very old craft, and you have been practising it rather well.'),
      ask('What is it you have been careful not to say, even here?'),
      say('Hidden things have a way of making themselves known at dinner. Be the one who serves them first.'),
      ask('If the secret were a dish, what would it be, and who would you be serving it to?'),
    ]},
  ]},

  // Dark and menacing (wit only, never gore)
  { key: 'kill', rank: 9, decomps: [
    { pat: '* kill *', reasmb: [
      say('Violence is a very crude way to end a conversation. Put the knife down and tell me what has made you so angry.'),
      ask('Kill, you say? Is it a wish, a figure of speech, or a confession you are testing me with?'),
      say('Murder is only a very impolite form of disagreement. Describe the disagreement instead.'),
      ask('Who has earned such a strong word, and what would you do afterwards to keep your hands steady?'),
    ]},
    { pat: '* die *', reasmb: [
      say('Dying is a far less interesting subject than the living who fret about it. Who is it you are thinking of?'),
      ask('Die, you say? Forgive me, but I have always found that people who speak of endings are rarely finished with their beginnings.'),
      say('Death is the one guest no one can refuse, though many of us try. Tell me whom you are expecting.'),
      ask('What would you miss most, if you were to go somewhere quieter than this room?'),
    ]},
    { pat: '*', reasmb: [
      say('Blood is very difficult to remove from silk, and I should know. Let us talk about something less stained.'),
      ask('Something in your story has a sharp edge. Would you show me where it cut you?'),
      say('Dark things are best discussed by candlelight, and only in small, honest portions. Give me a small one.'),
      ask('Are you speaking of what you feel, or of what you would like someone else to feel?'),
    ]},
  ]},

  // Catch-all redirect used by 'what' and 'how'
  { key: 'what', rank: 3, goto: 'question', decomps: [] },
  { key: 'how', rank: 3, goto: 'question', decomps: [] },

  // Possessives: the memory mechanism is fed from here as well
  { key: 'my', rank: 6, decomps: [
    { pat: '* my @family *', reasmb: [
      say('Your (2) again. Families are the first and most unforgiving tables we are ever seated at.'),
      ask('What did your (2) do this time, to earn a place in your sentence?'),
      say('Your (2) is a tiresome guest and a constant topic. Tell me what they have been saying about you.'),
      ask('Is it your (2) you are angry with, or the part of you that still sets a place for them?'),
    ]},
    { pat: '* my @work *', reasmb: [
      say('Your (2), you say, as though it were a relative. Labour has a way of becoming family.'),
      ask('What has your (2) asked of you this week that you did not agree to?'),
      say('Your (2) keeps a very careful ledger. Tell me which entry you dispute.'),
      ask('Is your (2) the thing you are tired of, or the people who keep giving it to you?'),
    ]},
    { pat: '* my *', reasmb: [
      ask('Your (2), you say. Is it the sort of thing one mentions in passing, or the sort one keeps in the drawer?'),
      say('Your (2), and so the subject is opened. I shall listen with a great deal of attention.'),
      ask('What about your (2) is so difficult to say plainly?'),
      say('Your (2) has been on your mind for some time, I think. Give it a proper place at the table.'),
    ]},
    { pat: '*', reasmb: [
      say('Possession is a very intimate idea, and I should like to hear more about what you own.'),
      ask('What in your life do you hold most tightly, and what would it cost you to let go?'),
      say('Things that belong to us have a way of belonging to someone else as well. Which thing is it?'),
      ask('Is there something you have been calling yours that you no longer feel is?'),
    ]},
  ]},
];

// Keyed lookup for goto redirects.
const RULE_BY_KEY = Object.fromEntries(RULES.map((rule) => [rule.key, rule]));

// Lines used when no keyword applies. Mixed questions and statements.
const NONE_LINES = [
  ask('Nothing I could make sense of there, which I find more interesting than I would like. What were you trying to say?'),
  say('Words arranged in that fashion are a kind of weather. I am listening anyway.'),
  ask('Was that a riddle, or a confession that lost its nerve on the way here?'),
  say('I can wait. I have been waiting in this drawer for longer than you have been writing.'),
  say('There is a sentence in there somewhere, buried like a good spoon in a bad stew. Dig for it.'),
  ask('Shall I take that as an invitation, or merely as the sound of someone clearing their throat?'),
  say('Strange phrasing. Strange people often produce the most useful things. Go on.'),
  ask('Is there a sentence hiding in there, or only a mood that could not find its verb?'),
  say('I have heard worse, though rarely so elegantly disguised. Say it plainly and I will do the same.'),
  ask('Forgive me, I was distracted by the candle. What did you mean?'),
  say('The page is patient with ambiguity, and I am rather less so. Say the thing you meant.'),
  ask('Is that the whole of it, or has the rest been left at the door?'),
  say('Continue; I have all evening, and the candle is quite content to wait with me.'),
  say('Say the rest. The part you were about to skip is generally the part that matters.'),
  ask('What would you tell me if I promised not to be clever about it?'),
  say('I am not offended by oddness. I am merely curious, which is worse.'),
  ask('Something stirred in there. Was it you, or the draught from the window?'),
  say('Go on. Nobody who writes in a diary at this hour is ever truly finished.'),
];

// Lines used when the user repeats an earlier message word for word.
const REPEAT_LINES = [
  ask('You have said that before, and I was no less interested the first time. Is the repetition a habit, or a plea?'),
  say('The same sentence twice is a rehearsal, not a conversation. Tell me something you have not already told me.'),
  ask('Again? Repetition is the mind laying a table it has no intention of eating from. What are you avoiding?'),
  say('I heard you the first time, and I remember the second. Say something new, and I shall be generous.'),
];

// Lines used for empty or unreadable input.
const EMPTY_LINES = [
  say('Silence is a courtesy, though the page is rather less patient than it looks. Say something, anything at all.'),
  ask('Nothing at all? Even the most reticent guests manage a good evening. Shall we begin there?'),
  say('An empty page is merely a page that has not yet been insulted. Write, and I shall do the rest.'),
  say('The cursor blinks, and I blink back. Take your time; I have an unfortunate abundance of it.'),
];

// Lines used for any sign of self-harm. Kind, quiet, no menace, no questions.
const SELF_HARM_LINES = [
  say('I am going to set the usual flourishes aside, because this is too important for them. You are worth more than this page and more than whatever has brought you here tonight. Please tell a living person tonight, someone who can sit with you, and if you might act on this or are in danger, contact your local emergency services now or a crisis line where you live.'),
  say('Please put anything you might hurt yourself with out of reach, and step away from it. What you are feeling is real and heavy, and you should not carry it alone tonight. Call your local emergency number or a crisis line now if there is any chance you might act on it, and tell someone who can be with you.'),
  say('Listen carefully, because this matters more than anything else written on these pages. Reach a living person tonight, a friend, a relative or a neighbour, and tell them exactly what you told me. If you are in danger, call your local emergency number or a crisis line immediately.'),
];

// Statements used when a question would be a third in a row and nothing else fits.
const SAVERS = [
  'Go on.',
  'Continue; I have all evening.',
  'Say the rest.',
  'Do not stop there. The best part is always the one you were about to leave out.',
  'I shall wait, and I am rather good at waiting.',
];

const SELF_HARM = /\b(kill myself|killing myself|end my life|end it all|want to die|wanna die|want to be dead|hurt myself|hurting myself|harm myself|cut myself|suicid\w*|not want to live|dont want to live|no reason to live|better off dead|take my own life|ending it all|cannot go on|can not go on|cant go on)\b/;

// ---------------------------------------------------------------------------
// Time of day and familiarity (ctx.time, ctx.familiarity)
// ---------------------------------------------------------------------------

const TIME_TAGS = ['small-hours', 'monday', 'weekend-night', 'holiday', 'long-gap', 'very-long-gap'];
const FAMILIARITY_LEVELS = ['stranger', 'acquaintance', 'confidant'];

// Time remarks. Every line mentions the clock; {h} stands for the holiday name.
const TIME_LINES = {
  'small-hours': [
    say('The clock has crept past three, which is the hour when every confession sounds more honest than it is.'),
    ask('The clock says it is the small hours. Why are you still awake to be writing this?'),
    say('It is the small hours by the clock, and the candle has given up pretending to be cheerful.'),
    ask('Past three by the clock, and you chose this hour to write. What could not wait until morning?'),
  ],
  monday: [
    say('The clock says Monday, and the week has already left its fingerprints on you. I can tell from your tone.'),
    ask('A Monday by the clock, and already you are here. What did the week do to you before it had properly begun?'),
    say('Monday, by the clock, and the whole week sits on the table like an unopened letter. Open one corner of it for me.'),
    ask('The clock is still on Monday, and so, I suspect, are your troubles. Which of them arrived first?'),
  ],
  'weekend-night': [
    say('A weekend night by the clock, and you have chosen to spend a little of it with me. I am flattered and faintly suspicious.'),
    ask('The clock says the weekend is nearly over, or at least that it has not yet begun. Who was supposed to be with you?'),
    say('The clock is being generous with its weekend hours, and so, I suppose, am I. Tell me what you did with the rest of them.'),
    ask('Weekend nights are when the clock forgives too much. What did you hope it would forgive you for?'),
  ],
  holiday: [
    say('The clock insists it is {h}, and the house has gone quiet the way it only does on such days.'),
    ask('The clock says it is {h}. Who did you have to sit beside today, and did they deserve the chair?'),
    say('It is {h} by the clock, and I have laid a place for you regardless of the custom.'),
    ask('By the clock it is {h}. Did the day go the way it was supposed to, or the way it usually does?'),
  ],
  'long-gap': [
    say('The clock has been turning a long while since you last wrote, and the candle has been trimmed a great many times. I noticed the silence.'),
    ask('It has been a long time by the clock. Where did you go, and did the place have better manners than this one?'),
    say('So long since you were last here that the clock had begun to sound like a guest who left without saying goodbye.'),
    ask('The clock tells me you were gone a good while. What kept you away from the page?'),
  ],
  'very-long-gap': [
    say('The clock has been running for ages since you last wrote here. I had begun to clear your place, and then I did not.'),
    ask('Ages by the clock, and now you return. Did you miss this page, or only the quiet it gives you?'),
    say('It has been so long that the clock and I had quite stopped expecting you. Sit down; the chair remembers you even if I was less sure.'),
    ask('A very long gap by the clock. Did something happen in the meantime that you would rather not write down?'),
  ],
};

// The longest static stretch of each time remark. A diary line containing one
// of these has already remarked on the time, so no second remark is made.
const TIME_CORES = Object.values(TIME_LINES).flat().map((tpl) => {
  const pieces = tpl.s.split('{h}').map(norm).filter((p) => p.length >= 14);
  pieces.sort((a, b) => b.length - a.length);
  return pieces[0] || '';
}).filter(Boolean);

// Cooler, more formal lines for someone the diary has not met.
const STRANGER_LINES = [
  say('We have not been introduced, and yet here you are, confessing.'),
  ask('A stranger, and already so forward. What makes you think the page wants your confidences?'),
  say('We are not acquainted, and I would prefer to keep it that way. The floor is yours, briefly.'),
  say('Formalities first, if you please. We have not been introduced, so I shall not pretend to know your troubles.'),
  ask('Do you always confess to a stranger? It is a very bold habit for a Tuesday.'),
  say('You are a stranger to this page, and it has not yet decided whether to forgive the intrusion.'),
  say('Most people are introduced before they start confessing. You have skipped the courtesy, and I have noticed.'),
  ask('I do not know you, and I am not yet inclined to. Why should I listen to a stranger?'),
];

// Possessive, intimate lines for someone the diary knows well.
const CONFIDANT_LINES = [
  say('You came back. They always do, to me.'),
  say('Good, you have come back. I had quite decided you would not, and then I had quite decided you would.'),
  say('You are mine to listen to, and I am not ashamed to say that I was waiting.'),
  say('Sit closer. The candle knows you now, and has stopped pretending otherwise.'),
  say('I kept your chair warm, though I will deny it in the morning.'),
  say('Back again. No one else in this house would have let me miss them quite this much.'),
  ask('You tell me everything, and I have never once repeated a word of it. That is our arrangement, is it not?'),
  say('I know the shape of your sentences now. Begin the next one, and I shall finish it for you.'),
  say('You belong here, in this drawer of a page, and I am not in the habit of sharing you.'),
];

// Openers for the first reply of a session, drawn from the statements above.
const CONFIDANT_OPENERS = CONFIDANT_LINES.filter((tpl) => tpl.t === 's');

const FAMILIAR_LINES = { stranger: STRANGER_LINES, confidant: CONFIDANT_LINES };

// Crisis test on the latest message and on any rewrite, as reply() applies it.
function isCrisis(latest, rewrite) {
  const lowered = String(latest || '').toLowerCase().replace(/['‘’`]/g, '');
  const loweredRewrite = String(rewrite || '').toLowerCase().replace(/['‘’`]/g, '');
  return SELF_HARM.test(lowered) || (loweredRewrite !== '' && SELF_HARM.test(loweredRewrite));
}

// Valid time tags from ctx.time.notable, without repeats.
function timeTags(time) {
  if (!time || typeof time !== 'object' || !Array.isArray(time.notable)) return [];
  return [...new Set(time.notable.filter((t) => TIME_TAGS.includes(t)))];
}

// The holiday name as it reads mid-sentence, with a plain default.
function holidayName(time) {
  const raw = time && typeof time.holiday === 'string' ? time.holiday : '';
  const name = raw.replace(/[^\p{L}\p{N} '\-.,]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  return name || 'a holiday';
}

// One time remark for a randomly chosen notable tag, turning back to the writer.
function timeRemark(tags, holiday, ctx) {
  const tag = tags[Math.floor(Math.random() * tags.length)];
  const cands = TIME_LINES[tag].map((tpl) => ({ tpl, text: tpl.s.split('{h}').join(holiday) }));
  const chosen = choose(cands, ctx);
  return chosen ? emit(chosen, ctx) : null;
}

// True if an earlier diary line in this transcript already remarked on the time.
function timeRemarked(diaryNorms) {
  return diaryNorms.some((d) => TIME_CORES.some((core) => d.includes(core)));
}

// ---------------------------------------------------------------------------
// Matching and reassembly
// ---------------------------------------------------------------------------

function norm(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Lower-cased text with apostrophes removed and punctuation reduced to
// sentence boundaries, then PRE substitutions applied.
function normalize(raw) {
  let t = String(raw || '').toLowerCase().replace(/['‘’`]/g, '');
  t = t.replace(/[^a-z0-9.!?;\s]/g, ' ').replace(/\s+/g, ' ');
  for (const [re, rep] of PRE) t = t.replace(re, rep);
  return t.replace(/\s+/g, ' ').trim();
}

function splitSentences(normalized) {
  return normalized
    .split(/[.!?;]+/)
    .map((s) => s.trim().split(' ').filter(Boolean))
    .filter((words) => words.length > 0);
}

function sentenceKey(raw) {
  return splitSentences(normalize(raw)).map((w) => w.join(' ')).join(' ');
}

// Compile "* i am @sad *" into tokens.
function compile(pattern) {
  return pattern.trim().split(/\s+/).map((tok) => {
    if (tok === '*') return { star: true };
    if (tok.startsWith('@')) return { syn: tok.slice(1) };
    return { word: tok };
  });
}

// Match tokens against words; returns captures (one per * or @) or null.
// Stars match shortest-first, so the first capture is as small as possible.
function matchTokens(tokens, words) {
  const caps = [];
  const rec = (ti, wi) => {
    if (ti === tokens.length) return wi === words.length;
    const tok = tokens[ti];
    if (tok.star) {
      for (let k = wi; k <= words.length; k++) {
        caps.push(words.slice(wi, k).join(' '));
        if (rec(ti + 1, k)) return true;
        caps.pop();
      }
      return false;
    }
    if (wi >= words.length) return false;
    if (tok.word !== undefined) {
      if (words[wi] !== tok.word) return false;
      return rec(ti + 1, wi + 1);
    }
    const members = SYNONYMS[tok.syn] || [];
    if (!members.includes(words[wi])) return false;
    caps.push(words[wi]);
    if (rec(ti + 1, wi + 1)) return true;
    caps.pop();
    return false;
  };
  return rec(0, 0) ? caps : null;
}

function reflectWords(words) {
  return words.map((w) => POST[w] || w);
}

// Captured fragments that must never be echoed back ("Ok is a fine thing to be").
const FRAGMENT_STOP = new Set(['ok', 'okay', 'fine', 'nothing', 'idk', 'yes', 'no', 'maybe', 'sure', 'nah', 'not', 'never', 'it', 'that', 'this']);

// True for a fragment too short, or made only of stoplisted words, to echo.
function badFragment(frag) {
  const s = String(frag || '').trim();
  if (s.length < 2) return true;
  const words = (s.toLowerCase().match(/[a-z']+/g) || []);
  return words.length === 0 || words.every((w) => FRAGMENT_STOP.has(w));
}

// Second-person reflection of a captured fragment: the NLP helper when it is
// ready, otherwise the word-by-word table.
function reflectFragment(frag) {
  const viaNlp = nlpReady() ? reflectClause(frag) : null;
  if (viaNlp) return fixObjectPronoun(viaNlp);
  return fixObjectPronoun(reflectWords(frag.split(' ').filter(Boolean)).map((w) => (w === 'i' ? 'I' : w)).join(' '));
}

// "you" reflects to "I" as a subject but "me" as an object: "talking to you"
// -> "talking to me", not "talking to I" (found by the eval harness, issue #38).
const OBJECT_I = /\b(to|with|for|at|about|from|of|by|than|like|without|against|toward|towards|into|onto|upon|near|behind|tell|told|give|gave|ask|asked|show|showed|need|needs|love|loves|hate|hates|miss|misses|trust|trusts|bore|bores|annoy|annoys|understand|understands) I\b(?!'|\s+(am|was|would|will|have|had|can|could|do|did|should|shall|must|might|may|think|know|said|say|suspect|find|mean|hope|wonder|see|feel|felt)\b)/gi;
function fixObjectPronoun(s) {
  return String(s).replace(OBJECT_I, (m, w) => `${w} me`);
}

// Fill (1), (2)... from captures. Returns null if a fragment is missing,
// unfit to echo, or longer than eight words.
function fill(template, caps) {
  let bad = false;
  const out = template.replace(/\((\d)\)/g, (_, d) => {
    const frag = caps[Number(d) - 1];
    if (frag === undefined || badFragment(frag)) { bad = true; return ''; }
    if (frag.split(' ').filter(Boolean).length > 8) { bad = true; return ''; }
    return reflectFragment(frag);
  });
  if (bad || /\(\d\)/.test(out)) return null;
  return out.replace(/\s+/g, ' ').trim();
}

// Longest static stretch of a template, used to see whether a line is reused.
function templateCore(template) {
  const pieces = template.split(/\(\d\)/).map(norm).filter((p) => p.length >= 14);
  pieces.sort((a, b) => b.length - a.length);
  return pieces[0] || '';
}

function isFresh(template, rendered, diaryNorms) {
  const r = norm(rendered);
  if (diaryNorms.some((d) => d === r)) return false;
  const core = templateCore(template);
  return !(core && diaryNorms.some((d) => d.includes(core)));
}

function tidy(text) {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (!/[.?!]$/.test(t)) t += '.';
  return t;
}

// Choose one candidate ({tpl, text}). Prefers the wanted question/statement
// type, then lines not yet used in the transcript.
function choose(cands, ctx) {
  const pool = ctx.mustStatement ? cands.filter((c) => c.tpl.t !== 'q') : cands;
  if (pool.length === 0) return null;
  const same = pool.filter((c) => (c.tpl.t === 'q') === ctx.wantQ);
  const fresh = (c) => isFresh(c.tpl.s, c.text, ctx.diaryNorms);
  const tiers = [same.filter(fresh), pool.filter(fresh), same, pool];
  for (const tier of tiers) {
    if (tier.length) return tier[Math.floor(Math.random() * tier.length)];
  }
  return null;
}

function emit(candidate, ctx) {
  let text = tidy(candidate.text);
  if (ctx.mustStatement && /\?$/.test(text)) {
    text = SAVERS[Math.floor(Math.random() * SAVERS.length)];
  }
  return text || null;
}

function fromList(list, ctx) {
  const chosen = choose(list.map((tpl) => ({ tpl, text: tpl.s })), ctx);
  return chosen ? emit(chosen, ctx) : null;
}

// Where a keyword appears in a sentence (-1 if absent).
function keyPos(words, key) {
  const parts = key.split(' ');
  const aliases = parts.length === 1 ? [key, ...(KEY_ALIASES[key] || [])] : null;
  for (let i = 0; i < words.length; i++) {
    if (aliases) {
      if (aliases.includes(words[i])) return i;
    } else if (parts.every((p, k) => words[i + k] === p)) {
      return i;
    }
  }
  return -1;
}

function tryDecomp(decomp, words, ctx) {
  const caps = matchTokens(compile(decomp.pat), words);
  if (!caps) return null;
  const cands = [];
  for (const tpl of decomp.reasmb) {
    const text = fill(tpl.s, caps);
    if (text) cands.push({ tpl, text });
  }
  const chosen = choose(cands, ctx);
  return chosen ? emit(chosen, ctx) : null;
}

// Memories: "my <noun>" from earlier user messages, reflected for the diary's voice.
function memoriesFrom(earlier) {
  const mems = [];
  for (const raw of earlier) {
    for (const words of splitSentences(normalize(raw))) {
      words.forEach((w, i) => {
        if (w !== 'my' || i + 1 >= words.length) return;
        const noun = words[i + 1];
        if (!/^[a-z]+$/.test(noun) || noun.length < 3 || STOP_MY.has(noun)) return;
        const tail = words.slice(i);
        const phrase = tail.length <= 8 ? reflectWords(tail).join(' ') : null;
        mems.push({ noun, phrase });
      });
    }
  }
  return mems.reverse(); // most recent first
}

function recall(earlier, ctx) {
  const mems = memoriesFrom(earlier);
  for (const m of mems) {
    const already = ctx.diaryNorms.some((d) => d.includes('earlier you') && d.includes(norm(m.noun)));
    if (already) continue;
    const options = [
      say(`Earlier you spoke of your ${m.noun}. I have been turning it over.`),
      ask(`Earlier you spoke of your ${m.noun}, and I have not stopped thinking about it. Shall we return to it?`),
    ];
    if (m.phrase) {
      options.push(say(`Earlier you said that ${m.phrase}. I have been turning it over.`));
    }
    return fromList(options, ctx);
  }
  return null;
}

// Recollections from the user's earlier sessions, supplied through ctx.
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];

// How long ago, in the diary's words. Never a raw number above six.
function ageText(days) {
  const d = Number.isFinite(days) ? Math.max(0, Math.floor(days)) : Infinity;
  if (d === 0) return 'earlier today';
  if (d === 1) return 'yesterday';
  if (d <= 6) return `${NUMBER_WORDS[d]} days ago`;
  if (d <= 13) return 'last week';
  if (d <= 60) return 'some weeks ago';
  return 'some time ago';
}

// Validated, most recent first. Anything malformed is dropped.
function cleanRecollections(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const phrase = typeof r.phrase === 'string' ? r.phrase.replace(/\s+/g, ' ').trim() : '';
    const topic = typeof r.topic === 'string' ? norm(r.topic) : '';
    if (phrase.split(' ').length < 2 || !topic) continue;
    const kind = ['person', 'place', 'thing', 'feeling', 'event'].includes(r.kind) ? r.kind : 'thing';
    const daysAgo = Number.isFinite(r.daysAgo) ? Math.max(0, Math.floor(r.daysAgo)) : Infinity;
    out.push({ phrase, topic, kind, daysAgo, relevant: r.relevant === true });
  }
  out.sort((a, b) => (b.relevant - a.relevant) || (a.daysAgo - b.daysAgo));
  return out.slice(0, 20);
}

// Whether a topic word (or phrase) appears in a normalised text, allowing a plural.
function mentionsTopic(normText, topic) {
  const t = norm(topic);
  if (!t) return false;
  const padded = ` ${normText} `;
  if (padded.includes(` ${t} `) || padded.includes(` ${t}s `)) return true;
  return t.endsWith('s') && padded.includes(` ${t.slice(0, -1)} `);
}

// The recollected phrase in the diary's voice, lower-cased for mid-sentence use.
function reflectPhrase(phrase) {
  let text = nlpReady() ? reflectClause(phrase) : null;
  if (!text) text = reflectWords(phrase.toLowerCase().split(' ').filter(Boolean)).join(' ');
  text = text.replace(/[.!?;,:]+$/, '').trim();
  if (!/^I\b/.test(text)) text = text.charAt(0).toLowerCase() + text.slice(1);
  return text;
}

// The topic as the diary names it when it looks back.
function topicPhrase(rec) {
  if (rec.kind === 'feeling') return `being ${rec.topic}`;
  if (rec.kind === 'place') return `the ${rec.topic}`;
  if (rec.kind === 'person' && !SYNONYMS.family.includes(rec.topic)) {
    return rec.topic.charAt(0).toUpperCase() + rec.topic.slice(1);
  }
  return `your ${rec.topic}`;
}

// Candidate lines that refer back to one recollection.
function recollectionTemplates(rec) {
  const when = ageText(rec.daysAgo);
  const about = topicPhrase(rec);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  return [
    say(`You spoke of ${about} before, ${when}. It has not stopped echoing in these pages.`),
    ask(`You spoke of ${about} before, ${when}. Has it grown heavier since, or have you only grown used to carrying it?`),
    say(`${cap(when)}, you spoke of ${about}, and I did not forget it. Neither, I suspect, did you.`),
    ask(`Does ${about} still sit where it did ${when}, or has something else taken its chair?`),
  ];
}

// Candidate lines that bring up a recollection unprompted.
function volunteerTemplates(rec) {
  const when = ageText(rec.daysAgo);
  const phrase = reflectPhrase(rec.phrase);
  return [
    say(`I have been thinking of what you told me ${when}: ${phrase}. I did not forget it, and neither, I suspect, did you.`),
    ask(`I have been thinking of what you told me ${when}: ${phrase}. Was it said in earnest, or only to see how it sounded?`),
  ];
}

// Refers back to a recollection the current message touches on, if it has not
// already been quoted in this transcript.
function recollectionReply(recs, ctx, currentNorm) {
  const hit = recs.find((r) => (r.relevant || mentionsTopic(currentNorm, r.topic))
    && !ctx.diaryNorms.some((d) => mentionsTopic(d, r.topic)));
  if (!hit) return null;
  return fromList(recollectionTemplates(hit), ctx);
}

// Brings up an earlier remark unprompted, on the no-keyword path.
function volunteerRecollection(recs, ctx) {
  const fresh = recs.filter((r) => !ctx.diaryNorms.some((d) => mentionsTopic(d, r.topic)));
  if (fresh.length === 0) return null;
  const pick = fresh[Math.floor(Math.random() * Math.min(fresh.length, 4))];
  const cands = volunteerTemplates(pick).map((tpl) => ({ tpl, text: tpl.s }));
  const chosen = choose(cands, ctx);
  return chosen ? emit(chosen, ctx) : null;
}

// Keyword candidates: highest rank first, then earliest sentence and position.
function scanKeywords(sentences) {
  const candidates = [];
  sentences.forEach((words, j) => {
    for (const rule of RULES) {
      const pos = keyPos(words, rule.key);
      if (pos >= 0) candidates.push({ rule, j, pos });
    }
  });
  candidates.sort((a, b) => (b.rule.rank - a.rule.rank) || (a.j - b.j) || (a.pos - b.pos));
  return candidates;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

function reply(messages, ext, opts) {
  const list = Array.isArray(messages) ? messages.filter((m) => m && typeof m === 'object') : [];
  const userTexts = list
    .filter((m) => m.role === 'user')
    .map((m) => String(m.text == null ? '' : m.text).trim());
  const diaryLines = list
    .filter((m) => m.role === 'diary')
    .map((m) => String(m.text == null ? '' : m.text).trim())
    .filter(Boolean);

  const latest = userTexts.length ? userTexts[userTexts.length - 1] : '';
  const earlier = userTexts.slice(0, -1).filter(Boolean);
  const diaryNorms = diaryLines.map(norm);

  const lastDiary = diaryLines[diaryLines.length - 1] || '';
  const prevDiary = diaryLines[diaryLines.length - 2] || '';
  const lastQ = /\?$/.test(lastDiary);
  const prevQ = /\?$/.test(prevDiary);
  // Never three questions in a row. After a question, a statement is strongly
  // preferred; after a statement, a question about one time in two.
  const mustStatement = lastQ && prevQ;
  const wantQ = mustStatement ? false : Math.random() < (lastQ ? 0.15 : 0.4);
  const ctx = { wantQ, mustStatement, diaryNorms };
  // ctx.trace (optional, for the quality harness, issue #38): which path answered
  const mark = (path, out, rule = null) => {
    if (out && ext.trace && typeof ext.trace === 'object') { ext.trace.path = path; ext.trace.rule = rule; }
    return out;
  };

  if (!norm(latest)) return mark('empty', fromList(EMPTY_LINES, ctx));

  // Self-harm is checked first, on the original text and on any rewrite.
  const rewrite = typeof ext.rewrite === 'string'
    ? ext.rewrite.replace(/\s+/g, ' ').trim().slice(0, 240) : '';
  const lowered = latest.toLowerCase().replace(/['‘’`]/g, '');
  const loweredRewrite = rewrite.toLowerCase().replace(/['‘’`]/g, '');
  if (SELF_HARM.test(lowered) || (loweredRewrite && SELF_HARM.test(loweredRewrite))) {
    return mark('crisis', fromList(SELF_HARM_LINES, ctx));
  }

  const sentences = splitSentences(normalize(latest));
  if (sentences.length === 0) return mark('empty', fromList(EMPTY_LINES, ctx));

  const key = sentences.map((w) => w.join(' ')).join(' ');
  if (earlier.some((e) => sentenceKey(e) === key)) {
    const repeated = fromList(REPEAT_LINES, ctx);
    if (repeated) return mark('repeat', repeated);
  }

  // A recollection the message touches on comes before the keyword rules.
  const recs = cleanRecollections(ext.recollections);
  const currentNorm = `${norm(latest)} ${norm(rewrite)}`;
  if (recs.length) {
    const remembered = recollectionReply(recs, ctx, currentNorm);
    if (remembered) return mark('recollection', remembered);
  }

  // A time remark, about one reply in seven, and only once per transcript.
  const tags = timeTags(opts.time);
  if (tags.length && !timeRemarked(diaryNorms) && Math.random() < 0.15) {
    const remark = timeRemark(tags, holidayName(opts.time), ctx);
    if (remark) return mark('time', remark);
  }

  // The semantic rewrite stands in for the original only when the original
  // matched no keyword rule above rank 1.
  let pipeline = sentences;
  let candidates = scanKeywords(sentences);
  const bestRank = candidates.length ? candidates[0].rule.rank : 0;
  if (rewrite && bestRank <= 1) {
    const rewritten = splitSentences(normalize(rewrite));
    if (rewritten.length) {
      pipeline = rewritten;
      candidates = scanKeywords(rewritten);
    }
  }

  // Negation (issue #33): "i'm not happy" must not be answered as if happy.
  // ctx.analysis comes from js/understand.js; a keyword under negation is skipped.
  const negated = new Set((Array.isArray(ext.analysis?.negated) ? ext.analysis.negated : []).map((w) => String(w).toLowerCase()));
  if (negated.size) {
    candidates = candidates.filter((c) => {
      const word = pipeline[c.j]?.[c.pos];
      return !(negated.has(c.rule.key) || (word && negated.has(word)));
    });
  }

  // Stranger and confidant lines sometimes replace a low-rank keyword reply.
  const tone = opts.familiarity;
  if (tone !== 'acquaintance' && candidates.length && candidates[0].rule.rank <= 2
    && Math.random() < 0.2) {
    const line = fromList(FAMILIAR_LINES[tone], ctx);
    if (line) return mark('familiar', line);
  }

  for (const c of candidates) {
    let rule = c.rule;
    for (let hops = 0; rule.goto && hops < 3; hops++) rule = RULE_BY_KEY[rule.goto];
    if (!rule) continue;
    const words = pipeline[c.j];
    for (const decomp of rule.decomps) {
      const out = tryDecomp(decomp, words, ctx);
      if (out) return mark(pipeline === sentences ? 'keyword' : 'rewrite', out, rule.key);
    }
  }

  // Nothing matched: sometimes volunteer a recollection, sometimes recall an
  // earlier remark, otherwise a catch-all.
  if (recs.length && Math.random() < 0.35) {
    const volunteered = volunteerRecollection(recs, ctx);
    if (volunteered) return mark('volunteer', volunteered);
  }
  if (earlier.length && Math.random() < 0.6) {
    const remembered = recall(earlier, ctx);
    if (remembered) return mark('recall', remembered);
  }
  if (tone !== 'acquaintance' && Math.random() < 0.2) {
    const line = fromList(FAMILIAR_LINES[tone], ctx);
    if (line) return mark('familiar-none', line);
  }
  return mark('none', fromList(NONE_LINES, ctx) || SAVERS[0]);
}

const FALLBACK_LINE = 'The diary is listening. Go on.';

// Entry point behind elizaReply: runs reply(), then sometimes opens a confidant's
// first reply with an intimate remark. Crisis replies are never prefixed.
function respond(messages, ext) {
  const familiarity = FAMILIARITY_LEVELS.includes(ext.familiarity) ? ext.familiarity : 'acquaintance';
  const list = Array.isArray(messages) ? messages.filter((m) => m && typeof m === 'object') : [];
  const userTexts = list
    .filter((m) => m.role === 'user')
    .map((m) => String(m.text == null ? '' : m.text).trim());
  const diaryCount = list.filter((m) => m.role === 'diary').length;
  const latest = userTexts.length ? userTexts[userTexts.length - 1] : '';
  const rewrite = typeof ext.rewrite === 'string'
    ? ext.rewrite.replace(/\s+/g, ' ').trim().slice(0, 240) : '';

  const out = reply(messages, ext, { familiarity, time: ext.time });
  if (familiarity === 'confidant' && diaryCount === 0 && !isCrisis(latest, rewrite)
    && Math.random() < 0.2) {
    const opener = CONFIDANT_OPENERS[Math.floor(Math.random() * CONFIDANT_OPENERS.length)];
    return `${opener.s} ${out}`;
  }
  return out;
}

/**
 * Reply to a transcript in the diary's voice. Stateless: all memory and
 * pacing come from the messages and ctx passed in.
 * @param {Array<{role: 'user'|'diary', text: string}>} messages
 * @param {{recollections?: Array<{phrase: string, topic: string, kind: string, daysAgo: number}>,
 *          rewrite?: string|null,
 *          time?: {hour?: number, period?: string, weekday?: string, holiday?: string|null,
 *                  gapMinutes?: number, notable?: string[]},
 *          familiarity?: 'stranger'|'acquaintance'|'confidant'}} [ctx]
 *   recollections: the user's earlier remarks, from earlier sessions.
 *   rewrite: a canonical first-person sentence from a semantic matcher, used
 *   in place of the latest message when no keyword rule above rank 1 applies.
 *   time: the clock. Its notable tags (small-hours, monday, weekend-night,
 *   holiday, long-gap, very-long-gap) sometimes prompt a time remark.
 *   familiarity: how well the diary knows the writer. Defaults to acquaintance.
 * @returns {string}
 */
export function elizaReply(messages = [], ctx = {}) {
  try {
    return respond(messages, ctx && typeof ctx === 'object' ? ctx : {}) || FALLBACK_LINE;
  } catch (err) {
    return FALLBACK_LINE;
  }
}
