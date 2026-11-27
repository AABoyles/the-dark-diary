// IndexedDB storage for Dark Diary sessions.
// Database 'dark-diary', version 3.
//   'sessions'  keyed by 'id'         - the transcripts
//   'memories'  keyed by 'id'         - short facts the diary keeps across sessions
//                                       { id, sessionId, ts, topic, phrase, kind, vec }
//   'meta'      keyed by 'key'        - { key: 'clasp', salt, iterations, check } when locked
//
// The clasp (issue #12): once a passphrase is set, every session is stored as
// { id, enc } and every memory as { id, sessionId, enc }, where enc is AES-GCM
// sealed with a key derived from the passphrase (js/clasp.js). Only ids, which are
// random UUIDs, stay readable. The key is held in memory while the book is
// unlocked; reads and writes while it is locked throw a LockedError.

import {
  deriveKey, seal, unseal, newSalt, makeCheck, checkKey, ITERATIONS, MIN_PASSPHRASE,
} from './clasp.js';

const DB_NAME = 'dark-diary';
const DB_VERSION = 3;
const STORE = 'sessions';
const MEMORIES = 'memories';
const META = 'meta';

export class LockedError extends Error {
  constructor() { super('The diary is clasped.'); this.name = 'LockedError'; }
}

let meta;          // undefined: not read yet; null: no clasp; else the clasp record
let key = null;    // the AES key while unlocked
const claspListeners = new Set();

let dbPromise = null;

// In-memory copies of both stores (issue #46): read once, then kept up to date
// by every write here, so a message never rescans IndexedDB. Another tab that
// writes tells this one to drop its copies.
let sessionCache = null;   // Map id -> session
let memoryCache = null;    // Map id -> memory
let channel = null;
try {
  channel = new BroadcastChannel('dark-diary-db');
  channel.onmessage = (e) => {
    sessionCache = null;
    memoryCache = null;
    if (e.data === 'clasp') {
      // the clasp was set, changed or removed in another tab: whatever key this tab
      // holds is stale, so it locks too, and the page is told
      meta = undefined;
      key = null;
      for (const fn of claspListeners) { try { fn(); } catch { /* listener */ } }
    }
  };
} catch { /* no BroadcastChannel (tests, old browsers): single-tab assumption */ }
const announce = (what = 'changed') => { try { channel?.postMessage(what); } catch { /* ignore */ } };

async function loadMeta() {
  if (meta === undefined) meta = (await run(META, 'readonly', (store) => store.get('clasp'))) || null;
  return meta;
}

/**
 * The key to seal writes with (null when there is no clasp). Throws while clasped
 * and locked. Callers take it once and use that copy, so a lock that lands
 * mid-write can never turn an encrypted write into a plaintext one.
 */
async function writeKey() {
  const m = await loadMeta();
  if (!m) return null;
  if (!key) throw new LockedError();
  return key;
}

const aad = (store, id) => `${store}:${id}`;

async function toStored(store, rec, k) {
  if (!k) return rec;
  const out = { id: rec.id, enc: await seal(k, rec, aad(store, rec.id)) };
  if (store === MEMORIES) out.sessionId = rec.sessionId; // kept readable for the per-entry index
  return out;
}

async function fromStored(store, rec, k) {
  if (!rec || !rec.enc) return rec;
  if (!k) throw new LockedError();
  return unseal(k, rec.enc, aad(store, rec.id));
}

/** Read and open a whole store. Plaintext records found under a clasp are sealed again. */
async function loadStore(store) {
  const k = await writeKey();
  const all = (await run(store, 'readonly', (s) => s.getAll())) || [];
  const open = await Promise.all(all.map((r) => fromStored(store, r, k)));
  const loose = k ? open.filter((r, i) => !all[i].enc) : [];
  if (loose.length) {
    // e.g. another tab wrote just before the clasp was set: seal them now
    const sealed = await Promise.all(loose.map((r) => toStored(store, r, k)));
    transact([store], (tx) => sealed.forEach((r) => tx.objectStore(store).put(r))).catch(() => {});
  }
  return open;
}

async function sessionsMap() {
  if (!sessionCache) {
    const all = await loadStore(STORE);
    sessionCache = new Map(all.map((s) => [s.id, s]));
  }
  return sessionCache;
}
async function memoriesMap() {
  if (!memoryCache) {
    const all = await loadStore(MEMORIES);
    memoryCache = new Map(all.map((m) => [m.id, m]));
  }
  return memoryCache;
}

/**
 * Open (or reuse) the database connection. The promise is cached so that
 * every call shares one connection. If the open fails or is blocked, the
 * cache is cleared so a later call can retry.
 */
function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(MEMORIES)) {
        const m = db.createObjectStore(MEMORIES, { keyPath: 'id' });
        m.createIndex('sessionId', 'sessionId');
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // Another tab wants to upgrade or delete the database: release our
      // connection so it is not blocked, and reopen on the next call.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };

    request.onerror = () => {
      dbPromise = null;
      reject(request.error || new Error('Failed to open the dark-diary database.'));
    };

    request.onblocked = () => {
      dbPromise = null;
      reject(new Error('The dark-diary database is blocked by another open tab. Close other tabs and try again.'));
    };
  });

  return dbPromise;
}

/**
 * Run one request inside a transaction on the given store.
 * Resolves with the request result once the transaction has committed,
 * so writes are durable by the time the caller continues.
 */
async function run(storeName, mode, makeRequest) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = db.transaction(storeName, mode);
    } catch (err) {
      // Connection went away (e.g. closed by versionchange); drop the cache.
      dbPromise = null;
      reject(err);
      return;
    }

    const store = transaction.objectStore(storeName);
    let result;

    let request;
    try {
      request = makeRequest(store);
    } catch (err) {
      reject(err);
      return;
    }

    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = () => {
      reject(request.error || new Error('IndexedDB request failed.'));
    };

    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => {
      reject(transaction.error || new Error('IndexedDB transaction failed.'));
    };
    transaction.onabort = () => {
      reject(transaction.error || new Error('IndexedDB transaction was aborted.'));
    };
  });
}

/** One readwrite transaction over several stores; `fill` must queue its requests synchronously. */
async function transact(stores, fill) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    let tx;
    try { tx = db.transaction(stores, 'readwrite'); } catch (err) { dbPromise = null; reject(err); return; }
    try { fill(tx); } catch (err) { try { tx.abort(); } catch { /* already done */ } reject(err); return; }
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction failed.'));
  });
}

/** All sessions, newest first by createdAt. */
export async function listSessions() {
  return [...(await sessionsMap()).values()].sort((a, b) => b.createdAt - a.createdAt);
}

/** Create and persist an empty session with a null title. */
export async function createSession() {
  const now = Date.now();
  const session = {
    id: crypto.randomUUID(),
    title: null,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  const k = await writeKey();
  const stored = await toStored(STORE, session, k);
  await run(STORE, 'readwrite', (store) => store.put(stored));
  (await sessionsMap()).set(session.id, session);
  announce();
  return session;
}

/** A session by id, or undefined if it does not exist. */
export async function getSession(id) {
  return (await sessionsMap()).get(id);
}

/** Persist a session, stamping updatedAt with the current time. */
export async function saveSession(session) {
  const k = await writeKey();
  session.updatedAt = Date.now();
  const stored = await toStored(STORE, session, k);
  await run(STORE, 'readwrite', (store) => store.put(stored));
  (await sessionsMap()).set(session.id, session);
  announce();
  return session;
}

/** Remove a session by id. */
export async function deleteSession(id) {
  await writeKey();
  await run(STORE, 'readwrite', (store) => store.delete(id));
  (await sessionsMap()).delete(id);
  await deleteMemoriesForSession(id);
  announce(); // burning an entry burns what the diary learned from it
}

// ---------- Memories (cross-session) ----------

/** Persist one memory record. */
export async function putMemory(memory) {
  const k = await writeKey();
  const stored = await toStored(MEMORIES, memory, k);
  await run(MEMORIES, 'readwrite', (store) => store.put(stored));
  (await memoriesMap()).set(memory.id, memory);
  announce();
  return memory;
}

/** All memories, newest first. */
export async function listMemories() {
  return [...(await memoriesMap()).values()].sort((a, b) => b.ts - a.ts);
}

/** Remove one memory by id. */
export async function deleteMemory(id) {
  await writeKey();
  await run(MEMORIES, 'readwrite', (store) => store.delete(id));
  (await memoriesMap()).delete(id);
  announce();
}

/** Remove every memory learned in one session. */
export async function deleteMemoriesForSession(sessionId) {
  await writeKey();
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(MEMORIES, 'readwrite');
    const index = tx.objectStore(MEMORIES).index('sessionId');
    const req = index.openKeyCursor(IDBKeyRange.only(sessionId));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      tx.objectStore(MEMORIES).delete(cursor.primaryKey);
      cursor.continue();
    };
    tx.oncomplete = () => {
      if (memoryCache) for (const [k, m] of memoryCache) if (m.sessionId === sessionId) memoryCache.delete(k);
      resolve();
    };
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('Could not delete memories.'));
  });
}

// ---------- The clasp (issue #12) ----------

/** { enabled, locked }: is there a passphrase, and is the key absent right now? */
export async function claspState() {
  const m = await loadMeta();
  return { enabled: !!m, locked: !!m && !key };
}

/** Called when another tab sets, changes or removes the clasp (this tab is then locked). */
export function onClaspChange(fn) {
  claspListeners.add(fn);
  return () => claspListeners.delete(fn);
}

/** Try a passphrase. True (and unlocked) if it is right; false if not. */
export async function unlock(passphrase) {
  const m = await loadMeta();
  if (!m) return true;
  let k;
  try { k = await deriveKey(passphrase, m.salt, m.iterations); } catch { return false; }
  if (!(await checkKey(k, m.check))) return false;
  key = k;
  sessionCache = null;
  memoryCache = null;
  return true;
}

/** Forget the key and every decrypted copy held in memory. */
export function lock() {
  key = null;
  sessionCache = null;
  memoryCache = null;
}

/** Set a passphrase: everything stored is sealed with it, in one transaction. */
export async function setClasp(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE) {
    throw new RangeError(`The passphrase must be at least ${MIN_PASSPHRASE} characters.`);
  }
  if (await loadMeta()) throw new Error('The diary is already clasped.');
  const sessions = [...(await sessionsMap()).values()];
  const memories = [...(await memoriesMap()).values()];
  const salt = newSalt();
  const k = await deriveKey(passphrase, salt, ITERATIONS);
  const record = { key: 'clasp', salt, iterations: ITERATIONS, check: await makeCheck(k), at: Date.now() };
  const sealedS = await Promise.all(sessions.map((r) => toStored(STORE, r, k)));
  const sealedM = await Promise.all(memories.map((r) => toStored(MEMORIES, r, k)));
  await transact([STORE, MEMORIES, META], (tx) => {
    sealedS.forEach((r) => tx.objectStore(STORE).put(r));
    sealedM.forEach((r) => tx.objectStore(MEMORIES).put(r));
    tx.objectStore(META).put(record);
  });
  meta = record;
  key = k;
  announce('clasp');
}

/** Remove the passphrase (it must be given again): everything is stored readable again. */
export async function removeClasp(passphrase) {
  const m = await loadMeta();
  if (!m) return true;
  let k;
  try { k = await deriveKey(passphrase, m.salt, m.iterations); } catch { return false; }
  if (!(await checkKey(k, m.check))) return false;
  key = k;
  sessionCache = null;
  memoryCache = null;
  const sessions = [...(await sessionsMap()).values()];
  const memories = [...(await memoriesMap()).values()];
  await transact([STORE, MEMORIES, META], (tx) => {
    sessions.forEach((r) => tx.objectStore(STORE).put(r));
    memories.forEach((r) => tx.objectStore(MEMORIES).put(r));
    tx.objectStore(META).delete('clasp');
  });
  meta = null;
  key = null;
  announce('clasp');
  return true;
}

// ---------- Backup (issue #11) ----------

/** Everything the diary keeps, decrypted, for a backup. Embedding vectors are left out. */
export async function exportData() {
  const sessions = await listSessions();
  const memories = (await listMemories()).map(({ vec, ...m }) => m);
  return { sessions, memories };
}

/**
 * When the diary is clasped, a backup is sealed with the same key (and carries the
 * salt), so the file opens with the same passphrase anywhere. Null when not clasped.
 */
export async function sealBackup(value) {
  const k = await writeKey();
  if (!k) return null;
  const box = await seal(k, value, 'dark-diary-backup');
  return { salt: meta.salt, iterations: meta.iterations, box };
}

/**
 * Bring validated sessions and memories in (see js/backup.js), in one transaction.
 * replace: everything stored now is removed first. Otherwise merged: a session
 * already here is kept unless the incoming copy was updated later; memories
 * already here are kept. Returns { sessions, memories } counts written.
 */
export async function importData({ sessions = [], memories = [] }, { replace = false } = {}) {
  const k = await writeKey();
  const haveS = replace ? new Map() : await sessionsMap();
  const haveM = replace ? new Map() : await memoriesMap();
  const inS = sessions.filter((s) => !haveS.has(s.id) || (haveS.get(s.id).updatedAt || 0) < (s.updatedAt || 0));
  const inM = memories.filter((m) => !haveM.has(m.id));
  const sealedS = await Promise.all(inS.map((r) => toStored(STORE, r, k)));
  const sealedM = await Promise.all(inM.map((r) => toStored(MEMORIES, r, k)));
  await transact([STORE, MEMORIES], (tx) => {
    if (replace) { tx.objectStore(STORE).clear(); tx.objectStore(MEMORIES).clear(); }
    sealedS.forEach((r) => tx.objectStore(STORE).put(r));
    sealedM.forEach((r) => tx.objectStore(MEMORIES).put(r));
  });
  sessionCache = null;
  memoryCache = null;
  announce();
  return { sessions: inS.length, memories: inM.length };
}
