#!/usr/bin/env node
/**
 * LinkedIn feed — LinkedIn's public (logged-out) job search, the same pages
 * anyone sees at linkedin.com/jobs/search without signing in. No account,
 * no cookies of yours: a fresh guest session per run.
 *
 * One narrow query per role family ("machine learning intern",
 * "quantitative research intern"…), filtered to experience level =
 * Internship (f_E=1), US, newest first, inside a posted-within window. The
 * first page (≤60 cards) comes from the search page itself; deeper pages
 * use the guest pagination endpoint, which only answers with the cookies the
 * search page set — hence the tiny cookie jar.
 *
 * LinkedIn rate-limits datacenter IPs hard (HTTP 429 / authwall), so in
 * GitHub Actions this runs through the Tailscale exit node like HiringCafe.
 * Pacing is deliberately slow; a blocked run stops early and says so in the
 * heartbeat instead of hammering.
 *
 *   node fetch-linkedin-feed.mjs                 # past 24h, first page per query
 *   node fetch-linkedin-feed.mjs --days 30 --pages 4   # backfill
 */
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { classifyJob, seasonIsPast } from './lib/classify.mjs';
import { readJson, writeJsonAtomic, writeFeedFile, mergeRolling, cellText } from './lib/feed-io.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(ROOT, 'data/linkedin-feed.json');
const HEARTBEAT = resolve(ROOT, 'data/scan-linkedin-heartbeat.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

function argVal(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const DAYS = Math.max(1, Math.min(30, Number(argVal('--days', '1')) || 1));
// Extra 10-card pages fetched past the first ≤60-card page, per query.
const EXTRA_PAGES = Math.max(0, Math.min(10, Number(argVal('--pages', '0')) || 0));
const KEEP_DAYS = 30;
// Queries per run. LinkedIn 429s a guest IP after a handful of rapid
// searches, so each run takes the next slice of QUERIES (cursor persisted in
// data/cache) and the full list cycles every few runs.
const BATCH = Math.max(1, Math.min(50, Number(argVal('--batch', '6')) || 6));
const CURSOR = resolve(ROOT, 'data/cache/linkedin-cursor.json');

export const QUERIES = [
  'machine learning intern',
  'machine learning engineer intern',
  'AI engineer intern',
  'artificial intelligence intern',
  'AI research intern',
  'data science intern',
  'data scientist intern',
  'deep learning intern',
  'computer vision intern',
  'NLP intern',
  'LLM intern',
  'generative AI intern',
  'research scientist intern',
  'applied scientist intern',
  'robotics learning intern',
  'machine learning co-op',
  'data science co-op',
  'quantitative research intern',
  'quantitative trading intern',
  'quantitative developer intern',
  'quantitative analyst intern',
  'quant intern',
  'trading intern',
  'algorithmic trading intern',
  'quant co-op',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (min, max) => min + Math.random() * (max - min);

class BlockedError extends Error {}

function makeSession() {
  const jar = new Map();
  return {
    async get(url, referer) {
      const headers = {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
      };
      if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      if (referer) headers.referer = referer;
      const res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(25_000) });
      for (const c of res.headers.getSetCookie?.() || []) {
        const [pair] = c.split(';');
        const eq = pair.indexOf('=');
        if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
      const body = await res.text();
      const location = res.headers.get('location') || '';
      if (res.status === 429 || res.status === 999 || /authwall|checkpoint|login/i.test(location)
        || (res.status === 200 && /_0x[0-9a-f]{4,}|challenge-platform/i.test(body.slice(0, 3000)) && !/jobPosting/.test(body))) {
        throw new BlockedError(`LinkedIn blocked (${res.status}${location ? ` → ${location.slice(0, 60)}` : ''})`);
      }
      if (res.status >= 300 && res.status < 400) return { status: res.status, body: '' };
      if (!res.ok) throw new Error(`LinkedIn HTTP ${res.status}`);
      return { status: res.status, body };
    },
  };
}

function searchUrl(keywords, start, api = false) {
  const base = api
    ? 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search'
    : 'https://www.linkedin.com/jobs/search';
  const p = new URLSearchParams({
    keywords,
    location: 'United States',
    geoId: '103644278',
    f_E: '1', // experience level: Internship
    f_TPR: `r${DAYS * 86400}`,
    sortBy: 'DD',
  });
  if (start) p.set('start', String(start));
  return `${base}?${p}`;
}

/**
 * The card says "14 hours ago" in the <time> text but only a date in its
 * datetime attribute — use the text when it's minutes/hours, so a posting
 * from this morning isn't shown as just "today".
 */
export function postedFromCard(timeText, date, now = Date.now()) {
  const m = String(timeText || '').toLowerCase().match(/(\d+)\s*(minute|min|hour|hr)s?\s+ago/);
  if (m) {
    const ms = Number(m[1]) * (m[2].startsWith('h') ? 3600000 : 60000);
    return new Date(now - ms).toISOString();
  }
  if (/just now|moments? ago/.test(String(timeText || '').toLowerCase())) return new Date(now).toISOString();
  return date || null;
}

/** Parse guest job cards (search page and pagination fragment share markup). */
export function parseCards(html, now = Date.now()) {
  const out = [];
  const chunks = String(html || '').split(/(?=<div[^>]+data-entity-urn="urn:li:jobPosting:\d+")/);
  for (const chunk of chunks) {
    const id = chunk.match(/data-entity-urn="urn:li:jobPosting:(\d+)"/)?.[1];
    if (!id) continue;
    const title = cellText(chunk.match(/base-search-card__title">([\s\S]*?)<\/h3>/)?.[1]);
    const company = cellText(chunk.match(/base-search-card__subtitle">([\s\S]*?)<\/h4>/)?.[1]);
    const location = cellText(chunk.match(/job-search-card__location">([\s\S]*?)<\/span>/)?.[1]);
    const timeTag = chunk.match(/<time[^>]*datetime="(\d{4}-\d{2}-\d{2})"[^>]*>([\s\S]*?)<\/time>/);
    const date = timeTag?.[1] || chunk.match(/datetime="(\d{4}-\d{2}-\d{2})"/)?.[1] || '';
    const timeText = cellText(timeTag?.[2] || '');
    const salary = cellText(chunk.match(/job-search-card__salary-info">([\s\S]*?)<\/span>/)?.[1]);
    if (!title || !company) continue;
    out.push({
      id,
      title,
      company,
      location,
      // Exact time for "N hours ago" cards, otherwise the day LinkedIn gives.
      postedAt: postedFromCard(timeText, date, now),
      salary,
      url: `https://www.linkedin.com/jobs/view/${id}/`,
      repost: /\breposted\b/i.test(chunk),
    });
  }
  return out;
}

async function runQuery(session, keywords) {
  const cards = [];
  const first = await session.get(searchUrl(keywords, 0), 'https://www.linkedin.com/jobs');
  const page1 = parseCards(first.body);
  cards.push(...page1);
  let start = page1.length;
  for (let p = 0; p < EXTRA_PAGES && page1.length >= 25; p += 1) {
    await sleep(jitter(1500, 3500));
    const r = await session.get(searchUrl(keywords, start, true), searchUrl(keywords, 0));
    const batch = parseCards(r.body);
    if (!batch.length) break;
    cards.push(...batch);
    start += batch.length;
    if (batch.length < 10) break;
  }
  return cards;
}

/** This run's queries: --all, or the next BATCH after the persisted cursor. */
function nextBatch() {
  if (process.argv.includes('--all')) return QUERIES;
  const cursor = Number(readJson(CURSOR, {})?.next) || 0;
  const batch = [];
  for (let i = 0; i < Math.min(BATCH, QUERIES.length); i += 1) batch.push(QUERIES[(cursor + i) % QUERIES.length]);
  return batch;
}

async function main() {
  const started = Date.now();
  const batch = nextBatch();
  const now = new Date().toISOString();
  const session = makeSession();
  const perQuery = {};
  const seen = new Set();
  const incoming = [];
  let blocked = '';
  let errors = 0;

  // Warm the session the way a browser would before searching.
  try {
    await session.get('https://www.linkedin.com/jobs', null);
  } catch (err) {
    if (err instanceof BlockedError) blocked = err.message;
  }

  let done = 0;
  for (const q of blocked ? [] : batch) {
    try {
      let cards;
      try {
        cards = await runQuery(session, q);
      } catch (err) {
        if (!(err instanceof BlockedError)) throw err;
        // One patient retry: guest 429s usually clear within a minute or two.
        process.stderr.write(`LinkedIn [${q}] ${err.message} — backing off 90s\n`);
        await sleep(90_000);
        cards = await runQuery(session, q);
      }
      done += 1;
      let kept = 0;
      for (const c of cards) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        const cls = classifyJob({ title: c.title, company: c.company, internHint: true });
        if (!cls || (cls.season && seasonIsPast(cls.season))) continue;
        incoming.push({
          title: c.title,
          company: c.company,
          url: c.url,
          location: c.location,
          postedAt: c.postedAt,
          salary: c.salary,
          repost: c.repost || undefined,
          internHint: true,
          tracks: cls.tracks,
          season: cls.season,
          degree: cls.degree,
          coop: cls.coop,
          feed: 'linkedin',
          source: 'LinkedIn',
        });
        kept += 1;
      }
      perQuery[q] = { cards: cards.length, kept };
      process.stderr.write(`LinkedIn [${q}] cards=${cards.length} kept=${kept}\n`);
    } catch (err) {
      if (err instanceof BlockedError) {
        blocked = err.message;
        process.stderr.write(`LinkedIn [${q}] ${blocked} — stopping this run\n`);
        break;
      }
      errors += 1;
      perQuery[q] = { error: String(err.message || err) };
      process.stderr.write(`LinkedIn [${q}] error: ${err.message}\n`);
    }
    await sleep(jitter(7000, 13000));
  }
  // Advance past the queries that actually ran, so a blocked run retries the rest next time.
  if (!process.argv.includes('--all')) {
    const cursor = Number(readJson(CURSOR, {})?.next) || 0;
    writeJsonAtomic(CURSOR, { next: done ? (cursor + done) % QUERIES.length : cursor, at: now });
  }

  const previous = readJson(OUT, { jobs: [] });
  const jobs = mergeRolling(previous.jobs, incoming, { now, keepDays: KEEP_DAYS });
  writeFeedFile(OUT, { fetchedAt: now, provider: 'linkedin', days: DAYS }, jobs);
  const ok = !blocked || incoming.length > 0;
  writeJsonAtomic(HEARTBEAT, {
    at: now,
    exitCode: ok ? 0 : 1,
    elapsedSec: Math.round((Date.now() - started) / 1000),
    newMatches: incoming.length,
    total: jobs.length,
    blocked: blocked || undefined,
    errors,
    days: DAYS,
    queries: Object.keys(perQuery).length,
    batch,
    mode: 'linkedin-guest-search',
  }, { pretty: true });
  console.log(JSON.stringify({ ok, incoming: incoming.length, total: jobs.length, blocked: blocked || null }));
  // A block is an infrastructure signal (IP reputation), not a code failure —
  // exit 0 so the workflow still commits the heartbeat that reports it.
  process.exit(0);
}

// Only run when executed directly (tests import the parsers).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((err) => {
  console.error(err);
  process.exit(1);
});
