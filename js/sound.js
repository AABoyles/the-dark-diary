// js/sound.js — optional ambient sound (issue #21).
//
// Everything is synthesized with the Web Audio API: no audio files, nothing to
// cache. Off by default. The preference lives in localStorage 'dd-sound'
// ('on' / 'off'). The AudioContext is only created once sound is switched on
// (from the toggle click, which is a user gesture). Without Web Audio, or
// outside a browser (Node), every export is a silent no-op and never throws.

const PREF_KEY = 'dd-sound';
const MASTER_LEVEL = 0.25;
const SCRATCH_GAP_MS = 45;
const MAX_STROKE_MS = 4000;

let memoryPref = false; // used when localStorage is blocked or missing
let ctx = null;
let master = null;
let noise = null; // one shared white-noise buffer, reused by every sound
let lastScratch = -Infinity;

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readPref() {
  try {
    const v = storage()?.getItem(PREF_KEY);
    if (v === 'on') return true;
    if (v === 'off') return false;
  } catch { /* blocked storage: fall back to memory */ }
  return memoryPref;
}

function audioContextCtor() {
  return globalThis.AudioContext || globalThis.webkitAudioContext || null;
}

function makeNoise(c) {
  const length = Math.floor(c.sampleRate * 2);
  const buffer = c.createBuffer(1, length, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// Returns the live audio graph when sound is on and Web Audio exists, else null.
function graph() {
  if (!readPref()) return null;
  if (!ctx) {
    const Ctor = audioContextCtor();
    if (!Ctor) return null;
    try {
      const c = new Ctor();
      const out = c.createGain();
      out.gain.value = MASTER_LEVEL;
      out.connect(c.destination);
      ctx = c;
      master = out;
      noise = makeNoise(c);
    } catch {
      ctx = null;
      master = null;
      noise = null;
      return null;
    }
  }
  return { ctx, master, noise };
}

function quietly(fn) {
  try {
    fn();
  } catch { /* sound must never break the diary */ }
}

function resume(c) {
  try {
    c.resume?.()?.catch?.(() => {});
  } catch { /* ignore */ }
}

function suspend(c) {
  try {
    c.suspend?.()?.catch?.(() => {});
  } catch { /* ignore */ }
}

// One short band-passed noise voice with an attack and exponential decay.
function voice(g, { at, dur, freq, q, peak, type = 'bandpass' }) {
  const { ctx: c, master: out, noise: buf } = g;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const amp = c.createGain();
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.linearRampToValueAtTime(peak, at + Math.min(0.004, dur * 0.2));
  amp.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(filter);
  filter.connect(amp);
  amp.connect(out);
  src.start(at, Math.random() * Math.max(0, buf.duration - dur), dur + 0.01);
  src.stop(at + dur + 0.02);
}

/** Enables or disables sound, persists the choice, and creates/resumes or suspends the context. */
export function setSoundEnabled(on) {
  const value = Boolean(on);
  memoryPref = value;
  try {
    storage()?.setItem(PREF_KEY, value ? 'on' : 'off');
  } catch { /* storage blocked: the in-memory value still applies */ }
  quietly(() => {
    if (value) {
      const g = graph();
      if (g) resume(g.ctx);
    } else if (ctx) {
      suspend(ctx);
    }
  });
}

/** True when the visitor has switched sound on. */
export function soundEnabled() {
  try {
    return readPref();
  } catch {
    return false;
  }
}

/** One tiny quill scratch. Throttled to at most one every 45 ms. */
export function scratch() {
  quietly(() => {
    const now = Date.now();
    if (now - lastScratch < SCRATCH_GAP_MS) return;
    const g = graph();
    if (!g) return;
    lastScratch = now;
    voice(g, {
      at: g.ctx.currentTime,
      dur: 0.025 + Math.random() * 0.015,
      freq: 2200 * (0.8 + Math.random() * 0.6),
      q: 1.4,
      peak: 0.12 * (0.6 + Math.random() * 0.5),
    });
  });
}

/** A continuous, softly modulated scratch for one doodle stroke. Capped at 4 s. */
export function strokeSound(durationMs) {
  quietly(() => {
    const ms = Number(durationMs);
    if (!Number.isFinite(ms) || ms <= 0) return;
    const g = graph();
    if (!g) return;
    const { ctx: c, master: out, noise: buf } = g;
    const t = c.currentTime;
    const end = t + Math.min(ms, MAX_STROKE_MS) / 1000;

    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1900;
    filter.Q.value = 0.8;

    // A slow wobble on the band's centre frequency keeps the scratch alive.
    const lfo = c.createOscillator();
    lfo.frequency.value = 3.5 + Math.random() * 2;
    const depth = c.createGain();
    depth.gain.value = 260;
    lfo.connect(depth);
    depth.connect(filter.frequency);

    const amp = c.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(0.07, t + 0.03);
    amp.gain.setValueAtTime(0.05, Math.max(t + 0.03, end - 0.12));
    amp.gain.linearRampToValueAtTime(0.0001, end);

    src.connect(filter);
    filter.connect(amp);
    amp.connect(out);
    src.start(t, Math.random() * Math.max(0, buf.duration - 1));
    src.stop(end + 0.02);
    lfo.start(t);
    lfo.stop(end + 0.02);
  });
}

/** A paper rustle (~350 ms) with a few amplitude bumps, for page turns. */
export function rustle() {
  quietly(() => {
    const g = graph();
    if (!g) return;
    const { ctx: c, master: out, noise: buf } = g;
    const t = c.currentTime;
    const dur = 0.35;

    const src = c.createBufferSource();
    src.buffer = buf;
    const high = c.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 1200;
    const low = c.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 5000;
    const amp = c.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    for (const [at, peak] of [[0.02, 0.14], [0.12, 0.1], [0.2, 0.16], [0.27, 0.07]]) {
      amp.gain.linearRampToValueAtTime(peak, t + at + 0.03);
      amp.gain.linearRampToValueAtTime(0.02, t + at + 0.06);
    }
    amp.gain.linearRampToValueAtTime(0.0001, t + dur);

    src.connect(high);
    high.connect(low);
    low.connect(amp);
    amp.connect(out);
    src.start(t, Math.random() * Math.max(0, buf.duration - dur), dur + 0.05);
    src.stop(t + dur + 0.05);
  });
}

/** The heavier leather-and-paper creak when the book opens (~600 ms). */
export function coverCreak() {
  quietly(() => {
    const g = graph();
    if (!g) return;
    const { ctx: c, master: out, noise: buf } = g;
    const t = c.currentTime;
    const dur = 0.6;

    const src = c.createBufferSource();
    src.buffer = buf;
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 3;
    filter.frequency.setValueAtTime(260, t);
    filter.frequency.linearRampToValueAtTime(420, t + 0.3);
    filter.frequency.linearRampToValueAtTime(220, t + dur);
    const amp = c.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(0.2, t + 0.08);
    amp.gain.linearRampToValueAtTime(0.12, t + 0.3);
    amp.gain.linearRampToValueAtTime(0.0001, t + dur);

    src.connect(filter);
    filter.connect(amp);
    amp.connect(out);
    src.start(t, Math.random() * Math.max(0, buf.duration - dur), dur + 0.05);
    src.stop(t + dur + 0.05);
  });
}

// The accessible name stays "Sound" (issue #41); aria-pressed carries the state,
// and the visible ": on"/": off" lives in an aria-hidden span.
function renderToggle(button, on) {
  const state = button.querySelector?.('.state');
  if (state) state.textContent = on ? ': on' : ': off';
  else button.textContent = on ? '♪ Sound: on' : '♪ Sound: off';
  button.setAttribute('aria-pressed', on ? 'true' : 'false');
}

/** Turns `button` into the sound toggle. A click flips the preference and plays a rustle when turning on. */
export function mountSoundToggle(button) {
  if (!button) return;
  renderToggle(button, soundEnabled());
  button.addEventListener('click', () => {
    const next = !soundEnabled();
    setSoundEnabled(next);
    renderToggle(button, next);
    if (next) rustle();
  });
}
