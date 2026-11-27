// scripts/vendor.mjs and vendor.lock.json: the pinned set is complete and hash checks reject tampering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLock, validateLock, verifyFileHash, sha256Hex, VendorError, ROOT } from '../../scripts/vendor.mjs';

const HEX64 = /^[0-9a-f]{64}$/;

const EXPECTED_TARGETS = [
  'vendor/transformers/transformers.min.js',
  'vendor/onnxruntime/ort-wasm-simd-threaded.asyncify.mjs',
  'vendor/onnxruntime/ort-wasm-simd-threaded.asyncify.wasm',
  'vendor/compromise/compromise-three.mjs',
  'vendor/fonts/homemade-apple-400.woff2',
  'vendor/fonts/pinyon-script-400.woff2',
  'vendor/fonts/cormorant-garamond-600.woff2',
  'vendor/fonts/cormorant-garamond-600-italic.woff2',
  'vendor/fonts/im-fell-english-400.woff2',
  'vendor/fonts/im-fell-english-400-italic.woff2',
];

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'vendor-test-'));
}

test('vendor.lock.json lists every expected file with a 64-hex SHA-256', async () => {
  const lock = await readLock();
  const targets = lock.files.map((f) => f.to).sort();
  assert.deepEqual(targets, [...EXPECTED_TARGETS].sort());
  for (const f of lock.files) {
    assert.match(f.sha256, HEX64, `${f.to} has a 64-hex sha256`);
    assert.ok(f.package in lock.packages, `${f.to} names a pinned package`);
  }
});

test('every package in the lock is pinned to an exact version', async () => {
  const lock = await readLock();
  for (const [name, version] of Object.entries(lock.packages)) {
    assert.match(version, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, `${name} is exact (${version})`);
  }
});

test('the lock rejects unsafe paths and targets outside vendor/', () => {
  const base = { packages: { x: '1.0.0' }, files: [{ package: 'x', from: 'dist/a.js', to: 'vendor/a.js', sha256: '0'.repeat(64) }] };
  assert.doesNotThrow(() => validateLock(base));
  assert.throws(() => validateLock({ ...base, files: [{ ...base.files[0], from: '../etc/passwd' }] }), VendorError);
  assert.throws(() => validateLock({ ...base, files: [{ ...base.files[0], to: 'js/app.js' }] }), VendorError);
  assert.throws(() => validateLock({ ...base, packages: { x: '^1.0.0' } }), VendorError);
});

test('verifyFileHash accepts a file whose hash matches', async () => {
  const dir = await tempDir();
  try {
    const path = join(dir, 'lib.mjs');
    await writeFile(path, 'export const v = 1;\n');
    const expected = sha256Hex(await readFile(path));
    assert.equal(await verifyFileHash(path, expected), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('verifyFileHash rejects a tampered file', async () => {
  const dir = await tempDir();
  try {
    const path = join(dir, 'lib.mjs');
    await writeFile(path, 'export const v = 1;\n');
    const expected = sha256Hex(await readFile(path));
    await writeFile(path, 'export const v = 2; // injected\n');
    await assert.rejects(verifyFileHash(path, expected), (err) => {
      assert.ok(err instanceof VendorError);
      assert.match(err.message, /SHA-256 mismatch/);
      return true;
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('verifyFileHash rejects a missing file and a malformed expected hash', async () => {
  const dir = await tempDir();
  try {
    await assert.rejects(verifyFileHash(join(dir, 'nope.js'), '0'.repeat(64)), VendorError);
    const path = join(dir, 'x.js');
    await writeFile(path, 'x');
    await assert.rejects(verifyFileHash(path, ''), VendorError);
    await assert.rejects(verifyFileHash(path, 'abc'), VendorError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the vendor directory is gitignored', async () => {
  const ignore = await readFile(join(ROOT, '.gitignore'), 'utf8');
  assert.match(ignore, /^vendor\/$/m);
  assert.equal(fileURLToPath(new URL('../../vendor.lock.json', import.meta.url)), join(ROOT, 'vendor.lock.json'));
});
