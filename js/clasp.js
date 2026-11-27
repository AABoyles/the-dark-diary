// The clasp (issue #12): passphrase-derived encryption for what the diary keeps.
//
//   key   = PBKDF2-SHA-256(passphrase, 16-byte random salt, ITERATIONS) -> AES-GCM-256
//   box   = { iv: 12 random bytes, ct: AES-GCM(JSON) }, with additional data that names
//           the record it belongs to, so a sealed record can't be swapped for another
//
// The key is non-extractable and lives only in memory (js/db.js holds it while the
// book is unlocked). Nothing here touches storage.

export const ITERATIONS = 600_000;           // OWASP 2023 guidance for PBKDF2-SHA-256
export const MIN_ITERATIONS = 100_000;       // accepted when opening a backup made elsewhere
export const MAX_ITERATIONS = 5_000_000;     // ...but not so many that a crafted file hangs the tab
export const MIN_PASSPHRASE = 8;
const CHECK_TEXT = 'the clasp holds';        // sealed with the key, to tell a right passphrase from a wrong one

// What the diary says to a wrong word (in character, never a hint).
const REFUSALS = [
  'That is not the word. I have heard it said correctly, and that was not it.',
  'No. A clasp is a small thing, but it is not a stupid one.',
  'Wrong. I shall remember that you tried.',
  'Close. No, I lie: not close at all.',
  'The clasp stays shut. It has better manners than to say why.',
];
export const refusalLine = () => REFUSALS[Math.floor(Math.random() * REFUSALS.length)];

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = () => {
  if (!globalThis.crypto?.subtle) throw new Error('This browser cannot lock the diary (no WebCrypto; needs https or localhost).');
  return globalThis.crypto.subtle;
};

export function newSalt() {
  return crypto.getRandomValues(new Uint8Array(16));
}

/** A non-extractable AES-GCM key from a passphrase. */
export async function deriveKey(passphrase, salt, iterations = ITERATIONS) {
  if (typeof passphrase !== 'string' || !passphrase) throw new TypeError('A passphrase is required.');
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new RangeError('Unsupported key-derivation strength.');
  }
  const base = await subtle().importKey('raw', enc.encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: toBytes(salt), iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Seal a JSON-able value. `aad` binds it to where it is stored. */
export async function seal(key, value, aad = '') {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(aad) },
    key,
    enc.encode(JSON.stringify(value)),
  );
  return { iv, ct: new Uint8Array(ct) };
}

/** Open a sealed box. Throws if the key or the additional data is wrong, or the box was altered. */
export async function unseal(key, box, aad = '') {
  if (!box || !box.iv || !box.ct) throw new Error('Not a sealed record.');
  const pt = await subtle().decrypt(
    { name: 'AES-GCM', iv: toBytes(box.iv), additionalData: enc.encode(aad) },
    key,
    toBytes(box.ct),
  );
  return JSON.parse(dec.decode(pt));
}

/** A sealed known value, stored beside the salt to check a passphrase. */
export const makeCheck = (key) => seal(key, CHECK_TEXT, 'clasp-check');

/** True if `key` opens the check made by makeCheck. */
export async function checkKey(key, check) {
  try { return (await unseal(key, check, 'clasp-check')) === CHECK_TEXT; } catch { return false; }
}

// ---------- bytes <-> base64, for backups ----------

export function toBytes(v) {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  throw new TypeError('Expected bytes.');
}

export function toBase64(bytes) {
  const b = toBytes(bytes);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new TypeError('Not base64.');
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
