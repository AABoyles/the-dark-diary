// IndexedDB storage for Dark Diary sessions.
// Database 'dark-diary', version 2.
//   'sessions'  keyed by 'id'         - the transcripts
//   'memories'  keyed by 'id'         - short facts the diary keeps across sessions
//                                       { id, sessionId, ts, topic, phrase, kind, vec }

const DB_NAME = 'dark-diary';
const DB_VERSION = 2;
const STORE = 'sessions';
const MEMORIES = 'memories';

let dbPromise = null;

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

/** All sessions, newest first by createdAt. */
export async function listSessions() {
  const sessions = await run(STORE, 'readonly', (store) => store.getAll());
  return (sessions || []).sort((a, b) => b.createdAt - a.createdAt);
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
  await run(STORE, 'readwrite', (store) => store.put(session));
  return session;
}

/** A session by id, or undefined if it does not exist. */
export async function getSession(id) {
  return run(STORE, 'readonly', (store) => store.get(id));
}

/** Persist a session, stamping updatedAt with the current time. */
export async function saveSession(session) {
  session.updatedAt = Date.now();
  await run(STORE, 'readwrite', (store) => store.put(session));
  return session;
}

/** Remove a session by id. */
export async function deleteSession(id) {
  await run(STORE, 'readwrite', (store) => store.delete(id));
  await deleteMemoriesForSession(id); // burning an entry burns what the diary learned from it
}

// ---------- Memories (cross-session) ----------

/** Persist one memory record. */
export async function putMemory(memory) {
  await run(MEMORIES, 'readwrite', (store) => store.put(memory));
  return memory;
}

/** All memories, newest first. */
export async function listMemories() {
  const all = await run(MEMORIES, 'readonly', (store) => store.getAll());
  return (all || []).sort((a, b) => b.ts - a.ts);
}

/** Remove one memory by id. */
export async function deleteMemory(id) {
  await run(MEMORIES, 'readwrite', (store) => store.delete(id));
}

/** Remove every memory learned in one session. */
export async function deleteMemoriesForSession(sessionId) {
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
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('Could not delete memories.'));
  });
}
