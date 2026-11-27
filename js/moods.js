// Moods for the ledger (issue #50). Each user message keeps the feeling it was
// read as, { emotion, mood }, where mood is how sure the reading was (0..1). It is
// stored with the message, so it is sealed by the clasp and kept in backups.
//
//   moodOf(text)            -> { emotion, mood } | null   (by meaning when MiniLM is ready, else by lexicon)
//   backfillMoods(db, opts) -> number of messages read     (older entries, a few at a time, in idle time)

const round = (x) => Math.round(Math.max(0, Math.min(1, x)) * 100) / 100;

let kit = null;
const loadKit = () => (kit ??= Promise.all([import('./emotion.js'), import('./understand.js')])
  .then(([e, u]) => ({ ...e, ...u })));

/** The feeling a message reads as, or null if it can't be read. */
export async function moodOf(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  try {
    const { emotionByMeaning, emotionByLexicon, analyze } = await loadKit();
    let e = null;
    try { e = await emotionByMeaning(t); } catch { e = null; }
    if (!e?.emotion) {
      let analysis = null;
      try { analysis = analyze(t); } catch { /* lexicon without it */ }
      e = emotionByLexicon(t, analysis);
    }
    return e?.emotion ? { emotion: e.emotion, mood: round(Number(e.score) || 0) } : null;
  } catch {
    return null;
  }
}

/**
 * Read the feelings of older messages that have none (written before the ledger,
 * or restored from a copy). At most `max` messages per call, so it can run in
 * idle time without holding anything up; returns how many were read.
 */
export async function backfillMoods(db, { max = 120 } = {}) {
  let done = 0;
  let sessions;
  try { sessions = await db.listSessions(); } catch { return 0; } // locked, or no storage
  for (const s of sessions) {
    let changed = false;
    for (const m of s.messages || []) {
      if (done >= max) break;
      if (m.role !== 'user' || m.emotion) continue;
      const r = await moodOf(m.text);
      if (!r) continue;
      m.emotion = r.emotion;
      m.mood = r.mood;
      changed = true;
      done++;
    }
    if (changed) {
      try { await db.saveSession(s, { touch: false }); } catch { return done; }
    }
    if (done >= max) break;
  }
  return done;
}
