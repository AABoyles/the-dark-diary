// js/fallback.js: the scripted title and reply used when no model is available.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { scriptedTitle, scriptedReply } from '../../js/fallback.js';

let realRandom;
before(() => {
  realRandom = Math.random;
  let a = 99991;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
});
after(() => {
  Math.random = realRandom;
});

// Words that may stay lower case inside a title.
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'nor', 'of', 'on', 'or', 'the', 'to']);

function assertTitleShape(title, label) {
  assert.equal(typeof title, 'string', `${label}: string`);
  const words = title.trim().split(/\s+/);
  assert.ok(words.length >= 3 && words.length <= 8, `${label}: ${words.length} words in "${title}"`);
  assert.doesNotMatch(title, /["'“”‘’]/, `${label}: no quotes in "${title}"`);
  assert.doesNotMatch(title, /\.$/, `${label}: no final period in "${title}"`);
  words.forEach((w, i) => {
    const first = w.match(/[A-Za-z]/);
    if (!first) return;
    const capitalised = first[0] === first[0].toUpperCase();
    if (i === 0 || i === words.length - 1) {
      assert.ok(capitalised, `${label}: first and last word capitalised in "${title}"`);
    } else if (!SMALL_WORDS.has(w.toLowerCase())) {
      assert.ok(capitalised, `${label}: "${w}" capitalised in "${title}"`);
    }
  });
}

const INPUTS = [
  'my job is awful',
  'I miss my mother',
  'the rain again, ugh',
  'hello there',
  'nothing happened today',
  'I am so tired of the weekend',
  'my sister keeps lying to me',
  'anything about the dog',
  'bills, rent and the phone',
  'x',
];

test('titles from many inputs are three to eight words, title case, unquoted, unpunctuated', () => {
  for (const text of INPUTS) {
    for (let run = 0; run < 40; run++) {
      const title = scriptedTitle([{ role: 'user', text }]);
      assertTitleShape(title, `"${text}" run ${run}`);
    }
  }
});

test('every topic noun yields a well-formed title', () => {
  const nouns = ['job', 'boss', 'mother', 'sister', 'rain', 'weekend', 'dog', 'house', 'wedding',
    'loneliness', 'birthdays', 'bills', 'email', 'music'];
  for (const n of nouns) {
    for (let run = 0; run < 12; run++) {
      assertTitleShape(scriptedTitle([{ role: 'user', text: `about my ${n}` }]), n);
    }
  }
});

test('a title is still produced for empty or malformed transcripts', () => {
  for (const messages of [undefined, null, [], 'nope', [{ role: 'diary', text: 'hi' }], [{ role: 'user', text: '' }]]) {
    const title = scriptedTitle(messages);
    assert.equal(typeof title, 'string');
    assert.ok(title.trim().length > 0);
  }
});

test('scriptedReply answers from the transcript', () => {
  const reply = scriptedReply([{ role: 'user', text: 'I am tired of my job' }]);
  assert.equal(typeof reply, 'string');
  assert.ok(reply.length > 0);
});

test('scriptedReply forwards a rewrite from ctx to the engine', () => {
  for (let run = 0; run < 20; run++) {
    const reply = scriptedReply([{ role: 'user', text: 'xqzv plmk tuoe' }], { rewrite: 'I am tired of my job' });
    assert.match(reply, /job/i, `run ${run}: "${reply}"`);
  }
});

test('scriptedReply forwards recollections from ctx to the engine', () => {
  const recs = [{ phrase: 'my sister keeps lying to me', topic: 'sister', kind: 'person', daysAgo: 1 }];
  for (let run = 0; run < 20; run++) {
    const reply = scriptedReply([{ role: 'user', text: 'my sister again' }], { recollections: recs });
    assert.match(reply, /sister/i, `run ${run}: "${reply}"`);
  }
});

test('scriptedReply with no arguments or null ctx still answers', () => {
  assert.equal(typeof scriptedReply(), 'string');
  assert.ok(scriptedReply().length > 0);
  assert.ok(scriptedReply([{ role: 'user', text: 'hello' }], null).length > 0);
});
