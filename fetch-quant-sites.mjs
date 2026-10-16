#!/usr/bin/env node
/**
 * Quant firms whose internships a title-based ATS sweep can't see:
 *
 *   Jane Street  www.janestreet.com/jobs/main.json — titles never say
 *                "intern"; internships are flagged only in `availability`,
 *                and some titles use look-alike Unicode letters.
 *   SIG          careers.sig.com/api/jobs (keyword=intern) — custom site on iCIMS.
 *   D. E. Shaw   the careers page's __NEXT_DATA__ carries an `internships` list.
 *
 * Plain public GETs, same pages a browser loads. Each firm is independent:
 * one failing keeps its previous snapshot.
 *
 *   node fetch-quant-sites.mjs
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fetchJson, fetchText } from './providers/_http.mjs';
import { classifyJob, seasonIsPast, foldConfusables } from './lib/classify.mjs';
import { jobKey, readJson, writeJsonAtomic, writeFeedFile, mergeSnapshot } from './lib/feed-io.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(ROOT, 'data/quant-sites-feed.json');
const HEARTBEAT = resolve(ROOT, 'data/scan-quant-sites-heartbeat.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const opts = { timeoutMs: 30_000, headers: { 'user-agent': UA, accept: 'application/json, text/html' } };

function keep(job) {
  const cls = classifyJob({ title: job.title, company: job.company, internHint: true, category: 'quant' });
  if (!cls || (cls.season && seasonIsPast(cls.season))) return null;
  return { ...job, feed: 'scan', internHint: true, category: 'quant', tracks: cls.tracks, season: cls.season, degree: cls.degree, coop: cls.coop };
}

const JS_CITY = { NYC: 'New York, NY', LDN: 'London, UK', HKG: 'Hong Kong', SGP: 'Singapore', AMS: 'Amsterdam, Netherlands' };

async function janestreet() {
  const rows = await fetchJson('https://www.janestreet.com/jobs/main.json', opts);
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!/intern/i.test(String(r.availability || ''))) continue;
    const position = foldConfusables(r.position).trim();
    const salary = r.min_salary || r.max_salary
      ? `$${Math.round(Number(r.min_salary || r.max_salary) / 1000)}k${r.max_salary && r.max_salary !== r.min_salary ? `-$${Math.round(Number(r.max_salary) / 1000)}k` : ''}/yr`
      : '';
    const job = keep({
      title: `${position} — ${r.availability}`,
      company: 'Jane Street',
      url: `https://www.janestreet.com/join-jane-street/position/${r.id}/`,
      location: JS_CITY[r.city] || r.city || '',
      salary,
      postedAt: null,
    });
    if (job) out.push(job);
  }
  return out;
}

async function sig() {
  const out = [];
  for (let page = 1; page <= 5; page += 1) {
    const data = await fetchJson(`https://careers.sig.com/api/jobs?page=${page}&limit=100&keywords=intern`, opts);
    const jobs = data?.jobs || [];
    for (const { data: d } of jobs) {
      if (!d?.title) continue;
      const interns = (d.categories || []).some((c) => /intern|co-?op/i.test(c?.name || ''));
      if (!interns && !/intern|co-?op/i.test(d.title)) continue;
      const job = keep({
        title: d.title,
        company: 'Susquehanna International Group (SIG)',
        url: `https://careers-sig.icims.com/jobs/${d.req_id}/job`,
        location: d.full_location || [d.city, d.state, d.country].filter(Boolean).join(', '),
        postedAt: Date.parse(d.posted_date || d.create_date || '') || null,
      });
      if (job) out.push(job);
    }
    if (jobs.length < 100) break;
  }
  return out;
}

async function deshaw() {
  const html = await fetchText('https://www.deshaw.com/careers/choose-your-path', opts);
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('D. E. Shaw: no __NEXT_DATA__');
  const pp = JSON.parse(m[1])?.props?.pageProps || {};
  const out = [];
  for (const x of pp.internships || []) {
    const slug = x?.data?.jobUrl;
    if (!x?.displayName || !slug) continue;
    const job = keep({
      title: x.displayName,
      company: 'D. E. Shaw',
      url: `https://www.deshaw.com/careers/${String(slug).toLowerCase()}`,
      location: (x.office || []).map((o) => o.name).join(' · '),
      postedAt: null,
    });
    if (job) out.push(job);
  }
  return out;
}

const SITES = { janestreet, sig, deshaw };

async function main() {
  const started = Date.now();
  const now = new Date().toISOString();
  const previous = readJson(OUT, { jobs: [] });
  const prevBySite = new Map();
  for (const j of previous.jobs || []) {
    if (!prevBySite.has(j.site)) prevBySite.set(j.site, []);
    prevBySite.get(j.site).push(j);
  }
  const counts = {};
  const errors = {};
  let all = [];
  for (const [site, fn] of Object.entries(SITES)) {
    try {
      const fresh = (await fn()).map((j) => ({ ...j, site }));
      const merged = mergeSnapshot(prevBySite.get(site) || [], fresh, { now });
      counts[site] = merged.length;
      all = all.concat(merged);
    } catch (err) {
      errors[site] = String(err.message || err);
      counts[site] = (prevBySite.get(site) || []).length;
      all = all.concat(prevBySite.get(site) || []);
    }
  }
  writeFeedFile(OUT, { fetchedAt: now, provider: 'quant-sites', counts, errors }, all, { keyOf: (j) => jobKey(j.url) });
  const failedAll = Object.keys(errors).length === Object.keys(SITES).length;
  writeJsonAtomic(HEARTBEAT, {
    at: now,
    exitCode: failedAll ? 1 : 0,
    elapsedSec: Math.round((Date.now() - started) / 1000),
    newMatches: all.length,
    counts,
    errors,
    mode: 'quant-firm-sites',
  }, { pretty: true });
  console.log(JSON.stringify({ count: all.length, counts, errors }));
  process.exit(failedAll ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
