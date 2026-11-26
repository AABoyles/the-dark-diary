// js/sound.js: every export is safe in Node (no window, no AudioContext), the
// preference defaults to off and persists, the toggle button follows the state,
// and scratch() is throttled. Browser globals are stubbed and restored.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  soundEnabled, setSoundEnabled, scratch, strokeSound, rustle, coverCreak, mountSoundToggle,
} from '../../js/sound.js';

const originals = {
  localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'),
  AudioContext: Object.getOwnPropertyDescriptor(globalThis, 'AudioContext'),
  webkitAudioContext: Object.getOwnPropertyDescriptor(globalThis, 'webkitAudioContext'),
  now: Date.now,
};

function restore(name) {
  const d = originals[name];
  if (d) Object.defineProperty(globalThis, name, d);
  else delete globalThis[name];
}

after(() => {
  setSoundEnabled(false);
  restore('localStorage');
  restore('AudioContext');
  restore('webkitAudioContext');
  Date.now = originals.now;
});

// ---------------------------------------------------------------------------
// Node: nothing exists, nothing throws
// ---------------------------------------------------------------------------

describe('in Node (no window, no AudioContext)', () => {
  test('preference defaults to off', () => {
    assert.equal(typeof globalThis.window, 'undefined');
    assert.equal(soundEnabled(), false);
  });

  test('every export is callable without throwing', () => {
    assert.doesNotThrow(() => {
      setSoundEnabled(true);
      setSoundEnabled(false);
      scratch();
      strokeSound(1200);
      strokeSound(-5);
      strokeSound(NaN);
      rustle();
      coverCreak();
      mountSoundToggle(null);
      mountSoundToggle(undefined);
    });
    assert.equal(soundEnabled(), false);
  });

  test('turning sound on without Web Audio stays a silent no-op', () => {
    assert.doesNotThrow(() => {
      setSoundEnabled(true);
      scratch();
      rustle();
    });
    setSoundEnabled(false);
  });
});

// ---------------------------------------------------------------------------
// Preference persistence (stubbed localStorage)
// ---------------------------------------------------------------------------

function fakeStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

describe('preference', () => {
  test('setSoundEnabled persists to localStorage dd-sound', () => {
    const store = fakeStorage();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: store });

    setSoundEnabled(true);
    assert.equal(store.map.get('dd-sound'), 'on');
    assert.equal(soundEnabled(), true);

    setSoundEnabled(false);
    assert.equal(store.map.get('dd-sound'), 'off');
    assert.equal(soundEnabled(), false);
  });

  test('a stored "on" is read back as enabled', () => {
    const store = fakeStorage();
    store.setItem('dd-sound', 'on');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: store });
    assert.equal(soundEnabled(), true);
    setSoundEnabled(false);
  });

  test('blocked storage (accessor throws) does not throw', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('blocked'); },
    });
    assert.doesNotThrow(() => setSoundEnabled(false));
    assert.equal(soundEnabled(), false);
  });
});

// ---------------------------------------------------------------------------
// The toggle button, on a minimal fake
// ---------------------------------------------------------------------------

function fakeButton() {
  return {
    textContent: '',
    attrs: {},
    listeners: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    click() { this.listeners.click(); },
  };
}

describe('mountSoundToggle', () => {
  test('shows the off state, then toggles text and aria-pressed on click', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: fakeStorage() });
    setSoundEnabled(false);
    const button = fakeButton();

    mountSoundToggle(button);
    assert.equal(button.textContent, '♪ Sound: off');
    assert.equal(button.attrs['aria-pressed'], 'false');

    button.click();
    assert.equal(soundEnabled(), true);
    assert.equal(button.textContent, '♪ Sound: on');
    assert.equal(button.attrs['aria-pressed'], 'true');

    button.click();
    assert.equal(soundEnabled(), false);
    assert.equal(button.textContent, '♪ Sound: off');
    assert.equal(button.attrs['aria-pressed'], 'false');
  });
});

// ---------------------------------------------------------------------------
// scratch() throttling, with a fake AudioContext and a fake clock
// ---------------------------------------------------------------------------

class FakeAudioContext {
  static sources = 0;
  constructor() {
    this.sampleRate = 8000;
    this.currentTime = 0;
    this.destination = {};
    this.state = 'running';
  }
  createBuffer(channels, length, sampleRate) {
    return { duration: length / sampleRate, getChannelData: () => new Float32Array(length) };
  }
  createBufferSource() {
    FakeAudioContext.sources++;
    return { buffer: null, loop: false, start() {}, stop() {}, connect(t) { return t; } };
  }
  createBiquadFilter() {
    return {
      type: '', Q: { value: 0 },
      frequency: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {} },
      connect(t) { return t; },
    };
  }
  createGain() {
    return {
      gain: {
        value: 0,
        setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {},
      },
      connect(t) { return t; },
    };
  }
  createOscillator() {
    return { frequency: { value: 0 }, start() {}, stop() {}, connect(t) { return t; } };
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
}

describe('scratch throttling', () => {
  test('at most one scratch every 45 ms, counted by buffer sources', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: fakeStorage() });
    Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: FakeAudioContext });

    // Fake clock, starting well after any real timestamp used by earlier tests.
    let clock = originals.now() + 1_000_000;
    Date.now = () => clock;

    setSoundEnabled(true);
    const before = FakeAudioContext.sources;

    scratch();
    assert.equal(FakeAudioContext.sources - before, 1, 'first scratch plays');

    for (let i = 0; i < 10; i++) scratch(); // same instant: all dropped
    assert.equal(FakeAudioContext.sources - before, 1);

    clock += 44;
    scratch();
    assert.equal(FakeAudioContext.sources - before, 1, '44 ms is still inside the gap');

    clock += 1; // 45 ms since the first scratch
    scratch();
    assert.equal(FakeAudioContext.sources - before, 2, 'a scratch at 45 ms plays');

    for (let i = 0; i < 5; i++) {
      clock += 50;
      scratch();
    }
    assert.equal(FakeAudioContext.sources - before, 7, 'spaced scratches all play');

    setSoundEnabled(false);
    clock += 1000;
    scratch();
    assert.equal(FakeAudioContext.sources - before, 7, 'nothing plays while disabled');
  });
});
