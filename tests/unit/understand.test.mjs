// js/understand.js with compromise injected from node_modules (no network).
// The regex-only path runs in understand-fallback.test.mjs, because nlp.js keeps
// its module state per process.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import compromise from 'compromise';
import * as nlp from '../../js/nlp.js';
import { analyze } from '../../js/understand.js';

nlp.__setCompromiseForTest({ default: compromise });

const has = (list, value) => list.some((x) => x.toLowerCase() === value.toLowerCase());

// ---------------------------------------------------------------------------
// Negation
// ---------------------------------------------------------------------------

test('compromise is ready for these tests', () => {
  assert.equal(nlp.nlpReady(), true);
});

test('"i\'m not happy": negated, with happy as the negated content word', () => {
  const a = analyze("i'm not happy");
  assert.equal(a.negation, true);
  assert.deepEqual(a.negated, ['happy']);
});

test('"it\'s not that i hate him": the negation hits hate, not the pronouns', () => {
  const a = analyze("it's not that i hate him");
  assert.equal(a.negation, true);
  assert.deepEqual(a.negated, ['hate']);
});

test('"i don\'t feel anything": feel and anything are negated', () => {
  const a = analyze("i don't feel anything");
  assert.equal(a.negation, true);
  assert.ok(a.negated.includes('feel'), JSON.stringify(a.negated));
  assert.ok(a.negated.includes('anything'), JSON.stringify(a.negated));
});

test('"never again" is negated', () => {
  assert.equal(analyze('never again').negation, true);
});

test('"i\'m not going to reply": negated, and reply is in the scope', () => {
  const a = analyze("i'm not going to reply");
  assert.equal(a.negation, true);
  assert.ok(a.negated.includes('reply'), JSON.stringify(a.negated));
});

test('"i feel nothing at all": negated, and the feeling word is in scope', () => {
  const a = analyze('i feel nothing at all');
  assert.equal(a.negation, true);
  assert.ok(a.negated.includes('feel'), JSON.stringify(a.negated));
});

test('"i\'m not not happy" is any sensible answer, and does not throw', () => {
  const a = analyze("i'm not not happy");
  assert.equal(typeof a.negation, 'boolean');
  assert.ok(Array.isArray(a.negated));
});

test('a negation in a later clause still counts: "my dad and i haven\'t spoken"', () => {
  const a = analyze("my dad and i haven't spoken since march");
  assert.equal(a.negation, true);
  assert.ok(a.negated.includes('speak'), JSON.stringify(a.negated));
});

test('a negated later clause: "she says it\'s not a request"', () => {
  const a = analyze("she wants me home for sunday lunch and says it's not a request");
  assert.equal(a.negation, true);
  assert.ok(a.negated.includes('request'), JSON.stringify(a.negated));
});

test('"i was not sad, i was just tired": sad is negated, tired is not', () => {
  const a = analyze('i was not sad, i was just tired');
  assert.equal(a.negation, true);
  assert.ok(a.negated.includes('sad'));
  assert.ok(!a.negated.includes('tired'), JSON.stringify(a.negated));
});

test('"nobody called me today": negated', () => {
  assert.equal(analyze('nobody called me today').negation, true);
});

test('"i\'m never going to forgive her": forgive is negated', () => {
  const a = analyze("i'm never going to forgive her");
  assert.equal(a.negation, true);
  assert.ok(a.negated.includes('forgive'), JSON.stringify(a.negated));
});

test('"i am happy": no negation, nothing negated', () => {
  const a = analyze('i am happy');
  assert.equal(a.negation, false);
  assert.deepEqual(a.negated, []);
});

test('"i can\'t stop thinking about it": negated, and stop is in scope', () => {
  const a = analyze("i can't stop thinking about it");
  assert.equal(a.negation, true);
  assert.ok(a.negated.includes('stop'), JSON.stringify(a.negated));
});

// ---------------------------------------------------------------------------
// Tense
// ---------------------------------------------------------------------------

test('"i was fired yesterday" is past', () => {
  assert.equal(analyze('i was fired yesterday').tense, 'past');
});

test('"i\'m going to quit tomorrow" is future', () => {
  assert.equal(analyze("i'm going to quit tomorrow").tense, 'future');
});

test('"i will tell him" is future', () => {
  assert.equal(analyze('i will tell him').tense, 'future');
});

test('"gonna tell her next week" is future', () => {
  assert.equal(analyze('gonna tell her next week').tense, 'future');
});

test('"next week i start the new job" is future', () => {
  assert.equal(analyze('next week i start the new job').tense, 'future');
});

test('"i was going to quit" is past, not future', () => {
  assert.equal(analyze('i was going to quit').tense, 'past');
});

test('"my boss called yesterday" is past', () => {
  assert.equal(analyze('my boss called yesterday').tense, 'past');
});

test('"he sat in the car park" is past (irregular verb)', () => {
  assert.equal(analyze('he sat in the car park').tense, 'past');
});

test('"i feel tired today" is present', () => {
  assert.equal(analyze('i feel tired today').tense, 'present');
});

test('"i keep checking my phone" is present', () => {
  assert.equal(analyze('i keep checking my phone').tense, 'present');
});

test('"i\'m so bored" is present: bored is an adjective, not past tense', () => {
  assert.equal(analyze("i'm so bored").tense, 'present');
});

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

test('"are you real?" is about the diary', () => {
  assert.equal(analyze('are you real?').question, 'about-diary');
});

test('"do you think i\'m being rash" is about the diary', () => {
  assert.equal(analyze("do you think i'm being rash").question, 'about-diary');
});

test('"who are you" and "what are you" are about the diary', () => {
  assert.equal(analyze('who are you').question, 'about-diary');
  assert.equal(analyze('what are you').question, 'about-diary');
});

test('"did you eat?" is about the diary', () => {
  assert.equal(analyze('did you eat?').question, 'about-diary');
});

test('"am i too much?" is about the self', () => {
  assert.equal(analyze('am i too much?').question, 'about-self');
});

test('"should i call her" is about the self', () => {
  assert.equal(analyze('should i call her').question, 'about-self');
});

test('"why is the sky blue" is a general question', () => {
  assert.equal(analyze('why is the sky blue').question, 'general');
});

test('"is it going to rain?" is a general question', () => {
  assert.equal(analyze('is it going to rain?').question, 'general');
});

test('statements and exclamations are not questions', () => {
  for (const s of ['what a day', 'i feel fine', "can't stop replaying it", 'it is what it is']) {
    assert.equal(analyze(s).question, null, s);
  }
});

// ---------------------------------------------------------------------------
// Names and places
// ---------------------------------------------------------------------------

test('"my friend Dev said he\'d come": Dev is a name', () => {
  assert.ok(has(analyze("my friend Dev said he'd come").names, 'Dev'));
});

test('"Margaret called again": Margaret is a name', () => {
  assert.ok(has(analyze('Margaret called again').names, 'Margaret'));
});

test('"priya won\'t text back": lowercase name before a verb, returned capitalised', () => {
  const a = analyze("priya won't text back");
  assert.ok(a.names.includes('Priya'), JSON.stringify(a.names));
});

test('"I keep calling her Margaret in my head": a capitalised name mid-sentence', () => {
  assert.ok(has(analyze('I keep calling her Margaret in my head').names, 'Margaret'));
});

test('"Anna and I went to the house on Elm Street": Anna is a name, Elm Street a place', () => {
  const a = analyze('Anna and I went to the house on Elm Street');
  assert.ok(has(a.names, 'Anna'), JSON.stringify(a.names));
  assert.ok(has(a.places, 'Elm Street'), JSON.stringify(a.places));
});

test('"I live in Leeds with Anna": Leeds is a place, Anna a name', () => {
  const a = analyze('I live in Leeds with Anna');
  assert.ok(has(a.places, 'Leeds'), JSON.stringify(a.places));
  assert.ok(has(a.names, 'Anna'), JSON.stringify(a.names));
});

test('"I feel anxious about the wedding in Paris": Paris is a place', () => {
  assert.ok(has(analyze('I feel anxious about the wedding in Paris').places, 'Paris'));
});

test('relation nouns are not names: "my sister keeps lying to me"', () => {
  const a = analyze('my sister keeps lying to me');
  assert.deepEqual(a.names, []);
});

test('common words are not names: "Sunday lunch with mum"', () => {
  const a = analyze('Sunday lunch with mum');
  assert.ok(!has(a.names, 'Sunday'), JSON.stringify(a.names));
  assert.ok(!has(a.names, 'Mum'), JSON.stringify(a.names));
});

test('"I think my boss is a bully": no names', () => {
  assert.deepEqual(analyze('I think my boss is a bully').names, []);
});

test('"I\'m not sure about Rick": Rick is a name', () => {
  assert.ok(has(analyze("I'm not sure about Rick").names, 'Rick'));
});

// ---------------------------------------------------------------------------
// Topics and words
// ---------------------------------------------------------------------------

test('"my sister keeps lying to me": sister is a topic', () => {
  assert.ok(analyze('my sister keeps lying to me').topics.includes('sister'));
});

test('"I\'m so tired of my job and my boss": job and boss are topics, tired is not', () => {
  const { topics } = analyze("I'm so tired of my job and my boss");
  assert.ok(topics.includes('job'), JSON.stringify(topics));
  assert.ok(topics.includes('boss'), JSON.stringify(topics));
  assert.ok(!topics.includes('tired'), JSON.stringify(topics));
});

test('"the kids are driving me up the wall": kids becomes kid, in singular', () => {
  assert.ok(analyze('the kids are driving me up the wall').topics.includes('kid'));
});

test('topics are lowercase singular and at most five', () => {
  const { topics } = analyze(
    'The dog, the cat, the car, the bus, the train, the bike, the boat and the plane all went wrong',
  );
  assert.ok(topics.length <= 5, JSON.stringify(topics));
  for (const t of topics) assert.equal(t, t.toLowerCase());
});

test('word count is the number of words', () => {
  assert.equal(analyze('I am here').words, 3);
  assert.equal(analyze('  hello   there  friend ').words, 3);
  assert.equal(analyze("it's fine").words, 2);
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test('empty, whitespace and missing input give empty results', () => {
  const empty = {
    negation: false,
    negated: [],
    tense: 'present',
    question: null,
    names: [],
    places: [],
    topics: [],
    words: 0,
  };
  assert.deepEqual(analyze(''), empty);
  assert.deepEqual(analyze('   \n\t '), empty);
  assert.deepEqual(analyze(null), empty);
  assert.deepEqual(analyze(undefined), empty);
});

test('a non-string input does not throw', () => {
  assert.equal(analyze(12345).words, 1);
  assert.doesNotThrow(() => analyze({ toString() { throw new Error('x'); } }));
});

test('the result always has the documented shape', () => {
  const a = analyze('My dad died last spring and I still cannot sleep');
  assert.deepEqual(Object.keys(a).sort(), ['names', 'negated', 'negation', 'places', 'question', 'tense', 'topics', 'words']);
  assert.equal(typeof a.negation, 'boolean');
  assert.ok(['past', 'present', 'future'].includes(a.tense));
  assert.ok([null, 'about-diary', 'about-self', 'general'].includes(a.question));
});
