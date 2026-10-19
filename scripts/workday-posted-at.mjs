#!/usr/bin/env node
/**
 * Real publish dates for Workday postings. The list API only gives a
 * relative badge — "Posted 30+ Days Ago" (stored as a 31-day lower bound),
 * or a "Posted Today" that also appears when an old req is merely refreshed —
 * so scan rows' posted_at can be weeks off. The job-detail startDate is the
 * original date: look it up once per Workday posting and keep it in
 * data/workday-posted-at.json, which the site prefers over the list date.
 *
 *   node scripts/workday-posted-at.mjs [scan-history.tsv …]
 *
 * Never fails the workflow: a posting whose lookup fails keeps its list date
 * and is retried after two days.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { fetchWorkdayJobPostedAt } from '../providers/workday.mjs';
import { mapPool } from '../lib/ats-posted-at.mjs';

const OUT = 'data/workday-posted-at.json';
const RETRY_MS = 2 * 86_400_000;
const files = process.argv.length > 2
  ? process.argv.slice(2)
  : ['data/scan-history-workday.tsv', 'data/scan-history-tracked.tsv'];

function workdayRows(file) {
  if (!existsSync(file)) return [];
  const [head, ...lines] = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
  const col = Object.fromEntries((head || '').split('\t').map((h, i) => [h, i]));
  return lines
    .map((l) => l.split('\t'))
    .filter((c) => c[col.status] === 'added' && /\.myworkdayjobs\.com\//i.test(c[col.url] || ''))
    .map((c) => c[col.url]);
}

let cache = {};
try {
  cache = JSON.parse(readFileSync(OUT, 'utf8'));
} catch {}

const now = Date.now();
const urls = [...new Set(files.flatMap(workdayRows))];
const todo = urls.filter((u) => !cache[u] || (!cache[u].at && now - Date.parse(cache[u].checked) > RETRY_MS));

const found = await mapPool(todo, 6, async (url) => {
  const ms = await fetchWorkdayJobPostedAt(url);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
});

const next = {};
for (const u of urls) if (cache[u]) next[u] = cache[u]; // drop postings no longer in any history
todo.forEach((u, i) => { next[u] = { at: found[i], checked: new Date(now).toISOString() }; });
writeFileSync(OUT, `${JSON.stringify(next, null, 1)}\n`);

const got = found.filter(Boolean).length;
console.log(`workday posted-at: ${urls.length} postings, looked up ${todo.length} (${got} dated, ${todo.length - got} failed)`);
