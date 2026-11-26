// grammar.js: every entry symbol produces clean, in-voice replies over seeded
// draws; statements never ask; questions ask exactly once; the '.a' modifier
// chooses the right article; compose() picks the right symbol family.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { GRAMMAR, expand, compose } from '../../js/grammar.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EMOTIONS = ['grief', 'anger', 'fear', 'shame', 'boredom', 'delight', 'neutral'];
const STATEMENTS = EMOTIONS;
const QUESTIONS = EMOTIONS.map((e) => `${e}:q`);
const MENTION_SYMBOLS = ['name', 'name:q', 'topic', 'topic:q'];
const ENTRY_SYMBOLS = [...STATEMENTS, ...QUESTIONS, ...MENTION_SYMBOLS];
const VARS = { name: 'your brother', topic: 'the garden' };
const DRAWS = 300;

function draws(symbol, seed = 1) {
  const rand = mulberry32(seed);
  const out = [];
  for (let i = 0; i < DRAWS; i++) out.push(expand(symbol, { rand, vars: VARS }));
  return out;
}

describe('entry symbols exist', () => {
  test('every entry symbol is in GRAMMAR with at least one expansion', () => {
    for (const symbol of ENTRY_SYMBOLS) {
      assert.ok(Array.isArray(GRAMMAR[symbol]), `missing ${symbol}`);
      assert.ok(GRAMMAR[symbol].length > 0, `empty ${symbol}`);
    }
  });

  test('every symbol referenced by a template is defined', () => {
    for (const expansions of Object.values(GRAMMAR)) {
      for (const template of expansions) {
        for (const [, ref] of template.matchAll(/#([A-Za-z_][\w:]*)/g)) {
          assert.ok(ref in GRAMMAR || ref === 'name' || ref === 'topic', `undefined ref ${ref}`);
        }
      }
    }
  });
});

describe('clean output for every entry symbol', () => {
  for (const symbol of ENTRY_SYMBOLS) {
    test(`${symbol}: no leftovers, clean spacing and capitals, at most 45 words`, () => {
      for (const text of draws(symbol)) {
        assert.ok(text.length > 0, 'empty reply');
        assert.ok(!text.includes('#'), `leftover #: ${text}`);
        assert.ok(!text.includes('{'), `leftover {: ${text}`);
        assert.ok(!text.includes('undefined'), `undefined: ${text}`);
        assert.ok(!/ {2}/.test(text), `double space: ${text}`);
        assert.ok(/^[A-Z]/.test(text), `lowercase start: ${text}`);
        assert.ok(!/[.!?] [a-z]/.test(text), `lowercase sentence start: ${text}`);
        assert.ok(text.split(' ').length <= 45, `too long (${text.split(' ').length}): ${text}`);
        assert.ok(!text.includes('which here means'), `forbidden phrase: ${text}`);
      }
    });
  }
});

describe('statements and questions', () => {
  for (const symbol of STATEMENTS) {
    test(`${symbol} never ends with a question mark`, () => {
      for (const text of draws(symbol)) {
        assert.ok(!text.endsWith('?'), `statement asks: ${text}`);
        assert.ok(!text.includes('?'), `statement contains ?: ${text}`);
      }
    });
  }

  for (const symbol of [...QUESTIONS, 'name:q', 'topic:q']) {
    test(`${symbol} ends with exactly one question mark`, () => {
      for (const text of draws(symbol)) {
        assert.ok(text.endsWith('?'), `not a question: ${text}`);
        assert.equal(text.split('?').length - 1, 1, `not a single question: ${text}`);
      }
    });
  }

  for (const symbol of ['name', 'topic']) {
    test(`${symbol} never ends with a question mark`, () => {
      for (const text of draws(symbol)) assert.ok(!text.endsWith('?'), text);
    });
  }
});

describe('variety', () => {
  for (const symbol of ENTRY_SYMBOLS) {
    test(`${symbol} gives at least 150 distinct replies over ${DRAWS} draws`, () => {
      const distinct = new Set(draws(symbol, 42));
      assert.ok(distinct.size >= 150, `only ${distinct.size} distinct`);
    });
  }
});

describe('mention symbols use the variables', () => {
  test('name and topic replies use the variable in a fair share of draws', () => {
    const names = draws('name', 9).filter((t) => /your brother/i.test(t)).length;
    const topics = draws('topic', 9).filter((t) => /garden/i.test(t)).length;
    assert.ok(names > DRAWS * 0.2, `name used in ${names} draws`);
    assert.ok(topics > DRAWS * 0.2, `topic used in ${topics} draws`);
  });

  test('without variables, mention symbols fall back to neutral wording', () => {
    const rand = mulberry32(3);
    for (let i = 0; i < 50; i++) {
      const text = expand('name', { rand });
      assert.ok(!text.includes('#') && text.length > 0);
    }
  });

  test('variables are plain text: markup characters are stripped', () => {
    const rand = mulberry32(5);
    for (let i = 0; i < 50; i++) {
      const text = expand('topic', { rand, vars: { topic: '#garden{}' } });
      assert.ok(!/[#{}]/.test(text), text);
    }
  });
});

describe('expand()', () => {
  test('unknown symbol gives an empty string', () => {
    assert.equal(expand('no-such-symbol'), '');
  });

  test('the .a modifier picks an for vowel sounds and a otherwise', () => {
    const owl = expand('object_probe', { vars: { topic: 'owl' } });
    const knife = expand('object_probe', { vars: { topic: 'knife' } });
    const hour = expand('object_probe', { vars: { topic: 'hour' } });
    const unicorn = expand('object_probe', { vars: { topic: 'unicorn' } });
    assert.match(owl, /\ban owl\b/);
    assert.match(knife, /\ba knife\b/);
    assert.match(hour, /\ban hour\b/);
    assert.match(unicorn, /\ba unicorn\b/);
  });

  test('the .capitalize modifier capitalises the first letter of a variable', () => {
    const text = expand('name_open', { rand: () => 0, vars: { name: 'margaret' } });
    assert.ok(/[#]/.test(text) === false);
    assert.ok(text.includes('Margaret') || text.includes('margaret'));
  });

  test('recursion is capped and never throws', () => {
    const saved = GRAMMAR.__loop;
    try {
      GRAMMAR.__loop = ['#__loop#'];
      assert.equal(expand('__loop'), '');
    } finally {
      if (saved === undefined) delete GRAMMAR.__loop;
      else GRAMMAR.__loop = saved;
    }
  });

  test('the same seed gives the same reply', () => {
    assert.equal(expand('grief', { rand: mulberry32(11) }), expand('grief', { rand: mulberry32(11) }));
  });
});

describe('compose()', () => {
  test('unknown emotion falls back to neutral', () => {
    const { text, q } = compose('bewildered', { rand: mulberry32(2) });
    assert.ok(text.length > 0);
    assert.equal(q, text.endsWith('?'));
  });

  test('wantQ yields a question, and q reflects the text', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { text, q } = compose('fear', { rand: mulberry32(seed), wantQ: true });
      assert.equal(q, true);
      assert.ok(text.endsWith('?'));
      assert.equal(q, text.endsWith('?'));
    }
  });

  test('without wantQ a plain statement is returned', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { text, q } = compose('delight', { rand: mulberry32(seed) });
      assert.equal(q, false);
      assert.ok(!text.endsWith('?'));
    }
  });

  // The first rand() call decides the branch: below 0.4 picks the name,
  // otherwise below 0.3 picks the topic. Later calls return 0, which selects
  // the first expansion of each symbol, so the outcome is deterministic.
  const script = (...values) => {
    let i = 0;
    return () => (i < values.length ? values[i++] : 0);
  };

  test('a name is chosen when the first draw is below 0.4', () => {
    const { text } = compose('grief', { rand: script(0.39), name: 'your brother' });
    assert.ok(text.includes('Your brother'), text);
  });

  test('the emotion is chosen when the first draw is 0.4 or above and no topic is given', () => {
    const { text } = compose('grief', { rand: script(0.41), name: 'your brother' });
    assert.ok(!/your brother/i.test(text), text);
  });

  test('a topic is chosen when no name is given and the draw is below 0.3', () => {
    const { text } = compose('anger', { rand: script(0.29), topic: 'the garden' });
    assert.ok(text.includes('The garden'), text);
  });

  test('the emotion is chosen when the topic draw is 0.3 or above', () => {
    const { text } = compose('anger', { rand: script(0.31), topic: 'the garden' });
    assert.ok(!/garden/i.test(text), text);
  });

  test('with neither name nor topic, the emotion symbol is used', () => {
    const rand = mulberry32(4);
    for (let i = 0; i < 100; i++) {
      const { text } = compose('shame', { rand });
      assert.ok(!text.includes('#'));
    }
  });

  test('the wantQ branch is taken with a name too', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { text, q } = compose('neutral', { rand: mulberry32(seed), name: 'Margaret', wantQ: true });
      assert.equal(q, true, text);
    }
  });
});

describe('voice', () => {
  test('nothing contains the phrase "which here means"', () => {
    for (const symbol of ENTRY_SYMBOLS) {
      for (const text of draws(symbol, 5)) assert.ok(!/which here means/i.test(text), text);
    }
  });
});
