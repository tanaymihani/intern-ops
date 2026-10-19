#!/usr/bin/env node
/**
 * Single-cycle Workday reverse-scan runner for GitHub Actions.
 *
 * Moved off the laptop (was scripts/scan-workday.mjs, --loop --sleep 900)
 * as part of fully offloading career-ops's scraping onto free GitHub
 * Actions compute. Same pattern as run.mjs (GHAL) and run-seeds.mjs: own
 * checkpoint, own output files, so pushes never race the other workflows.
 */
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { catchUpSince, readLastOk } from './lib/catch-up.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const CHECKPOINT = join(ROOT, 'data', 'cache', 'ats-workday-checkpoint.json');
// Settings of the sweep in progress, so resumed runs keep them.
const SWEEP = join(ROOT, 'data', 'cache', 'ats-workday-sweep.json');
const HEARTBEAT = join(ROOT, 'data', 'scan-workday-heartbeat.json');
// Fresh sweeps reach back past any missed runs; a resumed one keeps its checkpoint's cutoff.
const lastOk = readLastOk(HEARTBEAT);
const SINCE = String(catchUpSince(process.env.WORKDAY_SINCE || '1', lastOk));

mkdirSync(dirname(CHECKPOINT), { recursive: true });

// WORKDAY_FRESH discards an unfinished sweep, e.g. to start a backfill now.
if (/^(1|true)$/i.test(process.env.WORKDAY_FRESH || '')) rmSync(CHECKPOINT, { force: true });
const resume = existsSync(CHECKPOINT);
// A resumed sweep keeps the keyword search it started with: the scheduler
// dispatches with defaults, which would switch a backfill's remaining
// tenants to the plain newest-first walk.
let searchText = String(process.env.WORKDAY_SEARCH_TEXT || '').trim();
if (resume) {
  try {
    searchText = JSON.parse(readFileSync(SWEEP, 'utf8')).searchText ?? searchText;
  } catch {}
} else {
  writeFileSync(SWEEP, JSON.stringify({ searchText, since: Number(SINCE), startedAt: new Date().toISOString() }, null, 2));
}
const args = ['scan-ats-full.mjs', '--ats', 'workday', '--since', SINCE, '--checkpoint', CHECKPOINT];
if (resume) args.push('--resume');

console.log(`[${new Date().toISOString()}] ${resume ? 'resume' : 'start fresh'} Workday sweep --since ${SINCE}${searchText ? ` search "${searchText}"` : ''}`);

const started = Date.now();
const r = spawnSync(process.execPath, args, {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    WORKDAY_SEARCH_TEXT: searchText,
    CAREER_OPS_SCAN_HISTORY: 'data/scan-history-workday.tsv',
    CAREER_OPS_PIPELINE: 'data/pipeline-workday.md',
    CAREER_OPS_COOLDOWN_PATH: 'data/cache/scan-dead-boards-workday.json',
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
  mode: 'workday-reverse-via-actions',
  ...(searchText ? { searchText } : {}),
  lastOkAt: r.status === 0 && !incomplete ? at : lastOk,
}, null, 2));

console.log(`[${new Date().toISOString()}] ${r.status === 0 ? 'ok' : 'fail'} exit=${r.status} after ${elapsed}s`);
process.exit(r.status ?? 1);
