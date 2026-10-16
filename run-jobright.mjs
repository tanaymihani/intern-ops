#!/usr/bin/env node
/**
 * Single-cycle JobRight runner for GitHub Actions. Uses JOBRIGHT_COOKIE (a
 * session cookie, not a password — captured once from the user's own logged
 * -in browser and stored as an encrypted repo secret) instead of the local
 * --login interactive flow. Cookie-based auth runs headless (see
 * scrape-jobright.py: `headless=not login`), so unlike HC this doesn't need
 * Xvfb.
 *
 * `--boards-only` is intentionally NOT used here: discovering companies
 * (not listings — the Jobs UI never shows raw JobRight cards) is the whole
 * point of keeping this source at all.
 */
import { spawnSync } from 'child_process';

const started = Date.now();
const r = spawnSync(process.execPath, ['fetch-jobright-feed.mjs', '--max', '200', '--if-stale-companies'], { stdio: 'inherit' });
const elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.log(`[${new Date().toISOString()}] ${r.status === 0 ? 'ok' : 'fail'} exit=${r.status} after ${elapsed}s`);
process.exit(r.status ?? 1);
