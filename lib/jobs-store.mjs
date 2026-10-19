/**
 * jobs-store.mjs — everything the dashboard API needs: read each scraper's
 * output (from GitHub raw on Vercel, or ./data locally), normalize every
 * source into one job shape, merge duplicates across sources, and classify
 * tracks with lib/classify.mjs at read time (so a classifier fix applies to
 * jobs already scraped).
 *
 * Data location:
 *   DATA_DIR=./data                 read local files (dev server, tests)
 *   DATA_REPO=owner/repo [DATA_BRANCH=main]   read raw.githubusercontent.com
 */
import { readFile } from 'fs/promises';
import { join } from 'path';
import { classifyJob, seasonIsPast } from './classify.mjs';
import { jobKey } from './feed-io.mjs';
import { decryptJson, hasFeedKey } from './feed-crypto.mjs';

const CACHE_TTL_MS = 60_000;
const SCAN_MAX_AGE_DAYS = 120;
const cache = new Map();

// ── Raw file access ─────────────────────────────────────────────────

function dataLocation() {
  if (process.env.DATA_DIR) return { kind: 'dir', dir: process.env.DATA_DIR };
  const repo = process.env.DATA_REPO || '';
  if (!repo) return { kind: 'none' };
  return { kind: 'repo', base: `https://raw.githubusercontent.com/${repo}/${process.env.DATA_BRANCH || 'main'}/data/` };
}

async function readDataFile(name) {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.text;
  const loc = dataLocation();
  let text = null;
  try {
    if (loc.kind === 'dir') {
      text = await readFile(join(loc.dir, name), 'utf8');
    } else if (loc.kind === 'repo') {
      const res = await fetch(loc.base + name, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      text = res.ok ? await res.text() : null;
    }
  } catch {
    text = null;
  }
  // A transient fetch failure keeps serving the last good copy.
  if (text == null && hit) return hit.text;
  cache.set(name, { at: Date.now(), text });
  return text;
}

async function readJsonFile(name) {
  const text = await readDataFile(name);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readEncryptedFeed(name) {
  const env = await readJsonFile(name);
  if (!env) return null;
  if (!env.alg) return env; // plaintext (local dev without FEED_KEY)
  if (!hasFeedKey()) return null;
  try {
    return decryptJson(env);
  } catch {
    return null;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

const ATS_HOSTS = [
  [/greenhouse\.io|grnh\.se/, 'Greenhouse'], [/ashbyhq\.com/, 'Ashby'], [/lever\.co/, 'Lever'],
  [/myworkdayjobs\.com|myworkdaysite\.com|workday\.com/, 'Workday'], [/icims\.com/, 'iCIMS'],
  [/smartrecruiters\.com/, 'SmartRecruiters'], [/workable\.com/, 'Workable'], [/bamboohr\.com/, 'BambooHR'],
  [/oraclecloud\.com|taleo\.net/, 'Oracle'], [/successfactors|sapsf\./, 'SuccessFactors'], [/eightfold\.ai/, 'Eightfold'],
  [/jobvite\.com/, 'Jobvite'], [/recruitee\.com/, 'Recruitee'], [/rippling\.com/, 'Rippling'], [/dayforcehcm\.com/, 'Dayforce'],
  [/linkedin\.com/, 'LinkedIn'], [/joinhandshake\.com/, 'Handshake'], [/jobright\.ai/, 'JobRight'], [/simplify\.jobs/, 'Simplify'],
];

export function atsFromUrl(url) {
  const u = String(url || '').toLowerCase();
  for (const [re, label] of ATS_HOSTS) if (re.test(u)) return label;
  try {
    return new URL(url).hostname.replace(/^(www|careers|jobs)\./, '');
  } catch {
    return '';
  }
}

const DIRECT_FEEDS = new Set(['scan']);
// Which URL wins when the same posting arrives from several feeds: the
// employer's own page beats an aggregator's copy, and anything public beats
// a login-only Handshake link.
const URL_RANK = { scan: 0, simplify: 1, speedyapply: 1, nwquant: 1, cscareers: 1, hc: 2, nextplay: 2, jrboard: 2, jrlist: 3, jobright: 3, linkedin: 4, handshake: 5 };

const FEED_LABELS = {
  scan: 'Direct ATS scan', simplify: 'Simplify', cscareers: 'CSCareers', speedyapply: 'SpeedyApply',
  nwquant: 'NU FinTech', jrlist: 'JobRight list', jobright: 'JobRight', jrboard: 'JobRight board',
  linkedin: 'LinkedIn', handshake: 'Handshake', hc: 'HiringCafe', nextplay: 'NextPlay',
};

function isoDate(ms) {
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : '';
}

function toMs(v) {
  if (v == null || v === '') return NaN;
  if (typeof v === 'number') return v;
  return Date.parse(String(v));
}

const normCompany = (s) => String(s || '').toLowerCase()
  .replace(/&/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\b(inc|llc|lp|ltd|corp|corporation|co|company|the|group|holdings|technologies|technology|usa|us|na)\b/g, ' ')
  .replace(/\s+/g, ' ').trim();

const normTitle = (s) => String(s || '').toLowerCase()
  .replace(/\b(summer|fall|autumn|spring|winter)\s*'?(20)?2\d\b|\b(20)?2\d\s*(summer|fall|spring|winter)\b/g, ' ')
  .replace(/\b(internship|intern)\b/g, 'intern')
  .replace(/[^a-z0-9+#]+/g, ' ')
  .replace(/\s+/g, ' ').trim();

export function fingerprint(company, title) {
  const c = normCompany(company);
  const t = normTitle(title);
  return c && t ? `${c}|${t}` : '';
}

// ── Source readers → normalized records ─────────────────────────────

/** "bedrock-robotics" → "Bedrock Robotics"; real names pass through untouched. */
export function displayCompany(name) {
  const s = String(name || '').trim();
  if (!/^[a-z0-9]+([-_.][a-z0-9]+)*$/.test(s)) return s;
  return s.split(/[-_.]/).map((w) => (w.length <= 2 && !/^(ai|io)$/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ')
    .replace(/\bAi\b/g, 'AI');
}

function record({
  url, title, company, location = '', firstSeen = '', postedAt = null, feed, salary = '', workplace = '',
  commitment = '', summary = '', tools = [], tagline = '', repost = false, trustScore = null, trustFlags = [],
  hints = {}, sponsorship = '', bootstrap = false, companyUrl = '', contacts = [],
}) {
  if (!url || !title) return null;
  const cls = classifyJob({ title, company, ...hints });
  if (!cls) return null;
  if (cls.season && seasonIsPast(cls.season)) return null;
  const postedMs = toMs(postedAt);
  const dateOnly = typeof postedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(postedAt);
  // A source's first run "finds" its whole backlog at once; date those by the
  // employer's posting date so "Today" means new today.
  let found = firstSeen || '';
  if (bootstrap && Number.isFinite(postedMs) && (!found || postedMs < toMs(found))) {
    found = dateOnly ? postedAt : new Date(postedMs).toISOString();
  }
  return {
    key: jobKey(url),
    url,
    title: String(title).trim(),
    company: displayCompany(company) || 'Unknown',
    slugName: displayCompany(company) !== String(company || '').trim(),
    location: String(location || '').trim(),
    first_seen: found,
    posted_at: Number.isFinite(postedMs) ? (dateOnly ? postedAt : new Date(postedMs).toISOString().slice(0, 10)) : '',
    posted_at_full: Number.isFinite(postedMs) && !dateOnly ? new Date(postedMs).toISOString() : '',
    ats: atsFromUrl(url),
    feed,
    sources: [FEED_LABELS[feed] || feed],
    salary: salary || '',
    workplace: workplace || '',
    commitment: commitment || '',
    summary: summary || '',
    tools: Array.isArray(tools) ? tools.slice(0, 12) : [],
    company_tagline: tagline || '',
    repost: Boolean(repost),
    trust_score: Number.isFinite(trustScore) ? trustScore : undefined,
    trust_flags: trustFlags && trustFlags.length ? trustFlags : undefined,
    tracks: cls.tracks,
    season: cls.season,
    degree: cls.degree,
    coop: cls.coop,
    sponsorship: sponsorship || '',
    company_url: companyUrl || '',
    contacts: Array.isArray(contacts) ? contacts.slice(0, 6) : [],
    untrustedAge: !Number.isFinite(postedMs),
  };
}

function parseTsv(text) {
  const lines = String(text || '').split('\n').filter((l) => l.trim());
  if (!lines.length) return [];
  const head = lines[0].split('\t');
  return lines.slice(1).map((l) => {
    const cells = l.split('\t');
    const row = {};
    head.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    if (row.category == null && cells.length > 12) row.category = cells[12];
    return row;
  });
}

// The history TSVs are append-only, so the earliest first_seen is the
// scanner's first (backfill) run; a resumed first sweep can span a few runs.
const SCAN_BOOTSTRAP_WINDOW_MS = 3 * 3600 * 1000;

async function fromScanHistory(name) {
  const rows = parseTsv(await readDataFile(name));
  const cutoff = Date.now() - SCAN_MAX_AGE_DAYS * 86400000;
  const t0 = Math.min(...rows.map((r) => toMs(r.first_seen)).filter(Number.isFinite));
  const out = [];
  for (const r of rows) {
    if (r.status && r.status !== 'added') continue;
    const seen = toMs(r.first_seen);
    if (Number.isFinite(seen) && seen < cutoff) continue;
    const rec = record({
      url: r.url,
      title: r.title,
      company: r.company,
      location: r.location,
      firstSeen: r.first_seen,
      postedAt: r.posted_at || null,
      feed: 'scan',
      bootstrap: Number.isFinite(seen) && seen - t0 <= SCAN_BOOTSTRAP_WINDOW_MS,
      hints: r.category ? { category: r.category } : {},
      trustScore: r.trust_score ? Number(r.trust_score) : null,
      trustFlags: r.trust_flags ? r.trust_flags.split(',') : [],
    });
    if (rec) out.push(rec);
  }
  return out;
}

async function fromSnapshotFeed(name, feedFallback, { encrypted = false } = {}) {
  const payload = encrypted ? await readEncryptedFeed(name) : await readJsonFile(name);
  const out = [];
  for (const j of payload?.jobs || []) {
    const feed = j.feed || feedFallback;
    const rec = record({
      url: j.url || j.applyUrl,
      title: j.title,
      company: j.company,
      location: j.location,
      firstSeen: j.discoveredAt || j.firstSeenAt || payload.fetchedAt || '',
      postedAt: j.postedAt ?? null,
      feed,
      salary: j.salary,
      workplace: j.workplace,
      commitment: j.commitment,
      summary: j.summary,
      tools: j.tools,
      tagline: j.company_tagline,
      repost: j.repost,
      sponsorship: j.sponsorship,
      companyUrl: j.company_url,
      contacts: j.contacts,
      bootstrap: Boolean(j.bootstrap),
      hints: { internHint: j.internHint ?? true, category: j.category, listCategory: j.listCategory, terms: j.terms, degrees: j.degrees, commitment: j.commitment },
    });
    if (rec) out.push(rec);
  }
  return out;
}

async function fromJrBoardFresh() {
  const payload = await readJsonFile('jr-board-fresh.json');
  const out = [];
  for (const j of payload?.jobs || []) {
    const rec = record({
      url: j.url,
      title: j.title,
      company: j.company,
      location: j.location,
      firstSeen: payload.fetchedAt || '',
      postedAt: j.postedAt || null,
      feed: 'scan',
      salary: j.salary,
    });
    if (rec) out.push(rec);
  }
  return out;
}

// ── Merge ───────────────────────────────────────────────────────────

const BOARD_SLUG_RE = /^https?:\/\/(?:jobs\.ashbyhq\.com|jobs\.lever\.co|(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io)\/([^/?#]+)/i;
const boardSlug = (url) => (String(url || '').match(BOARD_SLUG_RE)?.[1] || '').toLowerCase();

function mergeInto(a, b) {
  const feeds = new Set([...a.feed.split('+'), ...b.feed.split('+')]);
  const rankA = Math.min(...a.feed.split('+').map((f) => URL_RANK[f] ?? 9));
  const rankB = Math.min(...b.feed.split('+').map((f) => URL_RANK[f] ?? 9));
  if (rankB < rankA) {
    a.url = b.url;
    a.ats = b.ats;
    a.title = b.title;
    if (!b.slugName || a.slugName) {
      a.company = b.company;
      a.slugName = b.slugName;
    }
  } else if (a.slugName && !b.slugName) {
    a.company = b.company;
    a.slugName = false;
  }
  a.feed = [...feeds].sort((x, y) => (URL_RANK[x] ?? 9) - (URL_RANK[y] ?? 9)).join('+');
  a.sources = [...new Set([...a.sources, ...b.sources])];
  const fa = toMs(a.first_seen);
  const fb = toMs(b.first_seen);
  if (!Number.isFinite(fa) || (Number.isFinite(fb) && fb < fa)) a.first_seen = b.first_seen;
  // Employer dates: the direct scan's is authoritative; otherwise the earliest.
  if (b.feed.split('+').some((f) => DIRECT_FEEDS.has(f)) && b.posted_at) {
    a.posted_at = b.posted_at;
    a.posted_at_full = b.posted_at_full;
  } else if (b.posted_at && (!a.posted_at || b.posted_at < a.posted_at) && !a.feed.split('+').some((f) => DIRECT_FEEDS.has(f))) {
    a.posted_at = b.posted_at;
    a.posted_at_full = b.posted_at_full;
  }
  a.untrustedAge = !a.posted_at;
  for (const f of ['salary', 'workplace', 'commitment', 'summary', 'company_tagline', 'sponsorship', 'season', 'degree', 'company_url']) {
    if (!a[f] && b[f]) a[f] = b[f];
  }
  if (!a.tools.length && b.tools.length) a.tools = b.tools;
  if (b.contacts?.length) {
    const seen = new Set(a.contacts.map((c) => c.name.toLowerCase()));
    a.contacts = [...a.contacts, ...b.contacts.filter((c) => !seen.has(c.name.toLowerCase()))].slice(0, 6);
  }
  if (!a.location && b.location) a.location = b.location;
  a.tracks = [...new Set([...a.tracks, ...b.tracks])];
  a.coop = a.coop || b.coop;
  a.repost = a.repost || b.repost;
  return a;
}

export async function loadAllJobs() {
  const [closedFile, ...batches] = await Promise.all([
    readJsonFile('closed-jobs.json'),
    fromScanHistory('scan-history.tsv'),
    fromScanHistory('scan-history-workday.tsv'),
    fromScanHistory('scan-history-tracked.tsv'),
    fromScanHistory('scan-history-seeds.tsv'),
    fromJrBoardFresh(),
    fromSnapshotFeed('lists-feed.json', 'lists'),
    fromSnapshotFeed('quant-sites-feed.json', 'scan'),
    fromSnapshotFeed('linkedin-feed.json', 'linkedin'),
    fromSnapshotFeed('hiringcafe-feed.json', 'hc'),
    fromSnapshotFeed('nextplay-feed.json', 'nextplay'),
    fromSnapshotFeed('handshake-feed.enc.json', 'handshake', { encrypted: true }),
    // Local-only Handshake output (no FEED_KEY) — git-ignored, so only the dev server sees it.
    fromSnapshotFeed('handshake-feed.local.json', 'handshake'),
    fromSnapshotFeed('jobright-feed.local.json', 'jobright'),
    fromSnapshotFeed('jobright-feed.enc.json', 'jobright', { encrypted: true }),
  ]);

  // Postings the liveness check saw disappear from their employer's board.
  const closed = closedFile?.closed || {};
  const byKey = new Map();
  const byPrint = new Map();
  for (const rec of batches.flat()) {
    if (closed[rec.key]) continue;
    const fp = fingerprint(rec.company, rec.title);
    const existing = byKey.get(rec.key) || (fp && byPrint.get(fp));
    if (existing) {
      mergeInto(existing, rec);
      byKey.set(rec.key, existing);
      continue;
    }
    byKey.set(rec.key, rec);
    if (fp) byPrint.set(fp, rec);
  }
  const jobs = [...new Set(byKey.values())];
  // Ashby / Lever sweeps only know the board slug ("openai"); learn the real
  // name from any other source that links the same board ("OpenAI").
  const names = new Map();
  for (const j of jobs) {
    const slug = !j.slugName && boardSlug(j.url);
    if (slug && !names.has(slug)) names.set(slug, j.company);
  }
  for (const j of jobs) {
    if (j.slugName && names.has(boardSlug(j.url))) j.company = names.get(boardSlug(j.url));
    delete j.slugName;
  }
  return jobs;
}

export async function jobsForTrack(track) {
  const all = await loadAllJobs();
  if (track === 'ai' || track === 'quant') return all.filter((j) => j.tracks.includes(track));
  return all;
}

// ── Heartbeats ──────────────────────────────────────────────────────

const HEARTBEATS = {
  lists: 'scan-lists-heartbeat.json',
  quantSites: 'scan-quant-sites-heartbeat.json',
  liveness: 'scan-liveness-heartbeat.json',
  linkedin: 'scan-linkedin-heartbeat.json',
  ghal: 'scan-ghal-heartbeat.json',
  workday: 'scan-workday-heartbeat.json',
  tracked: 'scan-tracked-heartbeat.json',
  seeds: 'scan-seeds-heartbeat.json',
  jr: 'scan-jr-heartbeat.json',
  handshake: 'scan-handshake-heartbeat.json',
};

export async function loadHeartbeats() {
  const entries = await Promise.all(Object.entries(HEARTBEATS).map(async ([k, f]) => [k, await readJsonFile(f)]));
  const out = { at: new Date().toISOString(), source: dataLocation().kind };
  for (const [k, v] of entries) if (v) out[k] = v;
  return out;
}
