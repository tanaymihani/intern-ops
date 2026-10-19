#!/usr/bin/env node
/**
 * Single-cycle VC-portfolio-seed runner for GitHub Actions (YC + a16z).
 *
 * Separate from run.mjs (GHAL) because walking YC's public API page-by-page
 * takes real time (minutes, not the ~1min GHAL cycles) — this runs on its
 * own slower schedule so it never blocks or races the fast GHAL cadence.
 * Catches startups that may not be in the generic ATS company-directory
 * dataset yet (very early/recently-funded).
 */
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { catchUpSince, readLastOk } from './lib/catch-up.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const CHECKPOINT = join(ROOT, 'data', 'cache', 'ats-seeds-checkpoint.json');
const HEARTBEAT = join(ROOT, 'data', 'scan-seeds-heartbeat.json');
// Fresh sweeps reach back past any missed runs; a resumed one keeps its checkpoint's cutoff.
const lastOk = readLastOk(HEARTBEAT);
const SINCE = String(catchUpSince(process.env.SEEDS_SINCE || '7', lastOk));

mkdirSync(dirname(CHECKPOINT), { recursive: true });

const resume = existsSync(CHECKPOINT);
const args = [
  'scan-ats-full.mjs',
  '--ats', 'greenhouse,ashby,lever',
  '--seeds', 'yc,a16z',
  '--since', SINCE,
  '--checkpoint', CHECKPOINT,
];
if (resume) args.push('--resume');

console.log(`[${new Date().toISOString()}] ${resume ? 'resume' : 'start fresh'} VC-seed sweep --since ${SINCE}`);

const started = Date.now();
const r = spawnSync(process.execPath, args, {
  cwd: ROOT,
  stdio: 'inherit',
  // Separate output files, same reasoning as run-icims.mjs: no shared file
  // between workflows means no git-push race between them.
  env: {
    ...process.env,
    CAREER_OPS_SCAN_HISTORY: 'data/scan-history-seeds.tsv',
    CAREER_OPS_PIPELINE: 'data/pipeline-seeds.md',
    CAREER_OPS_COOLDOWN_PATH: 'data/cache/scan-dead-boards-seeds.json',
  },
});
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

const incomplete = existsSync(CHECKPOINT);
const at = new Date().toISOString();
writeFileSync(HEARTBEAT, JSON.stringify({
  at,
  since: Number(SINCE),
  exitCode: r.status ?? 1,
  elapsedSec: Number(elapsed),
  incomplete,
  mode: 'vc-seeds-actions',
  seeds: ['yc', 'a16z'],
  lastOkAt: r.status === 0 && !incomplete ? at : lastOk,
}, null, 2));

console.log(`[${new Date().toISOString()}] ${r.status === 0 ? 'ok' : 'fail'} exit=${r.status} after ${elapsed}s`);
process.exit(r.status ?? 1);
