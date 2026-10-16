#!/usr/bin/env node
/**
 * Next Play feed — public, unauthenticated API behind nextplay.so/jobs
 * (white-labeled on HireAScout: api.hireascout.com/api/opportunities/public).
 * Discovered via the site's own network requests — no login, no scraping
 * needed, just a plain paginated JSON GET.
 *
 * Keeps AI/ML + quant internships (lib/classify.mjs; NextPlay's own
 * type === "internship" counts as the internship signal) within the
 * keep-window.
 *
 *   node scripts/fetch-nextplay-feed.mjs
 *   node scripts/fetch-nextplay-feed.mjs --loop --sleep 900
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { canonicalGhalKey } from './lib/ghal-job-key.mjs';
import { mergeDiscoveredJobs } from './lib/feed-discovery.mjs';
import { classifyJob, seasonIsPast } from './lib/classify.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(ROOT, 'data/nextplay-feed.json');
const HEARTBEAT = resolve(ROOT, 'data/scan-nextplay-heartbeat.json');
const LOCK = resolve(ROOT, 'data/nextplay-feed.lock');
const API = 'https://api.hireascout.com/api/opportunities/public';

function argVal(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const LOOP = process.argv.includes('--loop');
const PAGE_SIZE = 200;
const PAGES = Math.max(1, Math.min(40, Number(argVal('--pages', '15')) || 15));
const KEEP_HOURS = Math.max(1, Math.min(720, Number(argVal('--hours', '336')) || 336));
const SLEEP_SEC = Math.max(60, Number(argVal('--sleep', '900')) || 900);


function jobKey(job) {
  return canonicalGhalKey(job.url) || String(job.url || '').toLowerCase();
}

function atsFromUrl(url) {
  if (!url) return '';
  const u = String(url).toLowerCase();
  if (u.includes('greenhouse.io')) return 'Greenhouse';
  if (u.includes('ashbyhq.com')) return 'Ashby';
  if (u.includes('lever.co')) return 'Lever';
  if (u.includes('myworkdayjobs.com') || u.includes('workday.com')) return 'Workday';
  if (u.includes('nextplay.so')) return 'Next Play';
  return '';
}

function normalize(op) {
  const company = op.companyProfile?.companyName || op.companyName || '';
  const title = op.roleTitle || '';
  if (!company || !title) return null;
  const internHint = String(op.type || '').toLowerCase() === 'internship';
  const cls = classifyJob({ title, company, internHint });
  if (!cls || (cls.season && seasonIsPast(cls.season))) return null;
  const url = op.linkToRole || `https://nextplay.so/jobs/${op.id}`;
  const location = Array.isArray(op.locations) ? op.locations.join(' or ') : (op.locations || '');
  const postedAt = Date.parse(op.publishedDate || op.createdAt || '') || null;
  const salary = op.minComp || op.maxComp
    ? [op.minComp, op.maxComp].filter(Boolean).map((n) => `${op.compCurrency || '$'}${n}`).join('–')
    : '';
  return {
    url,
    company,
    title,
    location,
    postedAt,
    salary,
    workplace: op.remote ? 'Remote' : '',
    commitment: op.type || '',
    yoe: op.minYearsExp != null ? String(op.minYearsExp) : '',
    summary: '',
    tools: Array.isArray(op.skills) ? op.skills : [],
    company_tagline: '',
    ats_source: atsFromUrl(url) || 'adhoc',
    feed: 'nextplay',
    internHint,
    tracks: cls.tracks,
    season: cls.season,
    degree: cls.degree,
    coop: cls.coop,
  };
}

async function fetchPage(offset) {
  const url = `${API}?includeDev=false&limit=${PAGE_SIZE}&offset=${offset}`;
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`nextplay API ${res.status}`);
  return res.json();
}

function loadPreviousSnapshot() {
  if (!existsSync(OUT)) return { jobs: [], fetchedAt: '' };
  try {
    const raw = JSON.parse(readFileSync(OUT, 'utf8'));
    return {
      jobs: Array.isArray(raw.jobs) ? raw.jobs : [],
      fetchedAt: raw.fetchedAt || '',
    };
  } catch {
    return { jobs: [], fetchedAt: '' };
  }
}

async function fetchFeed() {
  const started = Date.now();
  const incoming = [];
  const seen = new Set();
  let total = null;
  let pagesFetched = 0;

  for (let page = 0; page < PAGES; page += 1) {
    const offset = page * PAGE_SIZE;
    const data = await fetchPage(offset);
    total = Number.isFinite(data.total) ? data.total : total;
    const ops = Array.isArray(data.opportunities) ? data.opportunities : [];
    pagesFetched = page + 1;
    let kept = 0;
    for (const op of ops) {
      const job = normalize(op);
      if (!job) continue;
      const k = jobKey(job);
      if (seen.has(k)) continue;
      seen.add(k);
      incoming.push(job);
      kept += 1;
    }
    process.stderr.write(`NextPlay page ${page + 1}/${PAGES} raw=${ops.length} kept=${kept} total_kept=${incoming.length}${total != null ? '/' + total : ''}\n`);
    if (ops.length === 0) break;
    if (offset + PAGE_SIZE >= (total ?? Infinity)) break;
    await new Promise((r) => setTimeout(r, 150));
  }

  const previous = loadPreviousSnapshot();
  const jobs = mergeDiscoveredJobs(previous.jobs, incoming, {
    keyOf: jobKey,
    now: new Date().toISOString(),
    keepHours: KEEP_HOURS,
    legacyDiscoveredAt: previous.fetchedAt,
  });
  if (!previous.jobs.length) for (const j of jobs) j.bootstrap = true;
  mkdirSync(resolve(ROOT, 'data'), { recursive: true });
  const payload = {
    fetchedAt: new Date().toISOString(),
    provider: 'nextplay',
    window: `${KEEP_HOURS}h`,
    pagesFetched,
    total,
    count: jobs.length,
    jobs,
  };
  writeFileSync(OUT, JSON.stringify(payload, null, 2));
  writeFileSync(HEARTBEAT, JSON.stringify({
    at: payload.fetchedAt,
    exitCode: 0,
    elapsedSec: Math.round((Date.now() - started) / 1000),
    newMatches: jobs.length,
    incoming: incoming.length,
    pagesFetched,
    total,
    mode: 'nextplay-public-api',
  }, null, 2));
  console.log(JSON.stringify({ ok: true, count: jobs.length, incoming: incoming.length, pagesFetched, total, out: OUT }));
  return payload;
}

function acquireLock() {
  mkdirSync(resolve(ROOT, 'data'), { recursive: true });
  if (existsSync(LOCK)) {
    try {
      const prev = JSON.parse(readFileSync(LOCK, 'utf8'));
      try {
        process.kill(prev.pid, 0);
        console.error(`skip — nextplay feed already running (pid ${prev.pid})`);
        return false;
      } catch { /* dead pid */ }
    } catch { /* replace */ }
  }
  writeFileSync(LOCK, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  return true;
}

function releaseLock() {
  try { unlinkSync(LOCK); } catch { /* ignore */ }
}

async function main() {
  if (!acquireLock()) process.exit(0);
  try {
    if (!LOOP) {
      await fetchFeed();
      return;
    }
    for (;;) {
      try {
        await fetchFeed();
      } catch (err) {
        console.error('nextplay feed error:', err.message || err);
        writeFileSync(HEARTBEAT, JSON.stringify({ at: new Date().toISOString(), exitCode: 1, error: String(err.message || err), mode: 'nextplay-public-api' }, null, 2));
      }
      process.stderr.write(`Sleeping ${SLEEP_SEC}s…\n`);
      await new Promise((r) => setTimeout(r, SLEEP_SEC * 1000));
    }
  } finally {
    releaseLock();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
