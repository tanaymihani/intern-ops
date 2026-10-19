#!/usr/bin/env node
/**
 * Single-cycle GHAL (Greenhouse/Ashby/Lever) runner for GitHub Actions.
 * Trimmed out of career-ops/scripts/scan-ghal.mjs — same resume logic,
 * minus the local lock/loop/laptop-heartbeat machinery that doesn't make
 * sense on a stateless Actions runner (the workflow itself provides the
 * "don't overlap" guarantee via concurrency, and the git commit at the end
 * IS the heartbeat).
 */
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { catchUpSince, readLastOk } from './lib/catch-up.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const CHECKPOINT = join(ROOT, 'data', 'cache', 'ats-ghal-checkpoint.json');
const HEARTBEAT = join(ROOT, 'data', 'scan-ghal-heartbeat.json');
const ATS = 'greenhouse,ashby,lever';
// Fresh sweeps reach back past any missed runs; a resumed one keeps its checkpoint's cutoff.
const lastOk = readLastOk(HEARTBEAT);
const SINCE = String(catchUpSince(process.env.GHAL_SINCE || '4', lastOk));

mkdirSync(dirname(CHECKPOINT), { recursive: true });

const resume = existsSync(CHECKPOINT);
const args = [
  'scan-ats-full.mjs',
  '--ats', ATS,
  '--since', SINCE,
  '--checkpoint', CHECKPOINT,
];
if (resume) args.push('--resume');

console.log(`[${new Date().toISOString()}] ${resume ? 'resume' : 'start fresh'} GHAL sweep --since ${SINCE}`);

const started = Date.now();
const r = spawnSync(process.execPath, args, {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, CAREER_OPS_COOLDOWN_PATH: 'data/cache/scan-dead-boards-ghal.json' },
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
  mode: 'ghal-reverse-actions',
  ats: ATS.split(','),
  lastOkAt: r.status === 0 && !incomplete ? at : lastOk,
}, null, 2));

console.log(`[${new Date().toISOString()}] ${r.status === 0 ? 'ok' : 'fail'} exit=${r.status} after ${elapsed}s`);
process.exit(r.status ?? 1);
