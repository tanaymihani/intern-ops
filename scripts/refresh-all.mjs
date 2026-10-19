#!/usr/bin/env node
/**
 * Run every scraper once, in sequence, on this machine — the local stand-in
 * for the GitHub Actions schedules. A failing source is reported and skipped;
 * the rest still run. Then `npm run dev` shows the result.
 *
 *   npm run refresh                 # everything except the slow Workday sweep
 *   npm run refresh -- --workday    # include Workday (~10+ min)
 *   npm run refresh -- --only lists,linkedin
 *
 * Handshake isn't included: it needs your sign-in window
 * (npm run feed:handshake).
 */
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PY = existsSync(join(ROOT, '.venv/bin/python')) ? join(ROOT, '.venv/bin/python') : 'python3';
const onlyArg = process.argv.indexOf('--only');
const only = onlyArg >= 0 ? new Set(String(process.argv[onlyArg + 1] || '').split(',')) : null;

const STEPS = [
  { id: 'lists', label: 'Curated intern lists', cmd: ['fetch-lists-feed.mjs'] },
  { id: 'quant-sites', label: 'Jane Street · SIG · D. E. Shaw', cmd: ['fetch-quant-sites.mjs'] },
  { id: 'linkedin', label: 'LinkedIn (next batch of queries)', cmd: ['fetch-linkedin-feed.mjs', '--days', '2'] },
  { id: 'jobright', label: 'JobRight (recommendations if signed in + company boards)', cmd: ['fetch-jobright-feed.mjs', '--max', '200', '--if-stale-companies'], env: { HC_PYTHON: PY } },
  { id: 'ghal', label: 'Greenhouse · Ashby · Lever sweep', cmd: ['run.mjs'], env: { GHAL_SINCE: '4' } },
  { id: 'tracked', label: 'Tracked boards', cmd: ['run-tracked.mjs'], env: { TRACKED_SINCE: '3' } },
  { id: 'workday', label: 'Workday sweep', cmd: ['run-workday.mjs'], env: { WORKDAY_SINCE: '2' }, optIn: '--workday' },
  { id: 'liveness', label: 'Closed-posting check', cmd: ['check-liveness.mjs'] },
];

const results = [];
for (const step of STEPS) {
  if (only ? !only.has(step.id) : (step.optIn && !process.argv.includes(step.optIn))) continue;
  const started = Date.now();
  process.stdout.write(`\n▶ ${step.label}\n`);
  const r = spawnSync(process.execPath, step.cmd, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...(step.env || {}) },
  });
  const secs = Math.round((Date.now() - started) / 1000);
  results.push({ step: step.label, ok: r.status === 0, secs });
}

console.log('\n── refresh summary ──');
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.step} (${r.secs}s)`);
console.log('\nOpen the dashboard: npm run dev → http://localhost:3000');
