// The binding dialog (issues #11, #12): take a copy, restore from one, print a bound
// copy, and fasten or remove the clasp. Loaded the first time the dialog is opened.
//
//   openBinding({ db, afterImport, afterClaspChange, isBusy })

import { buildBackup, backupName, readBackup, BackupError, MAX_FILE_BYTES } from './backup.js';
import { MIN_PASSPHRASE, refusalLine as refusal } from './clasp.js';

const $ = (s) => document.querySelector(s);
let ctx = null;
let mounted = false;
let pending = null;   // a validated backup waiting for "add" or "replace"

function say(el, text, tone = '') {
  el.textContent = text;
  el.dataset.tone = tone;
}

async function refreshClasp() {
  const { enabled } = await ctx.db.claspState();
  $('#clasp-off').hidden = enabled;
  $('#clasp-on').hidden = !enabled;
  $('#keep-note').textContent = enabled
    ? 'Everything written here lives only in this browser. A copy is sealed with the clasp’s word, and opens only with it.'
    : 'Everything written here lives only in this browser. A copy can be carried elsewhere, or brought back if this one is lost. It is not sealed: keep it somewhere private.';
}

function busyButtons(form, on) {
  form.querySelectorAll('button, input').forEach((el) => { el.disabled = on; });
}

// ---------- Keep a copy ----------

async function exportBackup() {
  const status = $('#keep-status');
  try {
    const data = await ctx.db.exportData();
    const sealed = await ctx.db.sealBackup(data);
    const text = buildBackup(data, sealed);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = backupName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    const n = data.sessions.length;
    say(status, `A copy of ${n} ${n === 1 ? 'entry' : 'entries'} has been taken${sealed ? ', sealed with the clasp' : ''}.`, 'ok');
  } catch {
    say(status, 'The copy would not come away. Try again.', 'error');
  }
}

function resetImport() {
  pending = null;
  $('#import-unlock').hidden = true;
  $('#import-choice').hidden = true;
  $('#import-pass').value = '';
  $('#import-file').value = '';
}

function offer(data) {
  pending = data;
  $('#import-unlock').hidden = true;
  const s = data.sessions.length, m = data.memories.length;
  $('#import-summary').textContent = `The copy holds ${s} ${s === 1 ? 'entry' : 'entries'} and ${m} ${m === 1 ? 'memory' : 'memories'}.`;
  $('#import-choice').hidden = false;
  $('#import-merge').focus();
}

let lockedCopy = null;
async function chooseFile() {
  const file = $('#import-file').files?.[0];
  const status = $('#keep-status');
  resetImportChoice();
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) { say(status, 'That file is too large to be a diary.', 'error'); return; }
  try {
    const read = readBackup(await file.text());
    if (read.locked) {
      lockedCopy = read;
      $('#import-unlock').hidden = false;
      say(status, '');
      $('#import-pass').focus();
    } else {
      say(status, '');
      offer(read.data);
    }
  } catch (err) {
    say(status, err instanceof BackupError ? err.message : 'That file could not be read.', 'error');
  }
}
function resetImportChoice() {
  lockedCopy = null;
  pending = null;
  $('#import-unlock').hidden = true;
  $('#import-choice').hidden = true;
}

async function openLockedCopy(e) {
  e.preventDefault();
  const form = $('#import-unlock');
  const status = $('#keep-status');
  if (!lockedCopy) return;
  busyButtons(form, true);
  say(status, 'Trying the word…');
  try {
    const data = await lockedCopy.open($('#import-pass').value);
    if (!data) { say(status, refusal(), 'error'); $('#import-pass').select(); return; }
    say(status, '');
    offer(data);
  } catch (err) {
    say(status, err instanceof BackupError ? err.message : 'That copy is damaged.', 'error');
  } finally {
    busyButtons(form, false);
  }
}

async function restore(replace) {
  const status = $('#keep-status');
  if (!pending) return;
  if (ctx.isBusy()) { say(status, 'The diary is still writing. Wait for it to finish.', 'error'); return; }
  if (replace && !confirm('Burn every entry in this diary and keep only the copy? This cannot be undone.')) return;
  try {
    const n = await ctx.db.importData(pending, { replace });
    resetImport();
    say(status, `${n.sessions} ${n.sessions === 1 ? 'entry' : 'entries'} brought in${replace ? ', replacing what was here' : ''}.`, 'ok');
    await ctx.afterImport();
  } catch {
    say(status, 'The copy would not go in. Nothing was changed.', 'error');
  }
}

// ---------- Print ----------

async function printCopy() {
  try {
    const [{ printBook }, sessions] = await Promise.all([import('./print.js'), ctx.db.listSessions()]);
    $('#binding').close();
    printBook(sessions);
  } catch {
    say($('#keep-status'), 'The printer is not answering.', 'error');
  }
}

// ---------- The clasp ----------

async function fasten(e) {
  e.preventDefault();
  const form = $('#clasp-set');
  const status = $('#clasp-status');
  const a = $('#clasp-new').value, b = $('#clasp-again').value;
  if (a.length < MIN_PASSPHRASE) { say(status, `The word must be at least ${MIN_PASSPHRASE} characters.`, 'error'); return; }
  if (a !== b) { say(status, 'The two do not match. Say it the same way twice.', 'error'); $('#clasp-again').select(); return; }
  if (!$('#clasp-understood').checked) { say(status, 'Tick the box: it matters.', 'error'); return; }
  if (ctx.isBusy()) { say(status, 'The diary is still writing. Wait for it to finish.', 'error'); return; }
  busyButtons(form, true);
  say(status, 'Fastening the clasp…');
  try {
    await ctx.db.setClasp(a);
    form.reset();
    await refreshClasp();
    say(status, 'The clasp is fastened. Do not forget the word.', 'ok');
    ctx.afterClaspChange();
  } catch {
    say(status, 'The clasp would not fasten. Nothing was changed.', 'error');
  } finally {
    busyButtons(form, false);
  }
}

async function unfasten(e) {
  e.preventDefault();
  const form = $('#clasp-remove');
  const status = $('#clasp-status');
  if (ctx.isBusy()) { say(status, 'The diary is still writing. Wait for it to finish.', 'error'); return; }
  busyButtons(form, true);
  say(status, 'Trying the word…');
  try {
    const ok = await ctx.db.removeClasp($('#clasp-current').value);
    if (!ok) { say(status, refusal(), 'error'); $('#clasp-current').select(); return; }
    form.reset();
    await refreshClasp();
    say(status, 'The clasp is off. Anyone with this browser can read the diary now.', 'ok');
    ctx.afterClaspChange();
  } catch {
    say(status, 'The clasp would not come off. Nothing was changed.', 'error');
  } finally {
    busyButtons(form, false);
  }
}

function mount() {
  if (mounted) return;
  mounted = true;
  $('#export-backup').addEventListener('click', exportBackup);
  $('#import-backup').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', chooseFile);
  $('#import-unlock').addEventListener('submit', openLockedCopy);
  $('#import-merge').addEventListener('click', () => restore(false));
  $('#import-replace').addEventListener('click', () => restore(true));
  $('#import-cancel').addEventListener('click', () => { resetImport(); say($('#keep-status'), ''); });
  $('#print-book-btn').addEventListener('click', printCopy);
  $('#clasp-set').addEventListener('submit', fasten);
  $('#clasp-remove').addEventListener('submit', unfasten);
  // passwords never linger in a closed dialog
  $('#binding').addEventListener('close', () => {
    resetImport();
    lockedCopy = null;
    $('#clasp-set').reset();
    $('#clasp-remove').reset();
    say($('#keep-status'), '');
    say($('#clasp-status'), '');
  });
}

export async function openBinding(context) {
  ctx = context;
  mount();
  await refreshClasp();
  const dlg = $('#binding');
  if (!dlg.open) dlg.showModal();
}
