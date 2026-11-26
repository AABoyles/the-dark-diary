// IndexedDB storage for Dark Diary sessions.
// Database 'dark-diary', version 1, object store 'sessions' keyed by 'id'.

const DB_NAME = 'dark-diary';
const DB_VERSION = 1;
const STORE = 'sessions';

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
 * Run one request inside a transaction on the sessions store.
 * Resolves with the request result once the transaction has committed,
 * so writes are durable by the time the caller continues.
 */
async function run(mode, makeRequest) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = db.transaction(STORE, mode);
    } catch (err) {
      // Connection went away (e.g. closed by versionchange); drop the cache.
      dbPromise = null;
      reject(err);
      return;
    }

    const store = transaction.objectStore(STORE);
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
  const sessions = await run('readonly', (store) => store.getAll());
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
  await run('readwrite', (store) => store.put(session));
  return session;
}

/** A session by id, or undefined if it does not exist. */
export async function getSession(id) {
  return run('readonly', (store) => store.get(id));
}

/** Persist a session, stamping updatedAt with the current time. */
export async function saveSession(session) {
  session.updatedAt = Date.now();
  await run('readwrite', (store) => store.put(session));
  return session;
}

/** Remove a session by id. */
export async function deleteSession(id) {
  await run('readwrite', (store) => store.delete(id));
}
