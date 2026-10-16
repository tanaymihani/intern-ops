#!/usr/bin/env node
/**
 * Liveness check for scanned postings. The scan histories are append-only,
 * and internships stay "found" for months, so without this a filled role keeps
 * showing up long after the employer took it down. For every Greenhouse /
 * Ashby / Lever board that contributed a posting, fetch the board's current
 * open job IDs (one request per board, not per job) and record anything no
 * longer listed in data/closed-jobs.json. The dashboard hides those keys from
 * every source — a closed posting is closed no matter who listed it.
 *
 * Workday and custom career sites are skipped (no cheap per-board listing);
 * they age out of the dashboard after 120 days instead.
 *
 *   node check-liveness.mjs
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import { fetchJson } from './providers/_http.mjs';
import { mapPool } from './lib/ats-posted-at.mjs';
import { jobKey, readJson, writeJsonAtomic } from './lib/feed-io.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(ROOT, 'data/closed-jobs.json');
const HEARTBEAT = resolve(ROOT, 'data/scan-liveness-heartbeat.json');
const HISTORY = ['scan-history.tsv', 'scan-history-workday.tsv', 'scan-history-tracked.tsv', 'scan-history-seeds.tsv'];
const MAX_AGE_DAYS = 120;
const KEEP_CLOSED_DAYS = 180;

const BOARD_PATTERNS = [
  { ats: 'greenhouse', re: /^https?:\/\/(?:job-boards|boards)(\.eu)?\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i,
    api: (m) => `https://boards-api${m[1] ? '.eu' : ''}.greenhouse.io/v1/boards/${m[2]}/jobs`,
    ids: (json) => (json?.jobs || []).map((j) => String(j.id)), id: (m) => m[3] },
  { ats: 'ashby', re: /^https?:\/\/jobs\.ashbyhq\.com\/([^/?#]+)\/([0-9a-f-]{36})/i,
    api: (m) => `https://api.ashbyhq.com/posting-api/job-board/${m[1]}`,
    ids: (json) => (json?.jobs || []).map((j) => String(j.id).toLowerCase()), id: (m) => m[2].toLowerCase() },
  { ats: 'lever', re: /^https?:\/\/jobs\.lever\.co\/([^/?#]+)\/([0-9a-f-]{36})/i,
    api: (m) => `https://api.lever.co/v0/postings/${m[1]}?mode=json`,
    ids: (json) => (Array.isArray(json) ? json : []).map((j) => String(j.id).toLowerCase()), id: (m) => m[2].toLowerCase() },
];

function scannedUrls() {
  const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;
  const urls = new Set();
  for (const name of HISTORY) {
    const path = resolve(ROOT, 'data', name);
    if (!existsSync(path)) continue;
    const [head, ...lines] = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    const cols = head.split('\t');
    const iUrl = cols.indexOf('url');
    const iSeen = cols.indexOf('first_seen');
    const iStatus = cols.indexOf('status');
    for (const line of lines) {
      const c = line.split('\t');
      if (c[iStatus] && c[iStatus] !== 'added') continue;
      const seen = Date.parse(c[iSeen] || '');
      if (Number.isFinite(seen) && seen < cutoff) continue;
      if (c[iUrl]) urls.add(c[iUrl]);
    }
  }
  return [...urls];
}

async function main() {
  const started = Date.now();
  const now = new Date().toISOString();
  const boards = new Map();
  for (const url of scannedUrls()) {
    for (const p of BOARD_PATTERNS) {
      const m = url.match(p.re);
      if (!m) continue;
      const api = p.api(m);
      if (!boards.has(api)) boards.set(api, { pattern: p, jobs: [] });
      boards.get(api).jobs.push({ url, id: p.id(m) });
      break;
    }
  }

  const previous = readJson(OUT, { closed: {} })?.closed || {};
  const closed = {};
  const keepCutoff = Date.now() - KEEP_CLOSED_DAYS * 86400000;
  for (const [k, at] of Object.entries(previous)) if (Date.parse(at) >= keepCutoff) closed[k] = at;

  let checked = 0;
  let newlyClosed = 0;
  let errors = 0;
  await mapPool([...boards.entries()], 8, async ([api, { pattern, jobs }]) => {
    let open;
    try {
      open = new Set(pattern.ids(await fetchJson(api, { timeoutMs: 20_000 })));
    } catch (err) {
      // A board that 404s is gone entirely; anything else is a transient miss.
      if (err?.status === 404) open = new Set();
      else { errors += 1; return; }
    }
    for (const j of jobs) {
      checked += 1;
      const key = jobKey(j.url);
      if (!open.has(j.id) && !closed[key]) {
        closed[key] = now;
        newlyClosed += 1;
      }
    }
  });

  writeJsonAtomic(OUT, { checkedAt: now, count: Object.keys(closed).length, closed }, { pretty: true });
  writeJsonAtomic(HEARTBEAT, {
    at: now,
    exitCode: 0,
    elapsedSec: Math.round((Date.now() - started) / 1000),
    boards: boards.size,
    checked,
    newlyClosed,
    totalClosed: Object.keys(closed).length,
    errors,
    mode: 'ats-board-liveness',
  }, { pretty: true });
  console.log(JSON.stringify({ boards: boards.size, checked, newlyClosed, totalClosed: Object.keys(closed).length, errors }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
