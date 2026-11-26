// js/nlp.js with compromise injected from node_modules (no network).
// The regex-only path runs in nlp-fallback.test.mjs, because module state is
// cached per process and this file leaves compromise loaded.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import compromise from 'compromise';
import * as nlp from '../../js/nlp.js';

test('before injection nothing is loaded and reflectClause yields null', () => {
  assert.equal(nlp.nlpReady(), false);
  assert.equal(nlp.reflectClause('I am tired of my job'), null);
});

test('injecting compromise marks NLP ready', () => {
  nlp.__setCompromiseForTest({ default: compromise });
  assert.equal(nlp.nlpReady(), true);
});

const REFLECTIONS = [
  ['I am tired of my job', 'You are tired of your job'],
  ['I want to leave', 'You want to leave'],
  ['I was so lonely after my move', 'You were so lonely after your move'],
  ['I have been lying to my mother', 'You have been lying to your mother'],
  ["I'm afraid of what I've done", 'You are afraid of what you have done'],
  ['you were right about my boss', 'I was right about your boss'],
  ['I feel nothing at all', 'You feel nothing at all'],
  ['my sister keeps lying to me', 'your sister keeps lying to you'],
];

for (const [input, expected] of REFLECTIONS) {
  test(`reflectClause: "${input}"`, () => {
    assert.equal(nlp.reflectClause(input), expected);
  });
}

test('reflectClause returns a string with no trailing whitespace', () => {
  const out = nlp.reflectClause('I am tired of my job and my boss');
  assert.equal(typeof out, 'string');
  assert.equal(out, out.trim());
});

// Each expectation: the topic words and kinds that must be present.
const FACTS = [
  {
    text: 'My sister keeps lying to me',
    want: [{ topic: 'sister', kind: 'person' }],
  },
  {
    text: 'I feel anxious about the wedding in Paris',
    want: [
      { topic: 'anxious', kind: 'feeling' },
      { topic: 'wedding', kind: 'event' },
      { topic: 'paris', kind: 'place' },
    ],
  },
  {
    text: 'Anna and I went to the house on Elm Street',
    want: [
      { topic: 'anna', kind: 'person' },
      { topic: 'elm street', kind: 'place' },
    ],
  },
  {
    text: 'I think my boss is a bully and my dog hates him',
    want: [
      { topic: 'boss', kind: 'person' },
      { topic: 'dog', kind: 'thing' },
    ],
  },
  {
    text: 'I am so tired of my job and my boss',
    want: [
      { topic: 'job', kind: 'thing' },
      { topic: 'boss', kind: 'person' },
      { topic: 'tired', kind: 'feeling' },
    ],
  },
];

for (const { text, want } of FACTS) {
  test(`extractFacts finds the people, places and things in "${text}"`, () => {
    const facts = nlp.extractFacts(text);
    for (const w of want) {
      assert.ok(
        facts.some((f) => f.topic === w.topic && f.kind === w.kind),
        `missing ${w.kind} "${w.topic}" in ${JSON.stringify(facts)}`,
      );
    }
    for (const f of facts) {
      assert.ok(text.toLowerCase().includes(f.topic), `topic "${f.topic}" comes from the text`);
      assert.equal(typeof f.phrase, 'string');
      assert.ok(f.phrase.length > 0);
    }
  });
}

test('extractFacts finds nothing in greetings, one-word replies or questions', () => {
  for (const text of ['Hello', 'ok', 'Are you real?']) {
    assert.deepEqual(nlp.extractFacts(text), [], text);
  }
});

test('extractFacts tolerates empty and missing input', () => {
  assert.deepEqual(nlp.extractFacts(''), []);
  assert.deepEqual(nlp.extractFacts(null), []);
  assert.deepEqual(nlp.extractFacts(undefined), []);
});
