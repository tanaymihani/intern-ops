#!/usr/bin/env node
/**
 * Single-cycle NextPlay feed runner for GitHub Actions. Thin wrapper around
 * the unchanged fetch-nextplay-feed.mjs (single-cycle mode, no --loop).
 */
import { spawnSync } from 'child_process';

const started = Date.now();
const r = spawnSync(process.execPath, ['fetch-nextplay-feed.mjs'], { stdio: 'inherit' });
const elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.log(`[${new Date().toISOString()}] ${r.status === 0 ? 'ok' : 'fail'} exit=${r.status} after ${elapsed}s`);
process.exit(r.status ?? 1);
