// js/understand.js with compromise never loaded: the regex path only.
// Kept in its own file because nlp.js module state is cached per process.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nlp from '../../js/nlp.js';
import { analyze } from '../../js/understand.js';

const has = (list, value) => list.some((x) => x.toLowerCase() === value.toLowerCase());

test('compromise is not ready in this file', () => {
  assert.equal(nlp.nlpReady(), false);
});

test('negation works without compromise', () => {
  assert.deepEqual(analyze("i'm not happy").negated, ['happy']);
  assert.equal(analyze("i don't feel anything").negation, true);
  assert.equal(analyze('i am happy').negation, false);
  assert.equal(analyze("it's not that i hate him").negation, true);
});

test('tense works without compromise', () => {
  assert.equal(analyze('i was fired yesterday').tense, 'past');
  assert.equal(analyze("i'm going to quit tomorrow").tense, 'future');
  assert.equal(analyze('i feel tired today').tense, 'present');
  assert.equal(analyze('he sat in the car park').tense, 'past');
});

test('questions work without compromise', () => {
  assert.equal(analyze('are you real?').question, 'about-diary');
  assert.equal(analyze('should i call her').question, 'about-self');
  assert.equal(analyze('why is the sky blue').question, 'general');
  assert.equal(analyze('what a day').question, null);
});

test('regex names: "my friend Dev said he\'d come" and "Margaret called again"', () => {
  assert.ok(has(analyze("my friend Dev said he'd come").names, 'Dev'));
  assert.ok(has(analyze('Margaret called again').names, 'Margaret'));
});

test('regex names: a lowercase name before a verb is capitalised', () => {
  assert.ok(analyze("priya won't text back").names.includes('Priya'));
});

test('regex places: "in/at/to <Capitalised>"', () => {
  assert.ok(has(analyze('I live in Leeds with Anna').places, 'Leeds'));
  assert.ok(has(analyze('I feel anxious about the wedding in Paris').places, 'Paris'));
  assert.ok(has(analyze('Anna and I went to the house on Elm Street').places, 'Elm Street'));
});

test('regex names skip relation nouns and days', () => {
  assert.deepEqual(analyze('my sister keeps lying to me').names, []);
  assert.ok(!has(analyze('Sunday lunch with mum').names, 'Sunday'));
});

test('topics are regex word lists without compromise, lowercase singular', () => {
  const { topics } = analyze("I'm so tired of my job and my boss");
  assert.ok(topics.includes('job') && topics.includes('boss'), JSON.stringify(topics));
  assert.ok(!topics.includes('tired'));
  assert.ok(analyze('the kids are driving me up the wall').topics.includes('kid'));
});

test('empty input is safe without compromise', () => {
  const a = analyze('');
  assert.equal(a.words, 0);
  assert.deepEqual(a.names, []);
  assert.deepEqual(analyze(null).topics, []);
});
