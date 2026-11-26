// Dialogue state and follow-up moves (GitHub issue #32).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import compromise from 'compromise';
import { dialogueState, dialogueMoves } from '../../js/dialogue.js';
import { __setCompromiseForTest } from '../../js/nlp.js';
import { CONVERSATIONS } from '../../eval/corpus.mjs';

const u = (text) => ({ role: 'user', text });
const d = (text) => ({ role: 'diary', text });

// Deterministic pseudo-random numbers in [0, 1) (mulberry32).
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const threadOf = (text) => dialogueState([u(text)]).thread;
const valueOf = (text) => (threadOf(text) || {}).value ?? null;

// Every move text the engine could make over a range of random draws.
function allMoveTexts(state) {
  const texts = [];
  for (let i = 0; i < 40; i += 1) {
    for (const m of dialogueMoves(state, { rand: seeded(i) })) texts.push(m);
  }
  return texts;
}

const BAD = /\{|\}|\bundefined\b|\bnull\b|\s{2,}|\bthe your\b|\bthe my\b|\byour Dev\b|\bthe the\b/;

// ---------------------------------------------------------------------------
// Thread extraction
// ---------------------------------------------------------------------------

test('a relation is reflected into the second person', () => {
  assert.deepEqual(threadOf('my sister is getting married in june'),
    { kind: 'person', value: 'your sister', since: 1 });
  assert.equal(valueOf('MY SISTER is driving me up the wall'), 'your sister');
  assert.equal(valueOf('my mom thinks i should have seen it coming'), 'your mom');
  assert.equal(valueOf("my boss won't stop emailing me"), 'your boss');
  assert.equal(valueOf('ngl my sis is unbearable'), 'your sis');
});

test('a capitalised name after a verb of speech or contact is a person', () => {
  assert.deepEqual(threadOf('she said Dev was useless'), { kind: 'person', value: 'Dev', since: 1 });
  assert.equal(valueOf('i rang Margaret twice'), 'Margaret');
  assert.equal(valueOf('got a text from Priya'), 'Priya');
});

test('a name opening a sentence is a person, capitalised or in lowercase slang', () => {
  assert.equal(valueOf('Dev texted me at midnight'), 'Dev');
  assert.equal(valueOf('dev texted me at midnight'), 'Dev');
  assert.equal(valueOf("priya won't text back"), 'Priya');
  assert.equal(valueOf('Margaret called again'), 'Margaret');
});

test('a sentence-opening word that is not a name is not a person', () => {
  assert.equal(valueOf('the weather is grim today'), null);
  assert.equal(valueOf('Honestly is a word I dislike'), null);
  assert.equal(valueOf('cat is fine'), null);
});

test('plural relations are not threads', () => {
  assert.equal(valueOf('the kids have been home for a week'), null);
  assert.equal(valueOf('my parents called again'), null);
});

test('events: a firing, a failed exam and a named interview', () => {
  assert.deepEqual(threadOf('i got fired yesterday'), { kind: 'event', value: 'the firing', since: 1 });
  assert.equal(valueOf('failed my exam again'), 'your exam');
  assert.equal(valueOf('the interview went badly'), 'the interview');
  assert.equal(valueOf('we broke up on sunday'), 'the breakup');
});

test('topics: a noun after have, got or lost, and a possessive noun', () => {
  assert.deepEqual(threadOf('had a rough week'), { kind: 'topic', value: 'the week', since: 1 });
  assert.equal(valueOf('my job is killing me'), 'your job');
  assert.equal(valueOf('i really love my flat'), 'your flat');
});

test('a person outranks an event or topic in the same message', () => {
  assert.equal(valueOf('my sister and my job are a mess'), 'your sister');
});

test('the thread is the newest raised within the last three user turns', () => {
  const state = dialogueState([u('my sister is ill'), d('Go on.'), u('the rain again'),
    d('What happened?'), u('idk'), d('Go on.'), u('my job is awful')]);
  assert.deepEqual(state.thread, { kind: 'topic', value: 'your job', since: 4 });
});

test('a thread older than the last three user turns is dropped', () => {
  const state = dialogueState([u('my sister is ill'), d('Go on.'), u('the rain'), d('Go on.'),
    u('the wind'), d('Go on.'), u('the sky')]);
  assert.equal(state.turn, 4);
  assert.equal(state.thread, null);
});

test('since counts user turns from 1', () => {
  const state = dialogueState([u('my sister'), d('Go on.'), u('idk')]);
  assert.equal(state.thread.since, 1);
  assert.equal(state.turn, 2);
});

test('with compromise loaded the same people are found', () => {
  __setCompromiseForTest({ default: compromise });
  try {
    assert.equal(valueOf('my sister is getting married'), 'your sister');
    assert.equal(valueOf('Dev texted me at midnight'), 'Dev');
    assert.equal(valueOf('i got fired yesterday'), 'the firing');
  } finally {
    __setCompromiseForTest(null);
  }
});

// ---------------------------------------------------------------------------
// Dodged questions
// ---------------------------------------------------------------------------

test('a yes or no answer is not a dodge', () => {
  const yes = dialogueState([d('Did you tell her?'), u('Yes, I did.')]);
  assert.equal(yes.dodged, false);
  const no = dialogueState([u('a'), d('Did you tell her?'), u('No.')]);
  assert.equal(no.dodged, false);
});

test('a reason is not a dodge', () => {
  const s = dialogueState([u('ok'), d('Why do you think that?'), u('because I am tired')]);
  assert.equal(s.dodged, false);
});

test('a reply that shares a content word is not a dodge', () => {
  const s = dialogueState([d('What did your sister say, exactly?'), u('She said I should call first.')]);
  assert.equal(s.lastDiaryQuestion, 'What did your sister say, exactly?');
  assert.equal(s.dodged, false);
});

test('idk, whatever and no idea are dodges', () => {
  assert.equal(dialogueState([d('What did your sister say, exactly?'), u('idk')]).dodged, true);
  assert.equal(dialogueState([d('What happened?'), u('whatever')]).dodged, true);
  assert.equal(dialogueState([d('What happened?'), u('no idea')]).dodged, true);
});

test('changing the subject to something unrelated is a dodge', () => {
  const s = dialogueState([d('How are you sleeping?'), u('anyway the rent is due on the first')]);
  assert.equal(s.dodged, true);
});

test('no dodge without a diary question', () => {
  assert.equal(dialogueState([d('Go on.'), u('idk')]).dodged, false);
  assert.equal(dialogueState([d('Go on.'), u('idk')]).lastDiaryQuestion, null);
});

test('an empty reply is not counted as a dodge', () => {
  assert.equal(dialogueState([d('What happened?'), u('')]).dodged, false);
});

test('lastDiaryQuestion is the diary message before the newest user message, if it ends in ?', () => {
  const s = dialogueState([u('my job'), d('What happened?'), u('idk'), d('Go on.'), u('fine')]);
  assert.equal(s.lastDiaryQuestion, null);
  assert.equal(dialogueState([u('x'), d('Who is there?'), u('me')]).lastDiaryQuestion, 'Who is there?');
});

// ---------------------------------------------------------------------------
// Abandoned threads
// ---------------------------------------------------------------------------

test('a person raised twice, then dropped for two turns while talking about other things, is abandoned', () => {
  const s = dialogueState([
    u('my father never called'), d('Go on.'),
    u('my father and i do not speak'), d('What happened?'),
    u('the weather is grim this week'), d('Go on.'),
    u('my job is awful and the bus was late again'), d('What happened?'),
    u('the rent is due on the first and the cat wants feeding'),
  ]);
  assert.deepEqual(s.abandoned, { value: 'your father', turnsAgo: 3 });
});

test('one mention is not abandoned', () => {
  const s = dialogueState([u('my father never called'), d('Go on.'), u('the weather is grim this week'),
    d('Go on.'), u('the rent is due on the first and the cat wants feeding')]);
  assert.equal(s.abandoned, null);
});

test('a thread still mentioned in the last two turns is not abandoned', () => {
  const s = dialogueState([u('my father never called'), d('Go on.'), u('my father again'),
    d('Go on.'), u('the rent is due on the first'), d('Go on.'), u('my father once more')]);
  assert.equal(s.abandoned, null);
});

test('a thread is not abandoned when the last two turns say nothing', () => {
  const s = dialogueState([u('my father never called'), d('Go on.'), u('my father and i do not speak'),
    d('Go on.'), u('the weather is grim this week'), d('Go on.'), u('ok'), d('Go on.'), u('idk')]);
  assert.equal(s.abandoned, null);
});

test('an event dropped after two mentions is abandoned', () => {
  const s = dialogueState([u('the interview was at nine'), d('Go on.'), u('the interview was a farce'),
    d('Go on.'), u('the bus was late again today'), d('Go on.'), u('the rent is due on the first'),
    d('Go on.'), u('the cat wants feeding and the bins are full')]);
  assert.deepEqual(s.abandoned, { value: 'the interview', turnsAgo: 3 });
});

test('a topic that is not a person or event is never abandoned', () => {
  const s = dialogueState([u('my job is awful'), d('Go on.'), u('my job is still awful'), d('Go on.'),
    u('the rain is cold this week'), d('Go on.'), u('the rent is due on the first')]);
  assert.equal(s.abandoned, null);
});

// ---------------------------------------------------------------------------
// The diary's own lines
// ---------------------------------------------------------------------------

test('lastMoves names the move each diary line matches, or other', () => {
  const s = dialogueState([u('x'), d('We were discussing your father, before you changed the subject.'),
    u('ok then'), d('Pray tell, what is the weather like?'), u('grim')]);
  assert.deepEqual(s.lastMoves, ['abandoned', 'other']);
  assert.equal(s.diaryTexts.length, 2);
});

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

test('a dodge yields a dodged move, and q reflects a question', () => {
  const s = dialogueState([d('What happened?'), u('idk')]);
  const moves = dialogueMoves(s, { rand: () => 0.85 });
  assert.equal(moves.length, 1);
  assert.equal(moves[0].kind, 'dodged');
  assert.equal(moves[0].q, true);
  assert.equal(moves[0].text, 'Not an answer, but a very elegant one. Shall we try the question again?');
});

test('a follow-up probes a name in the newest turn, grammatically', () => {
  const s = dialogueState([u('Dev texted me at midnight'), d('Go on.'), u('anyway the rent is due')]);
  const moves = dialogueMoves(s, { rand: () => 0 });
  const follow = moves.find((m) => m.kind === 'follow-up');
  assert.ok(follow, 'expected a follow-up');
  assert.ok(follow.text.includes('Dev'));
  assert.ok(!follow.text.includes('your Dev'));
});

test('no follow-up once the thread is two or more turns old', () => {
  const s = dialogueState([u('my sister is ill'), d('Go on.'), u('the rain again'), d('Go on.'), u('the wind')]);
  assert.equal(dialogueMoves(s, { rand: () => 0 }).some((m) => m.kind === 'follow-up'), false);
});

test('every move is grammatical for a name, a relation, an event and a topic', () => {
  const transcripts = [
    [u('Dev texted me at midnight'), d('Go on.'), u('anyway the rent')],
    [u('my sister is getting married'), d('Go on.'), u('anyway the rent')],
    [u('the interview went badly'), d('Go on.'), u('anyway the rent')],
    [u('had a rough week'), d('Go on.'), u('anyway the rent')],
  ];
  for (const msgs of transcripts) {
    for (const m of allMoveTexts(dialogueState(msgs))) {
      assert.doesNotMatch(m.text, BAD, `bad grammar in "${m.text}"`);
    }
  }
});

test('an event value is used without doubling its article', () => {
  const s = dialogueState([u('the interview went badly'), d('Go on.'), u('anyway the rent')]);
  const texts = allMoveTexts(s).map((m) => m.text);
  assert.ok(texts.some((t) => t.includes('the interview')), 'expected the interview in a move');
  assert.ok(texts.every((t) => !/the the/.test(t)));
});

test('a move from the previous diary line is not repeated in a row', () => {
  const s = {
    turn: 3, thread: { kind: 'person', value: 'your sister', since: 2 }, lastDiaryQuestion: null,
    dodged: false, abandoned: null, lastMoves: ['other', 'follow-up'],
    diaryTexts: ['Your sister again. Tell me what your sister wants from you.'],
  };
  assert.deepEqual(dialogueMoves(s, { rand: () => 0 }), []);
});

test('no dodged move on consecutive diary turns', () => {
  const s = {
    turn: 3, thread: null, lastDiaryQuestion: null, dodged: true, abandoned: null,
    lastMoves: ['dodged'], diaryTexts: ["You didn't answer me. I noticed."],
  };
  assert.deepEqual(dialogueMoves(s), []);
});

test('at most two dodged moves per transcript', () => {
  const base = { turn: 6, thread: null, lastDiaryQuestion: 'x?', dodged: true, abandoned: null };
  const two = { ...base, lastMoves: ['dodged', 'other', 'dodged', 'other'],
    diaryTexts: ["You didn't answer me. I noticed.", 'Go on.', 'Noted, and filed under the things you would rather not say.', 'Go on.'] };
  assert.equal(dialogueMoves(two).some((m) => m.kind === 'dodged'), false);
  const one = { ...base, lastMoves: ['dodged', 'other'], diaryTexts: ["You didn't answer me. I noticed.", 'Go on.'] };
  assert.equal(dialogueMoves(one).some((m) => m.kind === 'dodged'), true);
});

test('an abandoned thread is named at most once per value', () => {
  const used = ['We were discussing your father, before you changed the subject.'];
  const same = { turn: 6, thread: null, lastDiaryQuestion: null, dodged: false,
    abandoned: { value: 'your father', turnsAgo: 3 }, lastMoves: ['abandoned', 'other'], diaryTexts: used };
  assert.equal(dialogueMoves(same).some((m) => m.kind === 'abandoned'), false);
  const other = { ...same, abandoned: { value: 'your mother', turnsAgo: 3 } };
  assert.equal(dialogueMoves(other).some((m) => m.kind === 'abandoned'), true);
});

test('a follow-up probes a thread value at most once', () => {
  const s = {
    turn: 3, thread: { kind: 'person', value: 'your sister', since: 3 }, lastDiaryQuestion: null,
    dodged: false, abandoned: null, lastMoves: ['other', 'follow-up'],
    diaryTexts: ['Your sister again. Tell me what your sister wants from you.', 'Go on.'],
  };
  assert.equal(dialogueMoves(s).some((m) => m.kind === 'follow-up'), false);
});

test('no move repeats a line already in the transcript', () => {
  const used = ["You didn't answer me. I noticed.", 'Dev again. Tell me what Dev wants from you.'];
  const s = {
    turn: 3, thread: { kind: 'person', value: 'Dev', since: 3 }, lastDiaryQuestion: 'x?',
    dodged: true, abandoned: { value: 'Dev', turnsAgo: 3 }, lastMoves: ['other', 'other'],
    diaryTexts: used,
  };
  for (let i = 0; i < 100; i += 1) {
    for (const m of dialogueMoves(s, { rand: seeded(i) })) {
      assert.ok(!used.some((line) => line.includes(m.text)), `repeated: ${m.text}`);
    }
  }
});

test('every move text is clean for every thread kind', () => {
  const states = [
    { turn: 3, thread: { kind: 'person', value: 'Dev', since: 3 }, dodged: true, lastDiaryQuestion: 'x?',
      abandoned: { value: 'your father', turnsAgo: 2 }, lastMoves: [], diaryTexts: [] },
    { turn: 3, thread: { kind: 'event', value: 'the interview', since: 3 }, dodged: false,
      lastDiaryQuestion: null, abandoned: null, lastMoves: [], diaryTexts: [] },
    { turn: 3, thread: { kind: 'topic', value: 'your job', since: 2 }, dodged: false,
      lastDiaryQuestion: null, abandoned: null, lastMoves: [], diaryTexts: [] },
  ];
  for (const s of states) {
    for (const m of allMoveTexts(s)) {
      assert.doesNotMatch(m.text, BAD, `bad text "${m.text}"`);
      assert.equal(typeof m.q, 'boolean');
    }
  }
});

test('empty and single-message transcripts yield no moves', () => {
  assert.deepEqual(dialogueMoves(dialogueState([])), []);
  assert.deepEqual(dialogueMoves(dialogueState([u('hello there friend')])), []);
  assert.equal(dialogueState([]).turn, 0);
  assert.equal(dialogueState([]).thread, null);
});

test('malformed input never throws', () => {
  assert.equal(dialogueState(null).turn, 0);
  assert.equal(dialogueState([null, 'x', { role: 'user' }]).turn, 1);
  assert.deepEqual(dialogueMoves(null), []);
  assert.deepEqual(dialogueMoves({}), []);
});

// ---------------------------------------------------------------------------
// The conversation corpus, turn by turn
// ---------------------------------------------------------------------------

function clean(moves) {
  for (const m of moves) {
    assert.ok(m.text.length > 0, 'empty move');
    assert.doesNotMatch(m.text, BAD, `bad text "${m.text}"`);
  }
}

test('every corpus conversation runs turn by turn with placeholder replies', () => {
  let moveCount = 0;
  for (const conv of CONVERSATIONS) {
    const messages = [];
    conv.turns.forEach((text, i) => {
      messages.push(u(text));
      const state = dialogueState(messages);
      const moves = dialogueMoves(state, { rand: seeded(i) });
      clean(moves);
      moveCount += moves.length;
      messages.push(d(i % 2 === 0 ? 'Go on.' : 'What happened?'));
    });
  }
  assert.ok(moveCount > 0, 'the corpus should produce some moves');
});

test('greedy replies over the corpus keep the rate limits', () => {
  for (const conv of CONVERSATIONS) {
    const messages = [];
    const kinds = [];
    let turnIndex = 0;
    for (const text of conv.turns) {
      messages.push(u(text));
      turnIndex += 1;
      const state = dialogueState(messages);
      const moves = dialogueMoves(state, { rand: seeded(turnIndex) });
      clean(moves);
      const reply = moves.length ? moves[0] : null;
      if (reply) {
        assert.notEqual(kinds[kinds.length - 1], reply.kind, `${conv.id}: ${reply.kind} twice in a row`);
        kinds.push(reply.kind);
        messages.push(d(reply.text));
      } else {
        kinds.push('other');
        messages.push(d(turnIndex % 2 ? 'Go on.' : 'What happened?'));
      }
    }
    assert.ok(kinds.filter((k) => k === 'dodged').length <= 2, `${conv.id}: too many dodges`);
    const values = dialogueState(messages).lastMoves;
    assert.ok(values.length === kinds.length);
  }
});

test('with compromise loaded, every corpus thread is still a clean value', () => {
  __setCompromiseForTest({ default: compromise });
  try {
    for (const conv of CONVERSATIONS) {
      const messages = [];
      conv.turns.forEach((text, i) => {
        messages.push(u(text));
        const t = dialogueState(messages).thread;
        assert.ok(t === null || (typeof t.value === 'string' && t.value.length > 0), `${conv.id} turn ${i}`);
        if (t) assert.doesNotMatch(t.value, BAD, `${conv.id} turn ${i}`);
      });
    }
  } finally {
    __setCompromiseForTest(null);
  }
});
