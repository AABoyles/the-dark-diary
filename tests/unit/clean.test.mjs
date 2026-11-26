// js/clean.js: cleaning model output, and the streaming prefix used by issue #7.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clean, cleanTitle, streamPrefix } from '../../js/clean.js';

const SAMPLES = [
  'Diary: "Washing blood from a silk shirt. And you, darling, look as though your weekend was spent hoping no one would ask."',
  '*smiles thinly* Loneliness is a fine vintage (best savoured slowly). Which of your friends stopped answering first?',
  'Tired of your job. How very ordinary of you 😊. Tell me what it costs you, in detail.',
  'The word "silk" means something to me. Does it to you? Go on. I have all evening, and patience.',
  'One. Two. Three. Four sentences is too many for a diary of my refinement, surely.',
  '[pauses] - I see. **Interesting.** You are, as ever, predictable; and yet: here we are.',
  'A' + ' very'.repeat(80) + ' long sentence without end',
];

test('clean strips stage directions, labels, quotes, markdown and emoji', () => {
  assert.equal(clean(SAMPLES[0]), 'Washing blood from a silk shirt. And you, darling, look as though your weekend was spent hoping no one would ask.');
  assert.equal(clean(SAMPLES[1]), 'Loneliness is a fine vintage. Which of your friends stopped answering first?');
  assert.ok(!/[😊*()[\]#`]/u.test(clean(SAMPLES[2]) + clean(SAMPLES[5])));
});

test('clean caps replies at three sentences and ~260 characters', () => {
  assert.equal(clean(SAMPLES[4]), 'One. Two. Three.');
  const long = clean(SAMPLES[6]);
  assert.ok(long.length <= 262 && long.endsWith('…'));
});

test('cleanTitle gives one Title Case line without quotes or a period', () => {
  assert.equal(cleanTitle('Title: "a tedious confession, politely endured."\nmore'), 'A Tedious Confession, Politely Endured');
});

// Stream each sample in slices of every size from 1 char to whole words;
// what is shown must only ever grow, and must be a prefix of the final text.
function streamCheck(raw, chunker) {
  let shown = '';
  let buf = '';
  for (const piece of chunker(raw)) {
    buf += piece;
    const p = streamPrefix(buf);
    if (p.length > shown.length) {
      assert.ok(p.startsWith(shown), `non-monotone: ${JSON.stringify(shown)} -> ${JSON.stringify(p)}`);
      shown = p;
    }
  }
  const final = clean(raw);
  assert.ok(final.startsWith(shown), `shown ${JSON.stringify(shown)} is not a prefix of final ${JSON.stringify(final)}`);
  return shown;
}
const byChar = (s) => [...s];
const byCodeUnit = (s) => s.split('');
const byWord = (s) => s.match(/\S+\s*/g) || [];
const byN = (n) => (s) => s.match(new RegExp(`[\\s\\S]{1,${n}}`, 'g')) || [];

for (const [name, chunker] of [['char', byChar], ['code unit', byCodeUnit], ['word', byWord], ['3', byN(3)], ['7', byN(7)]]) {
  test(`streamPrefix keeps the prefix property (chunks: ${name})`, () => {
    for (const raw of SAMPLES) streamCheck(raw, chunker);
  });
}

test('streamPrefix never shows a speaker label, an unclosed stage direction or half a word', () => {
  assert.equal(streamPrefix('Diary:'), '');
  assert.equal(streamPrefix('Diary: "Washing blood from a'), 'Washing blood from');
  assert.equal(streamPrefix('Loneliness is a fine vintage (best sav'), 'Loneliness is a fine vintage');
  assert.equal(streamPrefix('Loneliness is a fine vintage *sips'), 'Loneliness is a fine vintage');
  assert.equal(streamPrefix('Loneliness is a fine vint'), 'Loneliness is a fine');
});
