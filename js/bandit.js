// bandit.js: learns which kind of reply keeps the writer writing.
//
// Each reply family (ELIZA scripts, retrieval, grammar, dialogue model) is an
// arm of a Bernoulli-style bandit. After a reply, the writer's next message is
// scored with engagementReward(); the score updates that family's Beta posterior.
// choose() uses Thompson sampling, and weights() gives bounded multipliers so the
// voice stays varied however lopsided the early data is.
//
// Everything is local. The state lives in localStorage under one key, or in
// whatever store the caller passes (memoryStore() in tests and the eval harness).
// Nothing here throws: storage access is wrapped in try/catch.

export const FAMILIES = ['eliza', 'retrieval', 'grammar', 'dialogue'];

const STORAGE_KEY = 'dd-bandit';
const TRIVIAL = new Set(['', 'ok', 'idk', 'k', 'fine', 'whatever']);
const HALF_WORDS = 12;   // a reply of this many words scores 0.5
const QUESTION_BONUS = 0.1;

// ---------------------------------------------------------------------------
// Reward
// ---------------------------------------------------------------------------

// Reward in [0, 1] for the writer's next message. Length saturates: about 0.5
// at 12 words and close to 1 by 40. A question or 'because' earns a small bonus.
// Empty or one-word dismissals score 0.
export function engagementReward(nextUserText) {
  const text = typeof nextUserText === 'string' ? nextUserText : '';
  const normalised = text.toLowerCase().replace(/[^a-z' ]+/g, ' ').trim();
  if (TRIVIAL.has(normalised)) return 0;
  const words = normalised.split(/\s+/).filter(Boolean);
  if (words.length === 0 || (words.length === 1 && TRIVIAL.has(words[0]))) return 0;
  const saturating = 1 - Math.pow(2, -words.length / HALF_WORDS);
  const bonus = (text.includes('?') || words.includes('because')) ? QUESTION_BONUS : 0;
  return Math.min(1, Math.max(0, saturating + bonus));
}

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

function clone(obj) {
  return JSON.parse(JSON.stringify(obj ?? {}));
}

// In-memory store, for tests and the eval harness.
export function memoryStore(initial = {}) {
  let state = clone(initial);
  return {
    load: () => clone(state),
    save: (obj) => { state = clone(obj); },
  };
}

// localStorage-backed store. Missing or blocked storage makes it a no-op.
export function localStore(key = STORAGE_KEY) {
  return {
    load() {
      try {
        if (typeof localStorage === 'undefined' || !localStorage) return {};
        const raw = localStorage.getItem(key);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch {
        return {};
      }
    },
    save(obj) {
      try {
        if (typeof localStorage === 'undefined' || !localStorage) return;
        localStorage.setItem(key, JSON.stringify(obj));
      } catch {
        // Storage full or blocked: learning simply does not persist.
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Beta sampling (Marsaglia and Tsang gamma, then a ratio of two gammas)
// ---------------------------------------------------------------------------

function uniform(rand) {
  const u = rand();
  return Math.min(1 - 1e-12, Math.max(1e-12, u));
}

function normal(rand) {
  const u1 = uniform(rand);
  const u2 = uniform(rand);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function gamma(shape, rand) {
  if (shape < 1) {
    // Boost: Gamma(a) = Gamma(a + 1) * U^(1/a).
    return gamma(shape + 1, rand) * Math.pow(uniform(rand), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x;
    let v;
    do {
      x = normal(rand);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = uniform(rand);
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

// One draw from Beta(a, b) using the supplied rand.
export function sampleBeta(a, b, rand = Math.random) {
  const x = gamma(a, rand);
  const y = gamma(b, rand);
  const total = x + y;
  return total > 0 ? x / total : 0.5;
}

// ---------------------------------------------------------------------------
// Bandit
// ---------------------------------------------------------------------------

function emptyArm() {
  return { n: 0, sum: 0 };
}

// Reads the stored state, keeping only known families with sane numbers.
function normaliseState(raw) {
  const state = {};
  for (const family of FAMILIES) {
    const arm = raw && typeof raw === 'object' ? raw[family] : null;
    const n = Number(arm?.n);
    const sum = Number(arm?.sum);
    if (Number.isFinite(n) && n >= 0 && Number.isFinite(sum) && sum >= 0) {
      state[family] = { n, sum: Math.min(sum, n) };
    } else {
      state[family] = emptyArm();
    }
  }
  return state;
}

export function createBandit(store = localStore(), { prior = 1, floor = 0.5, ceiling = 2 } = {}) {
  const posterior = (state, family) => {
    const { n, sum } = state[family];
    return { alpha: prior + sum, beta: prior + n - sum };
  };

  return {
    // Multipliers relative to uniform, per family in `available`. Their mean is
    // 1 before clipping; after clipping to [floor, ceiling] they stay close to 1.
    weights(available = FAMILIES) {
      const state = normaliseState(store.load());
      const families = available.filter((f) => FAMILIES.includes(f));
      if (families.length === 0) return {};
      const means = families.map((f) => {
        const { alpha, beta } = posterior(state, f);
        return alpha / (alpha + beta);
      });
      const avg = means.reduce((s, m) => s + m, 0) / means.length;
      const out = {};
      families.forEach((f, i) => {
        const raw = avg > 0 ? means[i] / avg : 1;
        out[f] = Math.min(ceiling, Math.max(floor, raw));
      });
      return out;
    },

    // Thompson sampling: one Beta draw per family, highest draw wins.
    // Returns null when no known family is offered.
    choose(available = FAMILIES, rand = Math.random) {
      const state = normaliseState(store.load());
      const families = available.filter((f) => FAMILIES.includes(f));
      let best = null;
      let bestDraw = -Infinity;
      for (const family of families) {
        const { alpha, beta } = posterior(state, family);
        const draw = sampleBeta(alpha, beta, rand);
        if (draw > bestDraw) {
          bestDraw = draw;
          best = family;
        }
      }
      return best;
    },

    // Records a reward in [0, 1] for a family and persists the state.
    update(family, reward) {
      if (!FAMILIES.includes(family)) return;
      const r = Number(reward);
      if (!Number.isFinite(r)) return;
      const clamped = Math.min(1, Math.max(0, r));
      const state = normaliseState(store.load());
      state[family] = {
        n: state[family].n + 1,
        sum: state[family].sum + clamped,
      };
      store.save(state);
    },

    snapshot() {
      return normaliseState(store.load());
    },
  };
}
