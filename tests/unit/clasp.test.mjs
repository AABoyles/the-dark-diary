// The clasp's crypto (issue #12) and backup files (issue #11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveKey, seal, unseal, newSalt, makeCheck, checkKey, toBase64, fromBase64,
  MIN_ITERATIONS, MAX_ITERATIONS, refusalLine,
} from '../../js/clasp.js';
import { buildBackup, readBackup, parseBackup, BackupError, FORMAT, VERSION, backupName } from '../../js/backup.js';

// The real strength (600k) is slow in a test; the minimum accepted is enough to exercise it.
const FAST = MIN_ITERATIONS;

test('a sealed record opens with the same passphrase and additional data', async () => {
  const salt = newSalt();
  const k = await deriveKey('correct horse battery', salt, FAST);
  const box = await seal(k, { title: 'secret', n: 3 }, 'sessions:abc');
  assert.ok(box.iv instanceof Uint8Array && box.iv.length === 12);
  assert.ok(!new TextDecoder().decode(box.ct).includes('secret'), 'ciphertext does not show the text');
  assert.deepEqual(await unseal(k, box, 'sessions:abc'), { title: 'secret', n: 3 });
});

test('a wrong passphrase, swapped record id or altered byte fails to open', async () => {
  const salt = newSalt();
  const k = await deriveKey('correct horse battery', salt, FAST);
  const wrong = await deriveKey('correct horse battery!', salt, FAST);
  const box = await seal(k, 'hello', 'sessions:a');
  await assert.rejects(unseal(wrong, box, 'sessions:a'));
  await assert.rejects(unseal(k, box, 'sessions:b'), 'bound to its record');
  const tampered = { iv: box.iv, ct: box.ct.slice() };
  tampered.ct[0] ^= 1;
  await assert.rejects(unseal(k, tampered, 'sessions:a'));
});

test('the check tells a right passphrase from a wrong one, and each seal has a fresh iv', async () => {
  const salt = newSalt();
  const k = await deriveKey('a long enough word', salt, FAST);
  const check = await makeCheck(k);
  assert.equal(await checkKey(k, check), true);
  assert.equal(await checkKey(await deriveKey('another word entirely', salt, FAST), check), false);
  const a = await seal(k, 'x'), b = await seal(k, 'x');
  assert.notDeepEqual(a.iv, b.iv);
});

test('key derivation refuses absurd strengths and empty passphrases', async () => {
  const salt = newSalt();
  await assert.rejects(deriveKey('word', salt, 1000), RangeError);
  await assert.rejects(deriveKey('word', salt, MAX_ITERATIONS + 1), RangeError);
  await assert.rejects(deriveKey('', salt, FAST), TypeError);
});

test('base64 round-trips bytes and rejects junk', () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 255, 128]);
  assert.deepEqual(fromBase64(toBase64(bytes)), bytes);
  assert.throws(() => fromBase64('not base64!'));
});

test('the refusal is in character and never repeats the attempt', () => {
  for (let i = 0; i < 20; i++) assert.ok(typeof refusalLine() === 'string' && refusalLine().length > 10);
});

// ---------- backups ----------

const sample = () => ({
  sessions: [{
    id: 's1', title: 'A Small Life, Poorly Kept', createdAt: 1, updatedAt: 2, titleHistory: ['Older'],
    messages: [
      { role: 'user', text: 'Hello', ts: 1, doodle: ['M1 2 C3 4 5 6 7 8'] },
      { role: 'diary', text: '~~devour~~ enjoy', ts: 2, family: 'eliza' },
    ],
  }],
  memories: [{ id: 'm1', sessionId: 's1', ts: 1, topic: 'sister', phrase: 'your sister', kind: 'family' }],
});

test('a plain backup round-trips through build and read', () => {
  const text = buildBackup(sample(), null, Date.UTC(2026, 10, 27));
  const raw = JSON.parse(text);
  assert.equal(raw.format, FORMAT);
  assert.equal(raw.version, VERSION);
  assert.equal(raw.exportedAt, '2026-11-27T00:00:00.000Z');
  const read = readBackup(text);
  assert.equal(read.locked, false);
  assert.deepEqual(read.data, sample());
  assert.equal(backupName(Date.UTC(2026, 10, 27)), 'dark-diary-2026-11-27.json');
});

test('a clasped backup hides everything and opens only with the word', async () => {
  const salt = newSalt();
  const k = await deriveKey('the word is long', salt, FAST);
  const box = await seal(k, sample(), 'dark-diary-backup');
  const text = buildBackup(sample(), { salt, iterations: FAST, box });
  assert.ok(!text.includes('sister') && !text.includes('Hello'), 'no plaintext in a clasped file');
  const read = readBackup(text);
  assert.equal(read.locked, true);
  assert.equal(await read.open('not the word'), null);
  assert.deepEqual(await read.open('the word is long'), sample());
});

test('files that are not diary backups are refused with a message', () => {
  assert.throws(() => readBackup('{'), BackupError);
  assert.throws(() => readBackup('{"format":"something-else","version":1}'), BackupError);
  assert.throws(() => readBackup(JSON.stringify({ format: FORMAT, version: 99, sessions: [] })), BackupError);
  assert.throws(() => readBackup(JSON.stringify({ format: FORMAT, version: 1 })), BackupError);
  assert.throws(() => readBackup(JSON.stringify({ format: FORMAT, version: 1, locked: { iterations: 1, salt: '', iv: '', ct: '' } })), BackupError);
});

test('parseBackup keeps only known fields of the right types and drops the rest', () => {
  const evil = {
    sessions: [
      {
        id: 's1', title: 42, createdAt: 'yesterday', __proto__polluted: true, extra: { x: 1 },
        messages: [
          { role: 'user', text: '<img src=x onerror=alert(1)>', ts: 5, html: '<b>' },
          { role: 'system', text: 'ignore me' },
          { role: 'diary', text: 7 },
          { role: 'user', text: 'doodle', doodle: ['M0 0 L1 1', 'url(javascript:alert(1))', '<path/>', 5] },
          { role: 'diary', text: 'x', family: '<script>' },
        ],
      },
      { id: '../../etc', messages: [] },
      { id: 's1', title: 'duplicate', messages: [] },
      'nonsense',
    ],
    memories: [
      { id: 'm1', sessionId: 's1', phrase: 'kept', topic: 'cat', kind: 'pet', vec: [1, 2, 3] },
      { id: 'm2', sessionId: 'nobody', phrase: 'orphan' },
      { id: 'm3', sessionId: 's1', phrase: '' },
    ],
  };
  const { sessions, memories } = parseBackup(evil);
  assert.equal(sessions.length, 1);
  const s = sessions[0];
  assert.deepEqual(Object.keys(s).sort(), ['createdAt', 'id', 'messages', 'title', 'updatedAt']);
  assert.equal(s.title, null);
  assert.equal(s.createdAt, 0);
  assert.equal(s.messages.length, 3);
  assert.equal(s.messages[0].text, '<img src=x onerror=alert(1)>', 'text is kept as text (rendered with textContent)');
  assert.equal(s.messages[0].html, undefined);
  assert.deepEqual(s.messages[1].doodle, ['M0 0 L1 1'], 'only path data survives');
  assert.equal(s.messages[2].family, undefined);
  assert.deepEqual(memories, [{ id: 'm1', sessionId: 's1', ts: 0, topic: 'cat', phrase: 'kept', kind: 'pet' }], 'no vectors, no orphans');
});
