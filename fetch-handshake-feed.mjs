#!/usr/bin/env node
/**
 * Handshake feed — runs scrape-handshake.py (your own signed-in Handshake
 * session in a real Chrome window), keeps the AI/ML + quant internships, and
 * writes them for the dashboard.
 *
 * This one runs on YOUR machine, not GitHub Actions: Handshake sits behind
 * Cloudflare + school SSO (sessions die after ~2h idle), and copied cookies
 * replayed from a datacenter IP get challenged. Handshake postings are also
 * login-gated, so the committed file is encrypted with FEED_KEY
 * (data/handshake-feed.enc.json). Without FEED_KEY the output stays local
 * (data/handshake-feed.local.json, git-ignored) and only your dev server sees it.
 *
 *   npm run feed:handshake -- --login     # first run: sign in via SSO
 *   npm run feed:handshake                # later runs (reuses the session)
 *   npm run feed:handshake -- --push      # also commit + push the encrypted feed
 */
import { spawnSync } from 'child_process';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { classifyJob, seasonIsPast } from './lib/classify.mjs';
import { mergeSnapshot, writeJsonAtomic, readJson } from './lib/feed-io.mjs';
import { encryptJson, decryptJson, hasFeedKey } from './lib/feed-crypto.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const ENC_OUT = resolve(ROOT, 'data/handshake-feed.enc.json');
const LOCAL_OUT = resolve(ROOT, 'data/handshake-feed.local.json');
const HEARTBEAT = resolve(ROOT, 'data/scan-handshake-heartbeat.json');
const TMP = resolve(ROOT, 'data/hs-hits.tmp.json');
const PY = process.env.HC_PYTHON || (existsSync(join(ROOT, '.venv/bin/python')) ? join(ROOT, '.venv/bin/python') : 'python3');

// FEED_KEY may live in a git-ignored .env.local so local runs can encrypt.
if (!process.env.FEED_KEY && existsSync(join(ROOT, '.env.local'))) {
  const m = readFileSync(join(ROOT, '.env.local'), 'utf8').match(/^FEED_KEY=(.+)$/m);
  if (m) process.env.FEED_KEY = m[1].trim().replace(/^["']|["']$/g, '');
}

function salaryText(job) {
  const r = job.salaryRange;
  if (!r || (!r.min && !r.max)) return '';
  const sched = r.paySchedule?.behaviorIdentifier || '';
  const fmt = (cents) => {
    const v = Number(cents) / 100;
    if (!Number.isFinite(v) || v <= 0) return '';
    return v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${Math.round(v)}`;
  };
  const unit = sched === 'HOURLY_WAGE' ? '/hr' : sched === 'MONTHLY_STIPEND' ? '/mo' : sched === 'ANNUAL_SALARY' ? '/yr' : '';
  const lo = fmt(r.min);
  const hi = fmt(r.max);
  return `${lo && hi && lo !== hi ? `${lo}-${hi}` : lo || hi}${unit}`;
}

function toRecord(job, origin) {
  const behavior = job.jobType?.behaviorIdentifier || '';
  const internHint = behavior === 'INTERNSHIP' || behavior === 'CO_OP';
  const title = String(job.title || '').trim();
  const company = String(job.employer?.name || '').trim();
  const cls = classifyJob({ title, company, internHint, commitment: job.jobType?.name || '' });
  if (!cls || (cls.season && seasonIsPast(cls.season))) return null;
  const locations = (job.locations || []).map((l) => l.displayName || l.name).filter(Boolean);
  return {
    title,
    company,
    url: `${origin}/jobs/${job.id}`,
    location: locations.join(' · ') || (job.remote ? 'Remote' : ''),
    postedAt: Date.parse(job.applyStart || job.createdAt || '') || null,
    salary: salaryText(job),
    workplace: job.remote ? 'Remote' : job.hybrid ? 'Hybrid' : job.onSite ? 'Onsite' : '',
    commitment: job.jobType?.name || '',
    expiresAt: job.expirationDate || '',
    promoted: job._promoted || undefined,
    feed: 'handshake',
    internHint,
    tracks: cls.tracks,
    season: cls.season,
    degree: cls.degree,
    coop: cls.coop || behavior === 'CO_OP',
  };
}

function loadPrevious() {
  try {
    if (existsSync(ENC_OUT) && hasFeedKey()) return decryptJson(JSON.parse(readFileSync(ENC_OUT, 'utf8')))?.jobs || [];
  } catch { /* key changed */ }
  return readJson(LOCAL_OUT, {})?.jobs || [];
}

function pushFeed() {
  const run = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  run(['add', 'data/handshake-feed.enc.json', 'data/scan-handshake-heartbeat.json']);
  if (run(['diff', '--cached', '--quiet']).status === 0) {
    console.error('handshake: nothing new to push');
    return;
  }
  run(['commit', '-m', `handshake: ${new Date().toISOString()}`]);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (run(['pull', '--rebase', '--quiet']).status === 0 && run(['push']).status === 0) {
      console.error('handshake: pushed');
      return;
    }
    run(['rebase', '--abort']);
  }
  console.error('handshake: push failed — run `git push` yourself');
}

function main() {
  const started = Date.now();
  const passthrough = process.argv.slice(2).filter((a) => a !== '--push');
  const r = spawnSync(PY, [join(ROOT, 'scrape-handshake.py'), '--out', TMP, ...passthrough], {
    cwd: ROOT,
    stdio: ['inherit', 'pipe', 'inherit'],
    encoding: 'utf8',
    timeout: 15 * 60_000,
  });
  if (r.stdout) process.stdout.write(r.stdout);
  const status = r.status ?? 1;
  const now = new Date().toISOString();
  // When the session last worked — lets the dashboard tell "expired" from "never set up".
  const lastOkAt = readJson(HEARTBEAT, {})?.lastOkAt;

  if (status !== 0 || !existsSync(TMP)) {
    writeJsonAtomic(HEARTBEAT, {
      at: now,
      exitCode: status,
      elapsedSec: Math.round((Date.now() - started) / 1000),
      loginWall: status === 2,
      lastOkAt,
      mode: 'handshake-own-session',
    }, { pretty: true });
    process.exit(status === 2 ? 2 : 1);
  }

  const raw = JSON.parse(readFileSync(TMP, 'utf8'));
  try { unlinkSync(TMP); } catch { /* ignore */ }
  const incoming = (raw.jobs || []).map((j) => toRecord(j, raw.host)).filter(Boolean);
  const jobs = mergeSnapshot(loadPrevious(), incoming, { now });
  const feed = { fetchedAt: now, provider: 'handshake', host: raw.host, count: jobs.length, jobs };

  let where;
  if (hasFeedKey()) {
    writeJsonAtomic(ENC_OUT, encryptJson(feed));
    where = 'data/handshake-feed.enc.json (encrypted)';
  } else {
    writeJsonAtomic(LOCAL_OUT, feed);
    where = 'data/handshake-feed.local.json (local only — set FEED_KEY to publish)';
  }
  writeJsonAtomic(HEARTBEAT, {
    at: now,
    exitCode: 0,
    elapsedSec: Math.round((Date.now() - started) / 1000),
    newMatches: incoming.length,
    total: jobs.length,
    scanned: raw.count,
    perQuery: raw.perQuery,
    loginWall: false,
    lastOkAt: now,
    mode: 'handshake-own-session',
  }, { pretty: true });
  console.log(`Handshake: kept ${incoming.length} AI/ML + quant internships of ${raw.count} scanned → ${where}`);
  if (process.argv.includes('--push')) {
    if (hasFeedKey()) pushFeed();
    else console.error('handshake: --push skipped — FEED_KEY is not set, so nothing publishable was written');
  }
}

main();
