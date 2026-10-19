#!/usr/bin/env node
/**
 * Single-cycle tracked-boards scan runner for GitHub Actions (portals.yml's
 * curated company list — SmartRecruiters, iCIMS-api, Oracle Cloud,
 * SuccessFactors, BambooHR, etc. Moved off the laptop from
 * scripts/hourly-scan.mjs, which just ran `node scan.mjs --since N`.
 */
import { spawnSync } from 'child_process';
import { writeFileSync } from 'fs';
import { catchUpSince, readLastOk } from './lib/catch-up.mjs';

const HEARTBEAT = 'data/scan-tracked-heartbeat.json';
const lastOk = readLastOk(HEARTBEAT);
const SINCE = String(catchUpSince(process.env.TRACKED_SINCE || '1', lastOk));

console.log(`[${new Date().toISOString()}] tracked-boards scan --since ${SINCE}`);

const started = Date.now();
const r = spawnSync(process.execPath, ['scan.mjs', '--since', SINCE], {
  encoding: 'utf8',
  env: {
    ...process.env,
    CAREER_OPS_SCAN_HISTORY: 'data/scan-history-tracked.tsv',
    CAREER_OPS_PIPELINE: 'data/pipeline-tracked.md',
  },
});
const out = `${r.stdout || ''}${r.stderr || ''}`;
process.stdout.write(out);
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

const m = out.match(/New matches:\s*(\d+)/i);
const at = new Date().toISOString();
writeFileSync(HEARTBEAT, JSON.stringify({
  at,
  since: Number(SINCE),
  exitCode: r.status ?? 1,
  elapsedSec: Number(elapsed),
  newMatches: m ? Number(m[1]) : null,
  mode: 'tracked-boards-via-actions',
  lastOkAt: r.status === 0 ? at : lastOk,
}, null, 2));

console.log(`[${new Date().toISOString()}] ${r.status === 0 ? 'ok' : 'fail'} exit=${r.status} after ${elapsed}s`);
process.exit(r.status ?? 1);
