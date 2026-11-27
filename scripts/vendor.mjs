#!/usr/bin/env node
// scripts/vendor.mjs - copies pinned third-party browser files into ./vendor/.
//
// vendor/ is gitignored: onnxruntime's wasm alone is ~27 MB, so the binaries are
// fetched at install time rather than committed. Each package is downloaded with
// `npm pack name@version` (npm checks the registry integrity), unpacked with tar,
// and only the files listed in vendor.lock.json are copied out. Every copied
// file's SHA-256 must match the lock, so a tampered or drifted file fails loudly.
//
//   node scripts/vendor.mjs                 vendor everything (no-op if already correct)
//   node scripts/vendor.mjs --update-lock   after a deliberate version bump: rewrite the hashes
//
// Runs from the `postinstall` and `vendor` scripts in package.json.

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const LOCK_PATH = join(ROOT, 'vendor.lock.json');

const EXACT_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const TRANSFORMERS = '@huggingface/transformers';
const ORT = 'onnxruntime-web';

export class VendorError extends Error {
  name = 'VendorError';
}

/** Lowercase hex SHA-256 of a byte buffer. */
export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Throws VendorError unless `path` exists and its SHA-256 equals `expected`.
 * This is the one hash check: used when copying files and by the unit tests.
 * Resolves true on success.
 */
export async function verifyFileHash(path, expected) {
  if (typeof expected !== 'string' || !SHA256_HEX.test(expected)) {
    throw new VendorError(`No valid SHA-256 in the lock for ${path}. Run: npm run vendor -- --update-lock`);
  }
  let actual;
  try {
    actual = sha256Hex(await readFile(path));
  } catch (err) {
    throw new VendorError(`Missing vendored file ${path} (${err.code ?? err.message}). Run: npm run vendor`);
  }
  if (actual !== expected) {
    throw new VendorError(`SHA-256 mismatch for ${path}\n  expected ${expected}\n  actual   ${actual}`);
  }
  return true;
}

/** Throws VendorError if the lock is structurally unsound. Hash values are checked when files are verified. */
export function validateLock(lock) {
  if (!lock || typeof lock !== 'object') throw new VendorError('vendor.lock.json must be an object.');
  const packages = lock.packages ?? {};
  for (const [name, version] of Object.entries(packages)) {
    if (!EXACT_VERSION.test(version)) {
      throw new VendorError(`vendor.lock.json: ${name} must pin an exact version, not "${version}".`);
    }
  }
  if (!Array.isArray(lock.files) || lock.files.length === 0) {
    throw new VendorError('vendor.lock.json: "files" must be a non-empty array.');
  }
  const targets = new Set();
  for (const f of lock.files) {
    if (!(f.package in packages)) throw new VendorError(`vendor.lock.json: ${f.to} names unknown package ${f.package}.`);
    if (!isSafeRelative(f.from)) throw new VendorError(`vendor.lock.json: unsafe source path "${f.from}".`);
    if (!f.to.startsWith('vendor/') || !isSafeRelative(f.to)) {
      throw new VendorError(`vendor.lock.json: target "${f.to}" must sit inside vendor/.`);
    }
    if (targets.has(f.to)) throw new VendorError(`vendor.lock.json: duplicate target ${f.to}.`);
    targets.add(f.to);
  }
  return lock;
}

function isSafeRelative(p) {
  return typeof p === 'string' && p.length > 0 && !p.startsWith('/') && !p.includes('\\') && !p.split('/').includes('..');
}

export async function readLock(path = LOCK_PATH) {
  return validateLock(JSON.parse(await readFile(path, 'utf8')));
}

/** Downloads name@version with npm and unpacks it. Returns the package/ directory. */
export async function packPackage(name, version, workDir) {
  const { stdout } = await run(
    'npm',
    ['pack', `${name}@${version}`, '--pack-destination', workDir, '--json', '--silent'],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const [info] = JSON.parse(stdout);
  const extractDir = join(workDir, `x-${info.filename}`);
  await mkdir(extractDir, { recursive: true });
  await run('tar', ['-xzf', join(workDir, info.filename), '-C', extractDir]);
  return join(extractDir, 'package');
}

/**
 * Brings vendor/ in line with the lock.
 *  - update: false (default) verifies every target and returns early when all match;
 *    otherwise fetches the packages and fails if any source file's hash differs from the lock.
 *  - update: true fetches everything, rewrites the lock's hashes (and the onnxruntime-web
 *    version, which must match @huggingface/transformers' dependency) and writes it back.
 */
export async function vendor({
  lock,
  update = false,
  root = ROOT,
  lockPath = LOCK_PATH,
  pack = packPackage,
  log = () => {},
} = {}) {
  if (!update) {
    const upToDate = await Promise.all(
      lock.files.map((f) => verifyFileHash(join(root, f.to), f.sha256).then(() => true, () => false)),
    );
    if (upToDate.every(Boolean)) {
      log('vendor: all files present and verified');
      return { fetched: false };
    }
  }

  const workDir = await mkdtemp(join(tmpdir(), 'dark-diary-vendor-'));
  try {
    const dirs = new Map();
    dirs.set(TRANSFORMERS, await pack(TRANSFORMERS, lock.packages[TRANSFORMERS], workDir));

    // transformers bundles onnxruntime-web; the wasm we vendor must be that exact build.
    const tfManifest = JSON.parse(await readFile(join(dirs.get(TRANSFORMERS), 'package.json'), 'utf8'));
    const wantedOrt = tfManifest.dependencies?.[ORT];
    if (!EXACT_VERSION.test(wantedOrt ?? '')) {
      throw new VendorError(`${TRANSFORMERS}@${lock.packages[TRANSFORMERS]} does not pin ${ORT} exactly.`);
    }
    if (update) {
      lock.packages[ORT] = wantedOrt;
    } else if (lock.packages[ORT] !== wantedOrt) {
      throw new VendorError(
        `vendor.lock.json pins ${ORT} ${lock.packages[ORT]}, but ${TRANSFORMERS}@${lock.packages[TRANSFORMERS]} ` +
          `depends on ${wantedOrt}. Review the upgrade, then run: npm run vendor -- --update-lock`,
      );
    }

    for (const [name, version] of Object.entries(lock.packages)) {
      if (!dirs.has(name)) dirs.set(name, await pack(name, version, workDir));
    }

    for (const f of lock.files) {
      const bytes = await readFile(join(dirs.get(f.package), f.from));
      const actual = sha256Hex(bytes);
      if (update) {
        f.sha256 = actual;
      } else if (actual !== f.sha256) {
        throw new VendorError(
          `${f.package}: ${f.from} does not match vendor.lock.json.\n  expected ${f.sha256}\n  actual   ${actual}\n` +
            'If this upgrade is intended, run: npm run vendor -- --update-lock',
        );
      }
      const dest = join(root, f.to);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(`${dest}.partial`, bytes);
      await rename(`${dest}.partial`, dest);
      await verifyFileHash(dest, f.sha256);
      log(`vendor: ${f.to} (${bytes.length} bytes)`);
    }

    if (update) {
      await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
      log(`vendor: wrote ${lockPath}`);
    }
    return { fetched: true };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const unknown = argv.filter((a) => a !== '--update-lock');
  if (unknown.length) throw new VendorError(`Unknown option: ${unknown[0]}`);
  const lock = await readLock();
  await vendor({
    lock,
    update: argv.includes('--update-lock'),
    log: (line) => console.log(line),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err instanceof VendorError ? err.message : err);
    process.exitCode = 1;
  });
}
