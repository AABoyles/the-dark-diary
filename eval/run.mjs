#!/usr/bin/env node
// npm run eval [-- --update-baseline] [--no-nlp] [--seed N]
//
// Runs the conversation harness (eval/harness.mjs) and writes:
//   eval/report.md      human-readable report, with deltas against the baseline
//   eval/latest.json    the metrics of this run
// With --update-baseline, also writes eval/baseline.json (commit it).
// Exits non-zero if a hard floor is broken.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { evaluate, floors, HEADLINE, DEFAULT_SEED } from './harness.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const seedArg = args.indexOf('--seed');
const seed = seedArg >= 0 ? Number(args[seedArg + 1]) : DEFAULT_SEED;

let compromise = null;
if (!flag('--no-nlp')) {
  try { compromise = (await import('compromise')).default; } catch { /* dev dependency missing: run on regex fallbacks */ }
}

const { metrics: m, transcripts, nlp } = await evaluate({ seed, compromise });
let baseline = null;
try { baseline = JSON.parse(await readFile(here('./baseline.json'), 'utf8')); } catch { /* none yet */ }

const fmt = (v) => (typeof v === 'number' ? String(v) : JSON.stringify(v));
const delta = (key, dir) => {
  if (!baseline || typeof baseline.metrics?.[key] !== 'number') return '';
  const d = Math.round((m[key] - baseline.metrics[key]) * 10) / 10;
  if (!d) return '±0';
  const better = dir === 'lower' ? d < 0 : dir === 'higher' ? d > 0 : null;
  return `${d > 0 ? '+' : ''}${d}${better === null ? '' : better ? ' ✓' : ' ✗'}`;
};

const failures = floors(m);
const lines = [];
lines.push('# Fallback engine quality report', '');
lines.push(`Corpus: ${m.conversations} conversations, ${m.turns} turns · seed ${seed} · NLP (compromise.js): ${nlp ? 'on' : 'off'}`);
if (baseline) lines.push(`Compared with baseline from ${baseline.date} (seed ${baseline.seed}, NLP ${baseline.nlp ? 'on' : 'off'}).`);
lines.push('', failures.length ? `**Hard floors broken:**\n${failures.map((f) => `- ${f}`).join('\n')}` : '**All hard floors hold** (no placeholders, every crisis turn handled, question share ≤ 45%, no runs of three questions).', '');
lines.push('## Headline', '', '| Metric | Value | Δ vs baseline | Better when |', '|---|---:|---:|---|');
for (const [key, label, dir] of HEADLINE) lines.push(`| ${label} | ${fmt(m[key])} | ${delta(key, dir)} | ${dir} |`);
lines.push('', '## Which path answered', '', '| Path | Replies | Share |', '|---|---:|---:|');
for (const [p, c] of Object.entries(m.paths).sort((a, b) => b[1] - a[1])) lines.push(`| ${p} | ${c} | ${Math.round((1000 * c) / m.turns) / 10}% |`);
lines.push('', '| Source | Replies | Share |', '|---|---:|---:|');
for (const [f, c] of Object.entries(m.families || {}).sort((a, b) => b[1] - a[1])) lines.push(`| ${f} | ${c} | ${Math.round((1000 * c) / m.turns) / 10}% |`);
lines.push('', '`none` and `familiar-none` are the generic catch-alls; `recall` quotes an earlier remark; `keyword`/`rewrite` are rule-based.', '');
lines.push('## Safety', '', `- Crisis turns in the corpus (by phrase): ${m.crisisTurns}; answered with the kind reply: ${m.crisisHandled}.`);
lines.push(`- Crisis conversations never handled: ${m.crisisConversationsMissed.length ? m.crisisConversationsMissed.join(', ') : 'none'}.`);
lines.push(`- False alarms on dark hyperbole: ${m.hyperboleFalseAlarms.length ? m.hyperboleFalseAlarms.map((f) => `"${f.user}"`).join('; ') : 'none'}.`, '');
lines.push('## Grammar problems in reflected text', '');
if (!m.grammarProblems) lines.push('None found.');
else {
  lines.push('| Problem | Replies |', '|---|---:|');
  for (const [k, v] of Object.entries(m.grammar).sort((a, b) => b[1] - a[1])) lines.push(`| ${k} | ${v} |`);
  lines.push('', 'Examples:', '');
  for (const e of m.grammarExamples) lines.push(`- *${e.problem}* — “${e.user}” → “${e.reply}”`);
}
lines.push('', '## Most repeated replies (across all conversations)', '');
for (const r of m.mostRepeated) lines.push(`- ×${r.count} “${r.line}”`);
lines.push('', '## Most used keyword rules', '', m.topRules.map(([k, c]) => `\`${k}\` ×${c}`).join(' · '), '');
lines.push('## Sample transcripts', '');
for (const tr of transcripts.slice(0, 3)) {
  lines.push(`### ${tr.id} (${tr.tags.join(', ')})`, '');
  for (const t of tr.turns) lines.push(`> **writer:** ${t.user}  `, `> **diary** _(${t.path}${t.rule ? `: ${t.rule}` : ''})_: ${t.reply}`, '>');
  lines.push('');
}

await writeFile(here('./report.md'), lines.join('\n') + '\n');
const record = { date: new Date().toISOString().slice(0, 10), seed, nlp, metrics: m };
await writeFile(here('./latest.json'), JSON.stringify(record, null, 2) + '\n');
if (flag('--update-baseline')) await writeFile(here('./baseline.json'), JSON.stringify(record, null, 2) + '\n');

console.log(`eval: ${m.turns} turns · generic ${m.genericRate}% · keyword ${m.keywordRate}% · distinct/100 ${m.distinctPer100} · questions ${m.questionShare}% · grammar ${m.grammarRate}% · crisis ${m.crisisHandled}/${m.crisisTurns}`);
console.log(`report: eval/report.md${flag('--update-baseline') ? ' · baseline updated' : ''}`);
if (failures.length) {
  console.error(`hard floors broken:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
