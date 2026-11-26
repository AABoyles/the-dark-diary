// The conversation harness (issue #38): hard floors hold, and runs are deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import compromise from 'compromise';
import { evaluate, floors } from '../../eval/harness.mjs';

test('the fallback engine holds every hard floor on the corpus', async () => {
  const { metrics } = await evaluate({ compromise });
  assert.deepEqual(floors(metrics), []);
  assert.ok(metrics.turns >= 300, `corpus too small: ${metrics.turns} turns`);
  assert.ok(metrics.crisisTurns >= 3, 'the corpus must exercise the crisis path');
  assert.deepEqual(metrics.hyperboleFalseAlarms, [], 'dark hyperbole must not trigger the crisis reply');
});

test('the same seed gives the same metrics', async () => {
  const a = await evaluate({ compromise, seed: 7 });
  const b = await evaluate({ compromise, seed: 7 });
  assert.deepEqual(a.metrics, b.metrics);
});

test('the regex fallbacks (no compromise) hold the floors too', async () => {
  const { metrics } = await evaluate({ compromise: null });
  assert.deepEqual(floors(metrics), []);
});
