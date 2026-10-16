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
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const CHECKPOINT = join(ROOT, 'data', 'cache', 'ats-workday-checkpoint.json');
const HEARTBEAT = join(ROOT, 'data', 'scan-workday-heartbeat.json');
const SINCE = process.env.WORKDAY_SINCE || '1';

mkdirSync(dirname(CHECKPOINT), { recursive: true });

const resume = existsSync(CHECKPOINT);
const args = ['scan-ats-full.mjs', '--ats', 'workday', '--since', SINCE, '--checkpoint', CHECKPOINT];
if (resume) args.push('--resume');

console.log(`[${new Date().toISOString()}] ${resume ? 'resume' : 'start fresh'} Workday sweep --since ${SINCE}`);

const started = Date.now();
const r = spawnSync(process.execPath, args, {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    CAREER_OPS_SCAN_HISTORY: 'data/scan-history-workday.tsv',
    CAREER_OPS_PIPELINE: 'data/pipeline-workday.md',
    CAREER_OPS_COOLDOWN_PATH: 'data/cache/scan-dead-boards-workday.json',
  },
});
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

writeFileSync(HEARTBEAT, JSON.stringify({
  at: new Date().toISOString(),
  since: Number(SINCE),
  exitCode: r.status ?? 1,
  elapsedSec: Number(elapsed),
  incomplete: existsSync(CHECKPOINT),
  mode: 'workday-reverse-via-actions',
}, null, 2));

console.log(`[${new Date().toISOString()}] ${r.status === 0 ? 'ok' : 'fail'} exit=${r.status} after ${elapsed}s`);
process.exit(r.status ?? 1);
