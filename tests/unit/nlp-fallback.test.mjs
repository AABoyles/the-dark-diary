// js/nlp.js with compromise never loaded: the regex fallback only.
// Kept in its own file because module state is cached per process.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nlp from '../../js/nlp.js';

test('compromise is not ready and reflectClause yields null', () => {
  assert.equal(nlp.nlpReady(), false);
  assert.equal(nlp.reflectClause('I am tired of my job'), null);
  assert.equal(nlp.reflectClause(''), null);
});

test('regex extractFacts finds a person in a plain sentence', () => {
  const facts = nlp.extractFacts('My sister keeps lying to me');
  assert.deepEqual(facts, [{ topic: 'sister', phrase: 'My sister keeps lying to me', kind: 'person' }]);
});

test('regex extractFacts finds a feeling and an event', () => {
  const facts = nlp.extractFacts('I feel anxious about the wedding in Paris');
  assert.ok(facts.some((f) => f.topic === 'anxious' && f.kind === 'feeling'), JSON.stringify(facts));
  assert.ok(facts.some((f) => f.topic === 'wedding' && f.kind === 'event'), JSON.stringify(facts));
});

test('regex extractFacts finds a person and a thing across two clauses', () => {
  const facts = nlp.extractFacts('I think my boss is a bully and my dog hates him');
  assert.ok(facts.some((f) => f.topic === 'boss' && f.kind === 'person'), JSON.stringify(facts));
  assert.ok(facts.some((f) => f.topic === 'dog' && f.kind === 'thing'), JSON.stringify(facts));
});

test('regex extractFacts returns nothing for greetings and questions', () => {
  for (const text of ['Hello', 'ok', 'Are you real?']) {
    assert.deepEqual(nlp.extractFacts(text), [], text);
  }
});

test('regex extractFacts tolerates empty and missing input', () => {
  assert.deepEqual(nlp.extractFacts(''), []);
  assert.deepEqual(nlp.extractFacts(null), []);
  assert.deepEqual(nlp.extractFacts(undefined), []);
});
