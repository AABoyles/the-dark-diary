// Backups (issue #11): one JSON file with every entry (doodles included) and every
// memory, without embedding vectors (they are recomputed after a restore).
//
//   plain:   { format, version, exportedAt, sessions: [...], memories: [...] }
//   clasped: { format, version, exportedAt, locked: { kdf, iterations, salt, iv, ct } }
//            ct opens, with the diary's passphrase, to { sessions, memories }
//
// A file to restore is untrusted: parseBackup() accepts only the fields the diary
// uses, of the right types and within sane sizes, and drops everything else.

import { deriveKey, unseal, toBase64, fromBase64, MIN_ITERATIONS, MAX_ITERATIONS } from './clasp.js';

export const FORMAT = 'the-dark-diary';
export const VERSION = 1;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

const LIMITS = {
  sessions: 20_000, messages: 10_000, text: 20_000, title: 300, titles: 50,
  memories: 100_000, phrase: 1_000, word: 100, doodles: 100, path: 8_000,
};

export class BackupError extends Error {
  constructor(msg) { super(msg); this.name = 'BackupError'; }
}

/** The backup file's text. `sealed` (from db.sealBackup) makes a clasped backup. */
export function buildBackup({ sessions, memories }, sealed = null, now = Date.now()) {
  const head = { format: FORMAT, version: VERSION, exportedAt: new Date(now).toISOString() };
  if (sealed) {
    return JSON.stringify({
      ...head,
      locked: {
        kdf: 'PBKDF2-SHA-256/AES-GCM-256',
        iterations: sealed.iterations,
        salt: toBase64(sealed.salt),
        iv: toBase64(sealed.box.iv),
        ct: toBase64(sealed.box.ct),
      },
    });
  }
  return JSON.stringify({ ...head, sessions, memories }, null, 1);
}

/** A file name like dark-diary-2026-11-27.json. */
export const backupName = (now = Date.now()) => `dark-diary-${new Date(now).toISOString().slice(0, 10)}.json`;

/**
 * Read a backup's text. Returns { locked: false, data } or, for a clasped backup,
 * { locked: true, open(passphrase) -> data | null }. Throws BackupError if the file
 * is not a diary backup.
 */
export function readBackup(text) {
  if (typeof text !== 'string' || text.length > MAX_FILE_BYTES) throw new BackupError('That file is too large to be a diary.');
  let raw;
  try { raw = JSON.parse(text); } catch { throw new BackupError('That file is not a diary backup.'); }
  if (!raw || typeof raw !== 'object' || raw.format !== FORMAT) throw new BackupError('That file is not a diary backup.');
  if (raw.version !== VERSION) throw new BackupError('That backup was made by a different edition of the diary.');
  if (raw.locked) {
    const l = raw.locked;
    if (!Number.isInteger(l.iterations) || l.iterations < MIN_ITERATIONS || l.iterations > MAX_ITERATIONS) {
      throw new BackupError('That backup is sealed in a way the diary does not recognise.');
    }
    let salt, iv, ct;
    try { salt = fromBase64(l.salt); iv = fromBase64(l.iv); ct = fromBase64(l.ct); } catch { throw new BackupError('That backup is damaged.'); }
    if (salt.length < 16 || iv.length !== 12) throw new BackupError('That backup is damaged.');
    return {
      locked: true,
      async open(passphrase) {
        try {
          const k = await deriveKey(passphrase, salt, l.iterations);
          return parseBackup(await unseal(k, { iv, ct }, 'dark-diary-backup'));
        } catch (err) {
          if (err instanceof BackupError) throw err;
          return null; // wrong passphrase
        }
      },
    };
  }
  return { locked: false, data: parseBackup(raw) };
}

// ---------- validation ----------

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 8.64e15 ? v : null);
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const PATH = /^[MLCQSTAHVZmlcqstahvz0-9 .,eE+-]*$/;   // SVG path data only: no url(), no markup
const WORD = /^[a-z0-9:_-]{1,40}$/i;
const EMOTIONS = new Set(['grief', 'anger', 'fear', 'shame', 'boredom', 'delight', 'neutral']); // js/emotion.js

function cleanMessage(m) {
  if (!isObj(m) || (m.role !== 'user' && m.role !== 'diary')) return null;
  const text = str(m.text, LIMITS.text);
  if (text === null) return null;
  const out = { role: m.role, text, ts: num(m.ts) ?? 0 };
  if (typeof m.family === 'string' && WORD.test(m.family)) out.family = m.family;
  if (typeof m.overture === 'string' && WORD.test(m.overture)) out.overture = m.overture;
  if (m.role === 'user') {
    if (typeof m.emotion === 'string' && EMOTIONS.has(m.emotion)) {
      out.emotion = m.emotion;
      const mood = num(m.mood);
      if (mood !== null && mood <= 1) out.mood = mood;
    }
    if (m.crisis === true) out.crisis = true;
  }
  if (Array.isArray(m.doodle)) {
    const paths = m.doodle.slice(0, LIMITS.doodles)
      .filter((d) => typeof d === 'string' && d.length <= LIMITS.path && PATH.test(d));
    if (paths.length) out.doodle = paths;
  }
  return out;
}

function cleanSession(s) {
  if (!isObj(s) || typeof s.id !== 'string' || !ID.test(s.id)) return null;
  const createdAt = num(s.createdAt) ?? 0;
  const out = {
    id: s.id,
    title: str(s.title, LIMITS.title),
    createdAt,
    updatedAt: num(s.updatedAt) ?? createdAt,
    messages: (Array.isArray(s.messages) ? s.messages.slice(0, LIMITS.messages) : []).map(cleanMessage).filter(Boolean),
  };
  if (Array.isArray(s.titleHistory)) {
    const t = s.titleHistory.slice(-LIMITS.titles).map((x) => str(x, LIMITS.title)).filter((x) => x);
    if (t.length) out.titleHistory = t;
  }
  return out;
}

function cleanMemory(m, ids) {
  if (!isObj(m) || typeof m.id !== 'string' || !ID.test(m.id)) return null;
  if (typeof m.sessionId !== 'string' || !ids.has(m.sessionId)) return null; // no orphans
  const phrase = str(m.phrase, LIMITS.phrase);
  if (!phrase) return null;
  return {
    id: m.id,
    sessionId: m.sessionId,
    ts: num(m.ts) ?? 0,
    topic: str(m.topic, LIMITS.word) || '',
    phrase,
    kind: str(m.kind, LIMITS.word) || 'fact',
  };
}

/** Validate a parsed backup body. Returns { sessions, memories }; throws BackupError. */
export function parseBackup(raw) {
  if (!isObj(raw) || !Array.isArray(raw.sessions)) throw new BackupError('That backup holds no entries.');
  if (raw.sessions.length > LIMITS.sessions) throw new BackupError('That backup holds more entries than one diary can.');
  const seen = new Set();
  const sessions = [];
  for (const s of raw.sessions) {
    const c = cleanSession(s);
    if (c && !seen.has(c.id)) { seen.add(c.id); sessions.push(c); }
  }
  const memSeen = new Set();
  const memories = [];
  for (const m of (Array.isArray(raw.memories) ? raw.memories.slice(0, LIMITS.memories) : [])) {
    const c = cleanMemory(m, seen);
    if (c && !memSeen.has(c.id)) { memSeen.add(c.id); memories.push(c); }
  }
  return { sessions, memories };
}
