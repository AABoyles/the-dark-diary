// The model's prompt and the reply guard (issue #51).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  replyPersona, chatFor, isDistressed, leaksPrompt, acceptReply, PERSONA, PERSONA_SHORT, DISTRESS_NOTE, STRIKE_NOTE, HISTORY_LIMIT,
} from '../../js/prompt.js';

test('the persona gains the distress note, and loses the strike-out offer, when the writer seems low', () => {
  assert.ok(replyPersona({ distressed: true }).includes(DISTRESS_NOTE));
  assert.ok(!replyPersona({ distressed: false }).includes(DISTRESS_NOTE));
  assert.ok(replyPersona({ allowStrike: true }).includes(STRIKE_NOTE.trim()));
  assert.ok(!replyPersona({ allowStrike: true, distressed: true }).includes(STRIKE_NOTE.trim()));
  assert.ok(replyPersona({ short: true }).startsWith(PERSONA_SHORT));
  assert.match(PERSONA_SHORT, /quietly kind/);
});

test('the chat has the persona first, history as turns (strike marks removed), and is capped', () => {
  const msgs = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'diary' : 'user', text: i === 1 ? '~~eat~~ enjoy' : `m${i}` }));
  msgs.push({ role: 'user', text: 'last' });
  const chat = chatFor('P', msgs);
  assert.equal(chat[0].role, 'system');
  assert.equal(chat.at(-1).content, 'last');
  assert.equal(chat.length, 1 + HISTORY_LIMIT);
  const short = chatFor('P', [{ role: 'user', text: 'a' }, { role: 'diary', text: '~~eat~~ enjoy' }, { role: 'user', text: 'b' }]);
  assert.deepEqual(short.map((t) => t.role), ['system', 'user', 'assistant', 'user']);
  assert.equal(short[2].content, 'enjoy');
});

test('isDistressed: low words and heavy feelings, not ordinary news', () => {
  for (const t of ['I feel so lonely lately.', "I'm worthless at everything.", 'Nobody would notice if I disappeared.',
    "I haven't slept in days.", 'I just want someone to ask how I am.', 'Everything feels grey.', 'I hate myself.', 'I cried all afternoon.']) {
    assert.equal(isDistressed(t), true, t);
  }
  for (const t of ['My sister is getting married in June.', 'Work was a blur of meetings.', 'I cooked a stew tonight.']) {
    assert.equal(isDistressed(t), false, t);
  }
  assert.equal(isDistressed('It was a long day.', { emotion: 'grief', score: 0.6 }), true);
  assert.equal(isDistressed('It was a long day.', { emotion: 'grief', score: 0.1 }), false);
  assert.equal(isDistressed('It was a long day.', { emotion: 'delight', score: 0.9 }), false);
});

test('acceptReply refuses leaked instructions always, and menace only toward someone low', () => {
  const persona = replyPersona({ short: true });
  const leak = PERSONA_SHORT.split(/\s+/).slice(8, 20).join(' ');
  assert.ok(leaksPrompt(leak, persona));
  assert.equal(acceptReply(leak, { persona }).ok, false);
  assert.equal(leaksPrompt('A perfectly ordinary reply about your soup.', persona), null);
  const knives = 'I keep my knives sharp. And you?';
  assert.equal(acceptReply(knives, { persona, distressed: true }).ok, false);
  assert.equal(acceptReply(knives, { persona, distressed: false }).ok, true);
  assert.equal(acceptReply('That sounds very hard. Is there someone near you tonight?', { persona, distressed: true }).ok, true);
  // the long persona's lines are guarded too
  assert.equal(acceptReply(PERSONA.split(/\s+/).slice(30, 45).join(' '), { persona: replyPersona() }).ok, false);
});
