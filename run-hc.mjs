#!/usr/bin/env node
/**
 * Single-cycle HiringCafe feed runner for GitHub Actions. Thin wrapper
 * around fetch-hiringcafe-feed.mjs (single-cycle, no --loop) — same file as
 * career-ops's local copy, just re-pathed for this repo's flat layout.
 * Must run under xvfb-run (patchright needs a real X display even on a
 * headless Linux runner — see workflow for why).
 */
import { spawnSync } from 'child_process';

const started = Date.now();
const r = spawnSync(process.execPath, ['fetch-hiringcafe-feed.mjs', ...process.argv.slice(2)], { stdio: 'inherit' });
const elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.log(`[${new Date().toISOString()}] ${r.status === 0 ? 'ok' : 'fail'} exit=${r.status} after ${elapsed}s`);
process.exit(r.status ?? 1);
