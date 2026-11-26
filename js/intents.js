/**
 * intents.js - exemplar sentences for semantic intent matching (js/embed.js).
 *
 * Each intent has a `canonical` first-person sentence that js/eliza.js already
 * answers through a keyword rule, and informal, slangy, typo-tolerant examples
 * that people actually type. Embeddings of the examples and canonical are compared
 * against the user's message; a match hands the canonical sentence to the ELIZA
 * engine, so the reply lands on the right rule.
 */

export const INTENTS = [
  // Feelings
  { intent: 'tired', canonical: 'I am tired', examples: [
    'i am exhausted', 'i am knackered', 'burnt out', 'so drained lately',
    'cant keep my eyes open', 'running on empty today', 'i am so wiped', 'my batteries are dead',
    'i could sleep for a week', 'totally knackerd', 'im shattered tbh',
  ] },
  { intent: 'sad', canonical: 'I feel sad', examples: [
    'i feel like crying', 'everything feels grey', 'feeling blue again', 'i feel low today',
    'kinda miserable rn', 'my heart is heavy', 'i just want to cry', 'feeling down in the dumps',
    'i feel so sad lately', 'sadness is sitting on me',
  ] },
  { intent: 'lonely', canonical: 'I am lonely', examples: [
    'nobody calls me anymore', 'i feel so alone', 'no one to talk to', 'i have no friends rn',
    'the house is so quiet', 'feeling isolated af', 'i miss having people around', 'i am solo and sad',
    'lonliness is killing me slowly', 'i eat dinner alone every night',
  ] },
  { intent: 'angry', canonical: 'I am angry', examples: [
    'im so pissed off', 'i am furious right now', 'i want to scream', 'so mad i could punch a wall',
    'this makes my blood boil', 'i am livid honestly', 'rage is building in me', 'i am sick of this anger',
    'i could throw my phone', 'steaming with rage',
  ] },
  { intent: 'afraid', canonical: 'I am afraid', examples: [
    'i am scared of the dark', 'my anxiety is through the roof', 'i am terrified', 'im so nervous about tomorrow',
    'i keep worrying about everything', 'shaking with fear', 'i feel uneasy and jumpy', 'i am frightened of whats next',
    'got the heebie jeebies', 'panic attack incoming',
  ] },
  { intent: 'bored', canonical: 'I am bored', examples: [
    'this is so boring', 'nothing to do and im bored', 'i am so bored rn', 'life is dull lately',
    'meh nothing interests me', 'i have nothing to do', 'tedious day again', 'everything feels pointless and dull',
    'im sooo bored of everything', 'bored out of my skull',
  ] },
  { intent: 'happy', canonical: 'I am happy', examples: [
    'i am so happy today', 'feeling great for once', 'best day ever', 'im over the moon',
    'life is pretty good rn', 'i feel cheerful and light', 'chuffed to bits', 'everything went right today',
    'i am glad about everything', 'feeling content and warm',
  ] },
  { intent: 'hungry', canonical: 'I am hungry', examples: [
    'im starving', 'i could eat a horse', 'my stomach is growling', 'what should i cook for dinner',
    'i need food asap', 'so hungry i cant think', 'i want a big cake', 'could murder a sandwich',
    'time for supper i guess', 'skipped lunch and im famished',
  ] },
  { intent: 'sleep', canonical: 'I can not sleep', examples: [
    'cant sleep again', 'insomnia is back', 'i keep waking up at 3am', 'my brain wont shut off at night',
    'staring at the ceiling all night', 'couldnt sleep a wink', 'i lie awake every night', 'sleep will not come',
    'wide awake at midnight', 'nightmares stopped me sleeping',
  ] },
  { intent: 'dream', canonical: 'I had a dream', examples: [
    'last night i dreamt about my house', 'i had the weirdest dream', 'i keep dreaming about water',
    'had a nightmare again', 'i dreamed of a dead bird', 'my dreams are getting strange',
    'i dreamt i was falling', 'dreamed about my ex last night', 'there was a dream where i was lost',
  ] },
  { intent: 'stuck', canonical: 'I cannot do it', examples: [
    'i just cant do this', 'im useless at everything', 'i give up honestly', 'there is no way i can finish',
    'it is too hard for me', 'i am stuck and cant move', 'i cant cope with this anymore', 'no chance i can manage',
    'i will never get it done', 'i just cant',
  ] },
  { intent: 'help', canonical: 'I need help', examples: [
    'can someone help me pls', 'i need a hand here', 'help me figure this out', 'i really need some support',
    'i am lost and need advice', 'hlp me plz', 'i need someone to talk me through it', 'anyone got advice for me',
    'i have no clue what to do', 'please help me out',
  ] },
  { intent: 'secret', canonical: 'I have a secret', examples: [
    'i have a secret to tell', 'i am hiding something big', 'can you keep a secret', 'nobody knows this but me',
    'i have been keeping something hidden', 'i did something i never told anyone', 'between us i have a confession',
    'this stays in here but i have a secret', 'i kept it quiet for years',
  ] },
  { intent: 'music', canonical: 'I listen to music', examples: [
    'i have been playing piano all week', 'listening to old songs again', 'my favourite opera is on',
    'i love singing in the shower', 'been playing my cello for hours', 'put some music on for me',
    'i sing when i am alone', 'this song is stuck in my head', 'i listen to music every night',
  ] },
  { intent: 'love', canonical: 'I love someone', examples: [
    'i am in love with someone', 'i have a huge crush', 'i fancy somebody at work', 'my heart belongs to someone',
    'i am so smitten lately', 'i adore him so much', 'i think i am falling for them', 'i love her more than anything',
    'i have a thing for my neighbour',
  ] },
  { intent: 'hate', canonical: 'I hate this place', examples: [
    'i hate this stupid thing', 'i really loathe this diary', 'i despise you honestly', 'i cant stand you',
    'i detest this whole app', 'i hate everything about you', 'u are the worst', 'i wish i never found you',
    'you make me sick',
  ] },
  // Family and people
  { intent: 'mother', canonical: 'my mother', examples: [
    'my mom keeps calling me', 'my mum never listens', 'i miss my mama so much', 'my mommy would hate this',
    'my mother said something cruel', 'mom is driving me nuts', 'i think my mum is ill', 'my mother never approved of me',
  ] },
  { intent: 'sister', canonical: 'my sister', examples: [
    'my sister stole my clothes again', 'my sis and i fell out', 'my little sister is annoying', 'i never see my sister now',
    'my sister always wins everything', 'my sister thinks im weird', 'my older sis is so bossy', 'my sister is getting married',
  ] },
  { intent: 'friend', canonical: 'my friend', examples: [
    'my best mate ghosted me', 'my friend keeps cancelling plans', 'my pal is going through a lot', 'my buddy lied to me',
    'my bestie betrayed me', 'my friend and i argued', 'my mate is moving away', 'my friends think im strange',
  ] },
  { intent: 'dad', canonical: 'my father', examples: [
    'my dad never said he loved me', 'my dad is so disappointed', 'my papa was a hard man', 'my father left when i was young',
    'my dad taught me to fish', 'dad keeps asking about my job', 'my daddy would be proud', 'my father and i never talk',
  ] },
  // Life
  { intent: 'work', canonical: 'I hate my job', examples: [
    'my boss is a nightmare', 'i hate going to the office', 'work is killing my soul', 'my manager keeps shouting at me',
    'my job is so pointless', 'i dread every shift', 'my colleagues are backstabbing idiots', 'work stress is unbearable',
    'my career is going nowhere',
  ] },
  { intent: 'money', canonical: 'I want money', examples: [
    'i need cash badly', 'broke as a joke again', 'i wish i was rich', 'money troubles every month',
    'i cant pay my rent', 'i want more dosh', 'skint and sad this week', 'i could use a big payday',
    'i am so poor lately',
  ] },
  { intent: 'day', canonical: 'I had a long day', examples: [
    'what a day it has been', 'today was rubbish', 'long day at work', 'this week has been a disaster',
    'my day was awful', 'it has been a strange day', 'tonight feels endless', 'this morning was a mess',
  ] },
  { intent: 'failure', canonical: 'I always mess everything up', examples: [
    'i always screw things up', 'everything i touch goes wrong', 'i never get anything right', 'i always fail at stuff',
    'i ruin everything i try', 'i always ruin the good things', 'it always goes wrong for me', 'i never finish what i start',
  ] },
  { intent: 'nobody', canonical: 'nobody ever listens to me', examples: [
    'nobody cares what i think', 'everyone ignores me', 'no one ever listens', 'nobody gets me at all',
    'everybody talks over me', 'everyone leaves in the end', 'nobody ever asks how i am', 'people always let me down',
  ] },
  { intent: 'apology', canonical: 'I am sorry', examples: [
    'i am so sorry for what i did', 'my bad, i messed up', 'apologies for being rude earlier', 'i feel awful, sorry',
    'sorry about last night', 'i owe you an apology', 'i regret how i acted', 'forgive me for snapping',
  ] },
  // Questions about the diary
  { intent: 'who_are_you', canonical: 'who are you', examples: [
    'who r u exactly', 'what are you even', 'whats your deal', 'are u a real person',
    'who is behind this thing', 'tell me who you are', 'what is this place', 'who am i talking to',
  ] },
  { intent: 'what_do_you_do', canonical: 'what do you do', examples: [
    'what do u do all day', 'what do you do for fun', 'how do you spend your time', 'what are you up to',
    'what did you do this weekend', 'what have you been doing', 'so what do you actually do',
    'what r u doing rn', 'what keeps you busy',
  ] },
  { intent: 'weekend', canonical: 'how was your weekend', examples: [
    'how was ur weekend', 'did you do anything fun this weekend', 'got any plans for the weekend', 'what did you get up to at the weekend',
    'how was your day', 'how is your evening going', 'what is your day been like', 'how was your saturday', 'did you have a good weekend',
  ] },
  { intent: 'name', canonical: 'what is your name', examples: [
    'whats ur name', 'what do they call you', 'do you have a name', 'what should i call you',
    'tell me your name pls', 'who do i call you', 'what name do you go by', 'whats ur username lol',
  ] },
  { intent: 'machine', canonical: 'are you a machine', examples: [
    'are u a robot', 'are you an ai', 'is this a chatbot', 'are you a computer program',
    'r u a bot or what', 'you are just code right', 'is there a human in there', 'are you a real program',
  ] },
  { intent: 'strange', canonical: 'you are strange', examples: [
    'you are so weird', 'u r a bit creepy', 'you are odd honestly', 'you are a strange little thing',
    'you seem off to me', 'you are very peculiar', 'you give me the creeps', 'you are a bit unnerving',
  ] },
  { intent: 'compliment', canonical: 'you are wonderful', examples: [
    'you are so clever', 'u r brilliant tbh', 'i love you diary', 'you are lovely',
    'you are the best journal ever', 'you are charming honestly', 'you are so sweet', 'you are genius',
  ] },
  { intent: 'insult', canonical: 'you are stupid', examples: [
    'you are so dumb', 'u r an idiot', 'you are useless', 'this diary is pointless',
    'you are such a moron', 'you are a tedious bore', 'you are foolish and boring', 'you are dull as dishwater',
  ] },
  { intent: 'damn', canonical: 'damn it', examples: [
    'damn it all', 'bloody hell not again', 'bugger this', 'oh bollocks',
    'shit i forgot again', 'fuck this day', 'damn this is annoying', 'bloody typical',
  ] },
  { intent: 'dont_know', canonical: 'I do not know', examples: [
    'idk honestly', 'no clue', 'dunno what to say', 'i really have no idea',
    'not sure what i feel', 'i am not sure anymore', 'no idea how to answer', 'i cant say, i dont know',
  ] },
  { intent: 'lying', canonical: 'I told a lie', examples: [
    'i lied to my friend', 'im not telling the truth', 'i made that story up', 'i lied to my boss',
    'all of that was a lie', 'i fibbed a little', 'honestly i was deceiving them', 'i told a little white lie',
    'i am such a liar', 'i pretended everything was fine',
  ] },
  { intent: 'remember', canonical: 'I remember', examples: [
    'i still remember that day', 'i recall the summer we met', 'i cannot forget what happened', 'memories keep coming back',
    'i remember it like yesterday', 'that memory still haunts me', 'i keep recalling old times', 'i clearly remember the house',
  ] },
  { intent: 'why', canonical: 'why does this happen', examples: [
    'why do bad things happen', 'why is life like this', 'why does everything hurt', 'why me again',
    'how come nothing works out', 'why do i keep doing this', 'why is this happening to me',
    'why does nothing ever work', 'why r things so hard',
  ] },
  { intent: 'hello', canonical: 'hello', examples: [
    'hi there', 'hey diary', 'good evening to you', 'hiya, you there',
    'hello again', 'howdy partner', 'greetings, anyone home', 'good morning dear diary',
  ] },
  { intent: 'bye', canonical: 'goodbye', examples: [
    'bye for now', 'goodnight diary', 'see you later', 'gotta go now',
    'im off to bed', 'catch you later', 'farewell for now', 'i am leaving you now',
  ] },
  { intent: 'thanks', canonical: 'thank you', examples: [
    'thanks a lot', 'ta very much', 'cheers for that', 'thank u so much',
    'i appreciate it', 'many thanks for listening', 'thanks for hearing me out', 'much appreciated',
  ] },
];
