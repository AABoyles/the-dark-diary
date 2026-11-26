// retrieve.js and lines.js: LINES invariants, lexical and semantic retrieval,
// slot filling, exclusion, and the embedder-less path.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { LINES } from '../../js/lines.js';
import { lexicalCandidates, semanticCandidates, fillSlots } from '../../js/retrieve.js';

const EMOTIONS = ['grief', 'anger', 'fear', 'shame', 'boredom', 'delight', 'neutral'];
const TAGS = new Set(['invite', 'probe', 'observe', 'tease', 'comfort-oblique',
  'deny-call', 'plan', 'regret', 'evasive', 'about-diary']);
const REQUIRED_TOPICS = ['work', 'money', 'mother', 'father', 'sister', 'brother', 'children',
  'romance', 'friendship', 'loneliness', 'grief', 'fear', 'anger', 'boredom', 'joy', 'food',
  'sleep', 'school', 'health', 'pets', 'home', 'weather', 'holiday', 'secrets', 'ambition',
  'failure', 'diary', 'terse', 'denial', 'plans', 'regret'];

const topicHit = (results, topics, top = 3) =>
  results.slice(0, top).some((r) => topics.some((t) => r.line.topics.includes(t)));

describe('LINES invariants', () => {
  test('at least 600 lines', () => {
    assert.ok(LINES.length >= 600, `only ${LINES.length} lines`);
  });

  test('unique ids and unique texts', () => {
    assert.equal(new Set(LINES.map((l) => l.id)).size, LINES.length);
    assert.equal(new Set(LINES.map((l) => l.text)).size, LINES.length);
  });

  test('ids are kebab-case and every line has the required fields', () => {
    for (const l of LINES) {
      assert.match(l.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, l.id);
      assert.equal(typeof l.text, 'string');
      assert.ok(EMOTIONS.includes(l.emotion), `${l.id}: emotion ${l.emotion}`);
      assert.ok(Array.isArray(l.topics) && l.topics.length > 0, `${l.id}: topics`);
      assert.ok(l.topics.every((t) => /^[a-z]+$/.test(t)), `${l.id}: topic words`);
      assert.ok(Array.isArray(l.tags), `${l.id}: tags`);
      assert.ok(l.tags.every((t) => TAGS.has(t)), `${l.id}: unknown tag`);
    }
  });

  test("kind is 'q' exactly when the text ends with '?'", () => {
    for (const l of LINES) {
      assert.equal(l.kind, l.text.endsWith('?') ? 'q' : 's', l.id);
    }
  });

  test("at most 40% of lines are questions", () => {
    const q = LINES.filter((l) => l.kind === 'q').length;
    assert.ok(q / LINES.length <= 0.4, `${q} of ${LINES.length} are questions`);
  });

  test('every required topic has at least 15 lines', () => {
    for (const topic of REQUIRED_TOPICS) {
      const n = LINES.filter((l) => l.topics.includes(topic)).length;
      assert.ok(n >= 15, `${topic}: ${n} lines`);
    }
  });

  test('every emotion has at least 40 lines', () => {
    for (const emotion of EMOTIONS) {
      const n = LINES.filter((l) => l.emotion === emotion).length;
      assert.ok(n >= 40, `${emotion}: ${n} lines`);
    }
  });

  test('about 10% of lines use a slot, and slot lines contain their slot', () => {
    const slotLines = LINES.filter((l) => l.slots);
    assert.ok(slotLines.length >= LINES.length * 0.08, `${slotLines.length} slot lines`);
    for (const l of slotLines) {
      assert.ok(l.slots.length === 1 && ['name', 'topic'].includes(l.slots[0]), l.id);
      assert.ok(l.text.includes(`{${l.slots[0]}}`), `${l.id}: missing {${l.slots[0]}}`);
    }
    for (const l of LINES) {
      for (const m of l.text.matchAll(/\{(\w+)\}/g)) {
        assert.ok(l.slots?.includes(m[1]), `${l.id}: placeholder {${m[1]}} not declared`);
      }
    }
  });

  test('no line is over 45 words, and none uses a definition formula', () => {
    for (const l of LINES) {
      assert.ok(l.text.split(/\s+/).length <= 45, `${l.id} is too long`);
      assert.ok(!/which here means/i.test(l.text), `${l.id} defines a word`);
    }
  });

  test('every tag used by retrieval appears in the bank', () => {
    for (const tag of ['deny-call', 'plan', 'regret', 'about-diary', 'evasive']) {
      assert.ok(LINES.some((l) => l.tags.includes(tag)), `no ${tag} lines`);
    }
  });
});

describe('lexicalCandidates', () => {
  const samples = [
    ['my boss yelled at me again', ['work', 'boss']],
    ['I cannot pay the rent this month', ['money', 'rent']],
    ['my mum keeps ringing about Sunday', ['mother']],
    ['my dad is playing up again', ['father']],
    ['I think my sister hates me', ['sister']],
    ['my brother never calls', ['brother']],
    ['the breakup hurt more than I expected', ['romance', 'breakup']],
    ['my best friend ignored me', ['friendship', 'friend']],
    ['I feel so lonely in this flat', ['loneliness']],
    ['grandma died last week', ['grief']],
    ['I am so scared of the dentist', ['fear']],
    ['I am furious with him', ['anger']],
    ['I am bored out of my mind', ['boredom']],
    ['I got the job and I am so happy', ['joy', 'work']],
    ['the doctor says I need more tests', ['health']],
    ['my cat is being sick', ['pets']],
    ['we are moving house next month', ['home']],
    ['Christmas with the family was awful', ['holiday']],
    ['the weather has been grey all week', ['weather']],
    ['I failed again and I am useless', ['failure']],
  ];

  for (const [text, topics] of samples) {
    test(`topical lines for "${text}"`, () => {
      const results = lexicalCandidates(text, { k: 3 });
      assert.ok(results.length > 0, 'no results');
      assert.ok(topicHit(results, topics), `top 3 lack ${topics.join('/')}: ${results.map((r) => r.line.id).join(', ')}`);
    });
  }

  test('returned entries have line, filled text and a score in [0, 1]', () => {
    for (const r of lexicalCandidates('my boss yelled at me again', { k: 8 })) {
      assert.ok(r.line && typeof r.text === 'string');
      assert.ok(r.score >= 0 && r.score <= 1, `score ${r.score}`);
    }
  });

  test('results are sorted best first and capped at k', () => {
    const results = lexicalCandidates('my mother and my father argued about money', { k: 4 });
    assert.ok(results.length <= 4);
    for (let i = 1; i < results.length; i++) {
      assert.ok(results[i - 1].score >= results[i].score);
    }
  });

  test('respects exclude by template text and by filled text', () => {
    const first = lexicalCandidates('my boss yelled at me again', { k: 1 })[0];
    const byText = lexicalCandidates('my boss yelled at me again', { k: 8, exclude: new Set([first.line.text]) });
    assert.ok(!byText.some((r) => r.line.id === first.line.id));
    const byFilled = lexicalCandidates('my boss yelled at me again', { k: 8, exclude: new Set([first.text]) });
    assert.ok(!byFilled.some((r) => r.text === first.text));
  });

  test("evasive tag for 'ok'", () => {
    const results = lexicalCandidates('ok', { k: 5 });
    assert.ok(results.length > 0);
    assert.ok(results.every((r) => r.line.tags.includes('evasive') || r.line.topics.includes('terse')));
    assert.ok(results.slice(0, 3).some((r) => r.line.tags.includes('evasive')));
  });

  test('deny-call tag when the analysis flags negation', () => {
    const results = lexicalCandidates("no, I'm not upset", { analysis: { negation: true }, k: 5 });
    assert.ok(results.length > 0);
    assert.ok(results.slice(0, 3).every((r) => r.line.tags.includes('deny-call')));
  });

  test('plan and regret tags follow the tense analysis', () => {
    const plan = lexicalCandidates('next year', { analysis: { tense: 'future' }, k: 3 });
    assert.ok(plan.length > 0 && plan.every((r) => r.line.tags.includes('plan')));
    const regret = lexicalCandidates('back then', { analysis: { tense: 'past' }, k: 3 });
    assert.ok(regret.length > 0 && regret.every((r) => r.line.tags.includes('regret')));
  });

  test('about-diary tag follows the question analysis', () => {
    const results = lexicalCandidates('do you remember me', { analysis: { question: 'about-diary' }, k: 3 });
    assert.ok(results.length > 0);
    assert.ok(results.every((r) => r.line.tags.includes('about-diary')));
  });

  test('gibberish of several words scores nothing', () => {
    assert.deepEqual(lexicalCandidates('zxqv plm wbnr', { k: 5 }), []);
    assert.deepEqual(lexicalCandidates('', { k: 5 }), []);
  });

  test('emotion option is accepted as a string or an object', () => {
    const a = lexicalCandidates('my boss yelled at me again', { emotion: 'anger', k: 3 });
    const b = lexicalCandidates('my boss yelled at me again', { emotion: { emotion: 'anger' }, k: 3 });
    assert.deepEqual(a.map((r) => r.line.id), b.map((r) => r.line.id));
  });

  test('no placeholder survives in returned text, and slot lines need their slot', () => {
    const results = lexicalCandidates('my friend ignored me all week', { analysis: { names: ['Ruth'], topics: ['weather'] }, k: 30 });
    for (const r of results) {
      assert.ok(!/\{(name|topic)\}/.test(r.text), r.text);
    }
    const none = lexicalCandidates('my friend ignored me all week', { k: 30 });
    for (const r of none) {
      assert.ok(!r.line.slots, `${r.line.id} needs a slot but no analysis was given`);
    }
  });
});

describe('fillSlots', () => {
  const nameLine = LINES.find((l) => l.slots?.[0] === 'name');
  const topicLine = LINES.find((l) => l.slots?.[0] === 'topic');

  test('fills {name} with the given name', () => {
    const out = fillSlots(nameLine, { name: 'Ruth' });
    assert.equal(typeof out, 'string');
    assert.ok(out.includes('Ruth'));
    assert.ok(!out.includes('{name}'));
  });

  test('returns null when the name slot has no value', () => {
    assert.equal(fillSlots(nameLine), null);
    assert.equal(fillSlots(nameLine, { name: '   ' }), null);
    assert.equal(fillSlots(nameLine, { topic: 'garden' }), null);
  });

  test('fills {topic} with the given noun', () => {
    const out = fillSlots(topicLine, { topic: 'the garden' });
    assert.ok(out.includes('the garden'));
    assert.ok(!out.includes('{topic}'));
    assert.equal(fillSlots(topicLine, {}), null);
  });

  test('lines without slots come back unchanged', () => {
    const plain = LINES.find((l) => !l.slots);
    assert.equal(fillSlots(plain), plain.text);
  });
});

// A bag-of-words hashing embedder: deterministic and dependency-free.
function hashEmbed(texts) {
  return texts.map((t) => {
    const v = new Float32Array(512);
    for (const w of t.toLowerCase().match(/[a-z]+/g) ?? []) {
      let h = 0;
      for (const c of w) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      v[h % 512] += 1;
    }
    const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / n);
  });
}

describe('semanticCandidates', () => {
  test('returns null without an embedder', async () => {
    assert.equal(await semanticCandidates('hello there, friend'), null);
  });

  test('ranks a paraphrase line highly with a fake embedder', async () => {
    const results = await semanticCandidates(
      'people do not keep appointments like the sea does',
      { k: 3, embedFn: hashEmbed },
    );
    assert.ok(Array.isArray(results) && results.length > 0);
    assert.ok(results.some((r) => r.line.id === 'sea-appointments'),
      `top 3: ${results.map((r) => r.line.id).join(', ')}`);
    for (const r of results) assert.ok(r.score > 0 && r.score <= 1.0001);
  });

  test('respects exclude and returns filled text', async () => {
    const first = (await semanticCandidates('people do not keep appointments like the sea does', { k: 1, embedFn: hashEmbed }))[0];
    const again = await semanticCandidates('people do not keep appointments like the sea does', {
      k: 5, embedFn: hashEmbed, exclude: new Set([first.line.text]),
    });
    assert.ok(!again.some((r) => r.line.id === first.line.id));
    for (const r of again) assert.ok(!/\{(name|topic)\}/.test(r.text));
  });

  test('returns an empty list for blank text', async () => {
    assert.deepEqual(await semanticCandidates('   ', { embedFn: hashEmbed }), []);
  });

  test('returns null when the embedder fails', async () => {
    const broken = async () => { throw new Error('offline'); };
    assert.equal(await semanticCandidates('anything at all here', { embedFn: broken }), null);
  });
});
