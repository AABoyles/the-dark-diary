// Struck-through words: markup parsing, stripping, limiting and insertion.
//
// maybeStrike is tested with an injected rand, so every result is deterministic.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  STRIKE_PAIRS,
  hasStrike,
  stripStrikes,
  limitStrikes,
  parseStrikes,
  maybeStrike,
} from '../../js/strike.js';

const ELIZA_SOURCE = readFileSync(new URL('../../js/eliza.js', import.meta.url), 'utf8');
const ALWAYS = () => 0;     // rand that always passes any chance
const NEVER = () => 0.999;  // rand that never passes the default chance

// ---------------------------------------------------------------------------
// STRIKE_PAIRS
// ---------------------------------------------------------------------------

test('STRIKE_PAIRS has at least thirty gentle-to-cruel pairs', () => {
  assert.ok(Object.keys(STRIKE_PAIRS).length >= 30, `${Object.keys(STRIKE_PAIRS).length} pairs`);
});

test('STRIKE_PAIRS maps lower-case gentle words to distinct, non-empty cruel words', () => {
  const cruelWords = new Set();
  for (const [gentle, cruel] of Object.entries(STRIKE_PAIRS)) {
    assert.equal(gentle, gentle.toLowerCase(), `${gentle} is lower case`);
    assert.equal(typeof cruel, 'string', `${gentle} maps to a string`);
    assert.ok(cruel.trim().length > 0, `${gentle} has a cruel word`);
    assert.notEqual(cruel, gentle, `${gentle} is not mapped to itself`);
    assert.ok(!cruelWords.has(cruel), `${cruel} is used once`);
    cruelWords.add(cruel);
  }
});

test('every gentle key appears as a whole word in the diary replies', () => {
  for (const gentle of Object.keys(STRIKE_PAIRS)) {
    const words = gentle.split(' ').join('\\s+');
    const pattern = new RegExp(`\\b${words}\\b`, 'i');
    assert.match(ELIZA_SOURCE, pattern, `"${gentle}" occurs in js/eliza.js`);
  }
});

test('STRIKE_PAIRS is frozen', () => {
  assert.ok(Object.isFrozen(STRIKE_PAIRS));
});

// ---------------------------------------------------------------------------
// hasStrike
// ---------------------------------------------------------------------------

test('hasStrike is true only for a complete ~~x~~ pair', () => {
  assert.equal(hasStrike('I would ~~devour~~ enjoy hearing more.'), true);
  assert.equal(hasStrike('~~a~~'), true);
  assert.equal(hasStrike('plain text'), false);
  assert.equal(hasStrike('a stray ~~ marker'), false);
  assert.equal(hasStrike('two stray ~~ and ~~ markers'), true, 'a later pair counts');
  assert.equal(hasStrike('~~~~'), false, 'empty markers are not a pair');
  assert.equal(hasStrike(''), false);
});

test('hasStrike is false for anything that is not a string', () => {
  for (const value of [null, undefined, 42, {}, ['~~a~~']]) {
    assert.equal(hasStrike(value), false, JSON.stringify(value));
  }
});

// ---------------------------------------------------------------------------
// stripStrikes
// ---------------------------------------------------------------------------

test('stripStrikes removes the struck word and one following space', () => {
  assert.equal(stripStrikes('I would ~~devour~~ enjoy hearing more.'), 'I would enjoy hearing more.');
});

test('stripStrikes removes every pair, not just the first', () => {
  assert.equal(stripStrikes('~~a~~ one ~~b~~ two'), 'one two');
});

test('stripStrikes handles a pair with no following space and a pair at the end', () => {
  assert.equal(stripStrikes('~~devour~~enjoy'), 'enjoy');
  assert.equal(stripStrikes('go ~~devour~~'), 'go ');
});

test('stripStrikes drops stray unmatched markers', () => {
  assert.equal(stripStrikes('a~~ b'), 'a b');
  assert.equal(stripStrikes('x~~y'), 'xy');
});

test('stripStrikes returns plain text unchanged and empty for non-strings', () => {
  assert.equal(stripStrikes('nothing to see.'), 'nothing to see.');
  assert.equal(stripStrikes(null), '');
  assert.equal(stripStrikes(undefined), '');
});

// ---------------------------------------------------------------------------
// limitStrikes
// ---------------------------------------------------------------------------

test('limitStrikes keeps only the first strike by default', () => {
  assert.equal(limitStrikes('~~a~~ x ~~b~~ y ~~c~~ z'), '~~a~~ x y z');
});

test('limitStrikes keeps the first max strikes exactly as written', () => {
  assert.equal(limitStrikes('~~a~~ x ~~b~~ y ~~c~~ z', 2), '~~a~~ x ~~b~~ y z');
  assert.equal(limitStrikes('~~a~~ b ~~c~~ d', 1), '~~a~~ b d');
});

test('limitStrikes with max 0 strips every strike', () => {
  assert.equal(limitStrikes('~~a~~ x ~~b~~ y', 0), 'x y');
});

test('limitStrikes leaves text with no more strikes than allowed untouched', () => {
  assert.equal(limitStrikes('~~a~~ x', 3), '~~a~~ x');
  assert.equal(limitStrikes('no strike here'), 'no strike here');
});

test('limitStrikes drops stray markers too', () => {
  assert.equal(limitStrikes('~~a~~ x ~~'), '~~a~~ x ');
});

test('limitStrikes output keeps at most max strikes', () => {
  const text = '~~a~~ 1 ~~b~~ 2 ~~c~~ 3 ~~d~~ 4';
  for (let max = 0; max <= 4; max++) {
    const pairs = (limitStrikes(text, max).match(/~~[^~]+?~~/g) || []).length;
    assert.equal(pairs, max);
  }
});

// ---------------------------------------------------------------------------
// parseStrikes
// ---------------------------------------------------------------------------

test('parseStrikes splits the spec example into plain, struck and plain segments', () => {
  assert.deepEqual(parseStrikes('I would ~~devour~~ enjoy hearing more.'), [
    { text: 'I would ', struck: false },
    { text: 'devour', struck: true },
    { text: ' enjoy hearing more.', struck: false },
  ]);
});

test('parseStrikes returns a single plain segment when there is no strike', () => {
  assert.deepEqual(parseStrikes('just words'), [{ text: 'just words', struck: false }]);
});

test('parseStrikes returns no segments for empty input', () => {
  assert.deepEqual(parseStrikes(''), []);
  assert.deepEqual(parseStrikes(null), []);
});

test('parseStrikes puts a leading strike first and handles adjacent strikes', () => {
  assert.deepEqual(parseStrikes('~~devour~~ enjoy'), [
    { text: 'devour', struck: true },
    { text: ' enjoy', struck: false },
  ]);
  assert.deepEqual(parseStrikes('~~a~~~~b~~'), [
    { text: 'a', struck: true },
    { text: 'b', struck: true },
  ]);
});

test('parseStrikes merges adjacent plain text and drops stray markers', () => {
  assert.deepEqual(parseStrikes('a ~~ b'), [{ text: 'a  b', struck: false }]);
  assert.deepEqual(parseStrikes('a ~~x~~ ~~ b'), [
    { text: 'a ', struck: false },
    { text: 'x', struck: true },
    { text: '  b', struck: false },
  ]);
});

test('parseStrikes never returns an empty segment', () => {
  const samples = ['~~a~~', '~~a~~ ~~b~~ ~~c~~', '', 'x ~~ y ~~z~~ ~~', '~~ a ~~ tail'];
  for (const text of samples) {
    for (const segment of parseStrikes(text)) {
      assert.ok(segment.text.length > 0, `empty segment from "${text}"`);
    }
  }
});

test('parseStrikes segments rebuild the text without its markers', () => {
  const samples = [
    'I would ~~devour~~ enjoy hearing more.',
    '~~a~~~~b~~ c',
    'start ~~one~~ middle ~~two~~ end',
    'plain only',
    'a ~~ b',
  ];
  for (const text of samples) {
    const rebuilt = parseStrikes(text).map((s) => s.text).join('');
    assert.equal(rebuilt, text.replace(/~~/g, ''), `rebuilt "${text}"`);
  }
});

test('parseStrikes marks only the crossed-out words as struck', () => {
  const segments = parseStrikes('~~devour~~ enjoy the ~~feast~~ kindly');
  const struck = segments.filter((s) => s.struck).map((s) => s.text);
  assert.deepEqual(struck, ['devour', 'feast']);
});

// ---------------------------------------------------------------------------
// Round trips
// ---------------------------------------------------------------------------

test('limitStrikes then stripStrikes equals stripStrikes alone', () => {
  const samples = ['~~a~~ x ~~b~~ y', 'plain', '~~a~~ ~~b~~ ~~c~~ end', 'stray ~~ here ~~a~~ z'];
  for (const text of samples) {
    assert.equal(stripStrikes(limitStrikes(text, 1)), stripStrikes(text), `"${text}"`);
  }
});

test('a strike inserted by maybeStrike parses back to the cruel word', () => {
  const out = maybeStrike('I would enjoy hearing more.', { rand: ALWAYS });
  const struck = parseStrikes(out).filter((s) => s.struck).map((s) => s.text);
  assert.deepEqual(struck, ['devour']);
  assert.equal(stripStrikes(out), 'I would enjoy hearing more.');
});

// ---------------------------------------------------------------------------
// maybeStrike: basics
// ---------------------------------------------------------------------------

test('maybeStrike inserts the cruel word before the gentle one', () => {
  assert.equal(
    maybeStrike('I would enjoy hearing more.', { rand: ALWAYS }),
    'I would ~~devour~~ enjoy hearing more.',
  );
});

test('maybeStrike returns the text unchanged when rand does not pass chance', () => {
  const text = 'I would enjoy hearing more.';
  assert.equal(maybeStrike(text, { rand: NEVER }), text);
});

test('maybeStrike returns the text unchanged when there is no gentle key', () => {
  const text = 'Nothing sinister in this sentence at all.';
  assert.equal(maybeStrike(text, { rand: ALWAYS }), text);
});

test('maybeStrike does not add a second strike to text that has one', () => {
  const text = 'I would ~~devour~~ enjoy hearing more.';
  assert.equal(maybeStrike(text, { rand: ALWAYS }), text);
});

test('maybeStrike does not call rand when the text already has a strike', () => {
  let calls = 0;
  maybeStrike('~~a~~ enjoy', { rand: () => { calls += 1; return 0; } });
  assert.equal(calls, 0);
});

test('maybeStrike returns non-string input unchanged', () => {
  assert.equal(maybeStrike(null, { rand: ALWAYS }), null);
  assert.equal(maybeStrike(undefined, { rand: ALWAYS }), undefined);
});

test('maybeStrike uses the default chance and Math.random when no options are given', () => {
  const text = 'I would enjoy hearing more.';
  const out = maybeStrike(text);
  assert.ok(out === text || out === 'I would ~~devour~~ enjoy hearing more.', out);
});

// ---------------------------------------------------------------------------
// maybeStrike: word boundaries, case, key choice
// ---------------------------------------------------------------------------

test('maybeStrike matches whole words only', () => {
  assert.equal(maybeStrike('Her enjoyment was plain.', { rand: ALWAYS }), 'Her enjoyment was plain.');
  assert.equal(maybeStrike('Keeping quiet is wise.', { rand: ALWAYS }), 'Keeping quiet is wise.');
  assert.equal(maybeStrike('Helpful people stay.', { rand: ALWAYS }), 'Helpful people ~~roost~~ stay.');
});

test('maybeStrike matches case-insensitively and keeps the capital', () => {
  assert.equal(maybeStrike('Enjoy the evening.', { rand: ALWAYS }), '~~Devour~~ Enjoy the evening.');
  assert.equal(maybeStrike('ENJOY the evening.', { rand: ALWAYS }), '~~DEVOUR~~ ENJOY the evening.');
  assert.equal(maybeStrike('enjoy the evening.', { rand: ALWAYS }), '~~devour~~ enjoy the evening.');
});

test('maybeStrike keeps the capital of a gentle word that starts a sentence', () => {
  assert.equal(maybeStrike('Keep, please.', { rand: ALWAYS }), '~~Bury~~ Keep, please.');
});

test('maybeStrike picks the first gentle key in the text', () => {
  assert.equal(
    maybeStrike('Help me keep it safe.', { rand: ALWAYS }),
    '~~Harvest~~ Help me keep it safe.',
  );
  assert.equal(
    maybeStrike('I wish you would help and keep.', { rand: ALWAYS }),
    'I wish you would ~~harvest~~ help and keep.',
  );
});

test('maybeStrike prefers the longer phrase key when keys overlap', () => {
  assert.equal(
    maybeStrike('Do come back soon.', { rand: ALWAYS }),
    'Do ~~return for seconds~~ come back soon.',
  );
  assert.equal(
    maybeStrike('Do Come   Back soon.', { rand: ALWAYS }),
    'Do ~~Return for seconds~~ Come   Back soon.',
  );
});

test('maybeStrike uses the gentle word with the expected cruel partner', () => {
  for (const [gentle, cruel] of Object.entries(STRIKE_PAIRS)) {
    const out = maybeStrike(`We may ${gentle} this.`, { rand: ALWAYS });
    assert.equal(out, `We may ~~${cruel}~~ ${gentle} this.`, gentle);
  }
});

// ---------------------------------------------------------------------------
// maybeStrike: recent diary suppression
// ---------------------------------------------------------------------------

test('maybeStrike is suppressed by a strike in any of the last four diary lines', () => {
  const text = 'I would enjoy hearing more.';
  for (let position = 1; position <= 4; position++) {
    const recent = ['plain one', 'plain two', 'plain three', 'plain four'];
    recent[4 - position] = 'I would ~~devour~~ enjoy it.';
    assert.equal(maybeStrike(text, { recentDiary: recent, rand: ALWAYS }), text, `position ${position}`);
  }
});

test('maybeStrike ignores a strike older than the last four diary lines', () => {
  const recent = ['I would ~~devour~~ enjoy it.', 'a', 'b', 'c', 'd'];
  assert.equal(
    maybeStrike('I would enjoy hearing more.', { recentDiary: recent, rand: ALWAYS }),
    'I would ~~devour~~ enjoy hearing more.',
  );
});

test('maybeStrike does not call rand when recent diary lines suppress it', () => {
  let calls = 0;
  maybeStrike('I would enjoy hearing more.', {
    recentDiary: ['~~a~~ b'],
    rand: () => { calls += 1; return 0; },
  });
  assert.equal(calls, 0);
});

test('maybeStrike tolerates non-string recent diary entries', () => {
  const out = maybeStrike('I would enjoy hearing more.', {
    recentDiary: [null, 42, undefined, 'plain'],
    rand: ALWAYS,
  });
  assert.equal(out, 'I would ~~devour~~ enjoy hearing more.');
});

// ---------------------------------------------------------------------------
// maybeStrike: chance
// ---------------------------------------------------------------------------

test('maybeStrike passes only when rand is strictly below chance', () => {
  const text = 'I would enjoy hearing more.';
  assert.notEqual(maybeStrike(text, { rand: () => 0.14, chance: 0.15 }), text);
  assert.equal(maybeStrike(text, { rand: () => 0.15, chance: 0.15 }), text);
});

test('maybeStrike defaults to a chance of 0.15 over many seeded draws', () => {
  let seed = 1234;
  const rand = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return seed / 0x80000000;
  };
  const text = 'I would enjoy hearing more.';
  let struck = 0;
  const runs = 4000;
  for (let i = 0; i < runs; i++) {
    if (hasStrike(maybeStrike(text, { rand }))) struck += 1;
  }
  const share = struck / runs;
  assert.ok(share > 0.12 && share < 0.18, `struck ${(share * 100).toFixed(1)}% of draws`);
});

test('maybeStrike honours a custom chance of zero and one', () => {
  const text = 'I would enjoy hearing more.';
  assert.equal(maybeStrike(text, { rand: () => 0, chance: 0 }), text);
  assert.notEqual(maybeStrike(text, { rand: () => 0.999, chance: 1 }), text);
});
