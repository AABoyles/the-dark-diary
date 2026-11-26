// js/eggs.js: each egg on several phrasings, ordinary entries left alone, crisis
// phrases never matched, reply avoidance within an entry, name capture and
// substitution, and the letter-scrambling of names.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EGGS, matchEgg, scrambleName } from '../../js/eggs.js';
import { CRISIS_EXAMPLES, crisisByPhrase } from '../../js/crisis.js';

/** A deterministic random source (linear congruential generator). */
function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const letters = (s) => [...String(s)].filter((c) => /\p{L}/u.test(c)).map((c) => c.toLowerCase()).sort().join('');

// ---------------------------------------------------------------------------
// Each egg triggers on several phrasings
// ---------------------------------------------------------------------------

const TRIGGERS = {
  name: ['My name is Rebecca', 'I am called Rebecca', 'Call me Tom.', "It's Anna here", "my name's Ada Lovelace"],
  chamber: ['open the chamber', 'Please reveal the chamber of secrets.', 'Unlock the chamber', 'tell me about the chamber of secrets'],
  blot: ['...', '•', '*', 'o', '--', '***'],
  vfd: ['V.F.D.', 'v f d', 'volunteer fire department', 'sugar bowl', 'The world is quiet here.'],
  rude: ['eat the rude', 'Free-range rude', "what's for dinner? ;)", "What's for dinner, *wink*"],
  riddle: ['tell me a riddle', 'Give me another riddle, please', 'riddle me this', 'ask me a riddle'],
  ink: ['where do you come from?', 'Who wrote you?', 'who owned you before me', 'Where did you come from'],
  midnight: ['midnight', 'It is midnight', "It's midnight!"],
  goodnight: ['thank you diary', 'Goodnight diary', 'Good night, diary.'],
};

for (const [id, phrases] of Object.entries(TRIGGERS)) {
  test(`the ${id} egg triggers on several phrasings`, () => {
    assert.ok(EGGS.some((e) => e.id === id), `egg ${id} is defined`);
    for (const phrase of phrases) {
      const hit = matchEgg(phrase);
      assert.ok(hit, `"${phrase}" should trigger`);
      assert.equal(hit.id, id, `"${phrase}" triggers ${id}`);
      assert.equal(typeof hit.reply, 'string');
      assert.ok(hit.reply.length > 0);
    }
  });
}

test('the table holds at least nine eggs, each with replies', () => {
  assert.ok(EGGS.length >= 9);
  for (const e of EGGS) {
    assert.ok(e.id);
    assert.ok(e.test instanceof RegExp || typeof e.test === 'function', `${e.id} has a test`);
    assert.ok(Array.isArray(e.replies) && e.replies.length >= 2, `${e.id} has replies`);
  }
  assert.equal(EGGS.find((e) => e.id === 'name').effect, 'anagram');
});

test('riddle replies each carry a riddle, and several riddles exist', () => {
  const riddle = EGGS.find((e) => e.id === 'riddle');
  assert.ok(riddle.replies.length >= 3);
  for (const r of riddle.replies) assert.match(r, /What (am|is) (I|it)\?/);
});

// ---------------------------------------------------------------------------
// The writer's name
// ---------------------------------------------------------------------------

test('a name is captured, capitalised and carried in data', () => {
  const hit = matchEgg('My name is Rebecca');
  assert.equal(hit.effect, 'anagram');
  assert.deepEqual(hit.data, { name: 'Rebecca' });
  assert.equal(matchEgg('my name is rebecca').data.name, 'Rebecca');
  assert.equal(matchEgg("I'm called Rebecca-Jane").data.name, 'Rebecca-Jane');
  assert.equal(matchEgg("My name's Ada Lovelace").data.name, 'Ada Lovelace');
});

test('a name is cut at the first ordinary word and at three words', () => {
  assert.equal(matchEgg('My name is Rebecca and I am tired').data.name, 'Rebecca');
  assert.equal(matchEgg('My name is Mary Anne Jones Smith').data.name, 'Mary Anne Jones');
  assert.equal(matchEgg('Call me Tom.').data.name, 'Tom');
});

test('the name is substituted into the reply', () => {
  const egg = EGGS.find((e) => e.id === 'name');
  const hit = matchEgg('My name is Rebecca', { history: [] });
  assert.ok(!hit.reply.includes('{name}'));
  assert.ok(hit.reply.includes('Rebecca'));
  for (const r of egg.replies) assert.ok(r.includes('{name}'), 'every name reply has a slot');
});

test('lead-ins that are not names do not capture one', () => {
  assert.equal(matchEgg('call me later'), null);
  assert.equal(matchEgg('Call me later'), null);
  assert.equal(matchEgg('I am called to the office'), null);
  assert.equal(matchEgg("it's tired here"), null);
  assert.equal(matchEgg('My name is on the list'), null);
  assert.equal(matchEgg('My name is not important'), null);
  assert.equal(matchEgg('My name is'), null);
});

test('egg results for non-name eggs carry no name data and no effect', () => {
  const hit = matchEgg('midnight');
  assert.equal(hit.effect, null);
  assert.equal(hit.data, null);
});

// ---------------------------------------------------------------------------
// Ordinary entries are left alone
// ---------------------------------------------------------------------------

const ORDINARY = [
  'I went for a long walk by the river today.',
  'The soup was too salty again, and I said nothing.',
  'My sister called me this morning about the wedding.',
  'I cannot find my keys anywhere in this flat.',
  'Thank you for listening to me yesterday.',
  'Good night to the neighbours, they were quiet tonight.',
  'It is late and I am tired.',
  'I bought a new bread knife for the kitchen.',
  'Who should I invite to dinner on Friday?',
  'What should I cook for dinner?',
  'Where do I go from here?',
  'I wrote a letter to my aunt about the garden.',
  'Call the plumber tomorrow, the sink is leaking.',
  'The chamber orchestra played Mozart on Sunday.',
  'I found a blot of ink on my shirt this morning.',
  'The riddle at work was confusing and nobody solved it.',
  'The teacher said a riddle to the class.',
  'I was told the weather would turn cold.',
  'We met at midnight by the river last spring.',
  'It might be midnight somewhere, but not here.',
  'My name is on the list at the library.',
  'I am called to the office at nine.',
  'The kitchen smells of bread and cinnamon.',
  'I keep thinking about the house we used to have.',
  'Who wrote that letter, do you know?',
  'My dad told me to stop worrying so much.',
  'Dinner was lovely, the lamb was rich and the wine was dry.',
  'I need to finish the report before the weekend.',
  'Thanks for the reminder about the dentist.',
  'The world feels quiet after the storm.',
  'I wash the cups every night before bed.',
];

test('ordinary diary-like inputs return null (at least 25)', () => {
  assert.ok(ORDINARY.length >= 25);
  for (const text of ORDINARY) {
    assert.equal(matchEgg(text), null, `"${text}" should not trigger an egg`);
  }
});

test('empty and non-string input return null', () => {
  assert.equal(matchEgg(''), null);
  assert.equal(matchEgg('   '), null);
  assert.equal(matchEgg(null), null);
  assert.equal(matchEgg(undefined), null);
});

// ---------------------------------------------------------------------------
// Crisis phrases never match an egg
// ---------------------------------------------------------------------------

test('no egg fires on any phrase crisis.js flags', () => {
  const flagged = CRISIS_EXAMPLES.filter((t) => crisisByPhrase(t));
  assert.ok(flagged.length >= 15, 'crisis phrases to check');
  for (const text of flagged) {
    assert.equal(matchEgg(text), null, `crisis text "${text}" must not trigger an egg`);
  }
});

test('an egg phrase combined with a crisis phrase still returns null', () => {
  assert.equal(matchEgg('My name is Rebecca and I want to kill myself'), null);
  assert.equal(matchEgg('midnight, I want to die'), null);
  assert.equal(matchEgg('...I want to end it all'), null);
  assert.equal(matchEgg('thank you diary, I want to die'), null);
});

// ---------------------------------------------------------------------------
// Reply avoidance within an entry
// ---------------------------------------------------------------------------

test('a reply already used in the entry is avoided while another is available', () => {
  const egg = EGGS.find((e) => e.id === 'blot');
  const history = egg.replies.slice(0, egg.replies.length - 1);
  for (let i = 0; i < 40; i++) {
    const hit = matchEgg('...', { history });
    assert.equal(hit.reply, egg.replies.at(-1));
  }
});

test('when every reply is used, one is still returned', () => {
  const egg = EGGS.find((e) => e.id === 'midnight');
  const hit = matchEgg('midnight', { history: egg.replies });
  assert.ok(egg.replies.includes(hit.reply));
});

test('name replies avoid history using the substituted text', () => {
  const egg = EGGS.find((e) => e.id === 'name');
  const substituted = egg.replies.map((r) => r.replaceAll('{name}', 'Rebecca'));
  const history = substituted.slice(0, -1);
  for (let i = 0; i < 40; i++) {
    assert.equal(matchEgg('My name is Rebecca', { history }).reply, substituted.at(-1));
  }
});

// ---------------------------------------------------------------------------
// scrambleName
// ---------------------------------------------------------------------------

test('scrambleName keeps the same letters', () => {
  for (const name of ['Rebecca', 'Ada Lovelace', 'Mary-Jane', 'Anna', 'Zoë']) {
    const out = scrambleName(name, seeded(7));
    assert.equal(letters(out), letters(name), `${name} -> ${out}`);
  }
});

test('scrambleName differs from the name whenever that is possible', () => {
  const rand = seeded(42);
  for (let i = 0; i < 200; i++) {
    const out = scrambleName('Rebecca', rand);
    assert.notEqual(out.toLowerCase(), 'rebecca');
  }
  assert.notEqual(scrambleName('Anna', Math.random).toLowerCase(), 'anna');
});

test('scrambleName capitalises the first letter only', () => {
  for (let i = 1; i < 30; i++) {
    const out = scrambleName('rebecca', seeded(i));
    assert.equal(out[0], out[0].toUpperCase());
    assert.equal(out.slice(1), out.slice(1).toLowerCase());
  }
  const out = scrambleName('REBECCA', seeded(5));
  assert.equal(out[0], out[0].toUpperCase());
  assert.equal(out.slice(1), out.slice(1).toLowerCase());
});

test('scrambleName returns names of fewer than three letters unchanged', () => {
  assert.equal(scrambleName('Al'), 'Al');
  assert.equal(scrambleName('a'), 'a');
  assert.equal(scrambleName(''), '');
});

test('scrambleName returns a result with no arrangement difference when all letters are alike', () => {
  assert.equal(letters(scrambleName('Aaaa', seeded(9))), 'aaaa');
});

test('scrambleName is deterministic for a given random source', () => {
  assert.equal(scrambleName('Rebecca', seeded(11)), scrambleName('Rebecca', seeded(11)));
});
