#!/usr/bin/env node
/**
 * Curated internship lists feed — the community-maintained GitHub lists that
 * track the internship cycle (they are where most big-company AI/ML and quant
 * intern postings show up first, often hand-verified):
 *
 *   simplify     SimplifyJobs/Summer2027-Internships  listings.json (structured)
 *   cscareers    vanshb03/Summer2027-Internships      listings.json (same schema)
 *   speedyapply  speedyapply/2027-AI-College-Jobs     README tables (AI-only list)
 *   nwquant      northwesternfintech/2027QuantInternships README (quant firms)
 *   jrlist       jobright-ai/*-Internship              README tables (daily)
 *
 * All plain HTTPS GETs to raw.githubusercontent.com — no auth, no IP issues,
 * so this runs fine on a GitHub-hosted runner. Every row goes through
 * lib/classify.mjs; only AI/ML + Quant internships are kept. Each run is a
 * complete snapshot (a role that left the list is closed), with first-seen
 * time preserved across runs.
 *
 *   node fetch-lists-feed.mjs [--only simplify,nwquant]
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fetchText } from './providers/_http.mjs';
import { classifyJob, seasonIsPast } from './lib/classify.mjs';
import {
  jobKey, readJson, writeJsonAtomic, writeFeedFile, mergeSnapshot,
  parseMonthDay, parseRelativeAge, cellText, cellLinks, splitRow,
} from './lib/feed-io.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(ROOT, 'data/lists-feed.json');
const HEARTBEAT = resolve(ROOT, 'data/scan-lists-heartbeat.json');
const RAW = 'https://raw.githubusercontent.com';
const UA = 'Mozilla/5.0 (compatible; intern-ops/1.0; +https://github.com)';
// A listing with no term info is only trusted while it's reasonably fresh.
const UNDATED_TERM_MAX_AGE_DAYS = 120;

const onlyArg = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? new Set(String(process.argv[i + 1] || '').split(',').filter(Boolean)) : null;
})();

async function get(url, timeoutMs = 60_000) {
  return fetchText(url, { timeoutMs, headers: { 'user-agent': UA } });
}

function keep(job, hints) {
  const cls = classifyJob({ ...job, ...hints });
  if (!cls) return null;
  if (cls.season && seasonIsPast(cls.season)) return null;
  return { ...job, ...hints, tracks: cls.tracks, season: cls.season, degree: cls.degree, coop: cls.coop };
}

// ── Simplify-schema listings.json (Simplify + CSCareers/vanshb03) ───

function fromListingsJson(rows, { feed, label }) {
  const now = Date.now();
  const out = [];
  for (const x of Array.isArray(rows) ? rows : []) {
    if (!x || x.active === false || x.is_visible === false) continue;
    const url = String(x.url || '').trim();
    if (!/^https?:\/\//.test(url)) continue;
    const postedAt = Number(x.date_posted) > 0 ? Number(x.date_posted) * 1000 : null;
    // Simplify ships explicit terms ("Summer 2027"); CSCareers only a bare
    // season ("Summer") with no year, which can't tell 2026 from 2027.
    const terms = Array.isArray(x.terms) ? x.terms.filter((t) => /\b20\d\d\b/.test(String(t || ''))) : [];
    if (!terms.length && (!postedAt || now - postedAt > UNDATED_TERM_MAX_AGE_DAYS * 86400000)) continue;
    const job = keep({
      title: String(x.title || '').trim(),
      company: String(x.company_name || '').trim(),
      url,
      location: (Array.isArray(x.locations) ? x.locations : []).join(' · '),
      postedAt,
      sponsorship: x.sponsorship && x.sponsorship !== 'Other' ? x.sponsorship : '',
      feed,
      source: label,
    }, {
      internHint: true,
      terms,
      degrees: x.degrees,
      ...(/ai\/ml|machine learning/i.test(String(x.category || '')) ? { listCategory: 'ai' } : {}),
    });
    if (job) out.push(job);
  }
  return out;
}

async function simplify() {
  const rows = JSON.parse(await get(`${RAW}/SimplifyJobs/Summer2027-Internships/HEAD/.github/scripts/listings.json`, 120_000));
  return fromListingsJson(rows, { feed: 'simplify', label: 'Simplify' });
}

async function cscareers() {
  const rows = JSON.parse(await get(`${RAW}/vanshb03/Summer2027-Internships/HEAD/.github/scripts/listings.json`));
  return fromListingsJson(rows, { feed: 'cscareers', label: 'CSCareers' });
}

// ── SpeedyApply AI list (README tables) ─────────────────────────────

async function speedyapply() {
  const md = await get(`${RAW}/speedyapply/2027-AI-College-Jobs/HEAD/README.md`);
  const out = [];
  let section = '';
  let header = null;
  let inInternships = false;
  for (const line of md.split('\n')) {
    if (/^## /.test(line)) { inInternships = /intern/i.test(line); header = null; continue; }
    if (/^### /.test(line)) { section = line.replace(/^###\s*/, '').trim(); header = null; continue; }
    if (!inInternships) continue;
    const cells = splitRow(line);
    if (!cells) continue;
    if (!header) {
      if (cells.some((c) => /^company$/i.test(cellText(c)))) header = cells.map((c) => cellText(c).toLowerCase());
      continue;
    }
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    const col = (name) => cells[header.indexOf(name)];
    const company = cellText(col('company'));
    const title = cellText(col('position'));
    const url = cellLinks(col('posting'))[0];
    if (!company || !title || !url) continue;
    const job = keep({
      title,
      company,
      url,
      location: cellText(col('location')),
      salary: header.includes('salary') ? cellText(col('salary')) : '',
      postedAt: parseRelativeAge(cellText(col('age'))),
      feed: 'speedyapply',
      source: 'SpeedyApply',
    }, { internHint: true, category: /quant/i.test(section) ? 'quant' : 'ai' });
    if (job) out.push(job);
  }
  return out;
}

// ── Northwestern FinTech quant list (README per-firm tables) ─────────

const NW_ROLE_TITLES = {
  QT: 'Quantitative Trader Intern',
  QR: 'Quantitative Researcher Intern',
  QD: 'Quantitative Developer Intern',
  SWE: 'Software Engineer Intern',
  FPGA: 'FPGA Engineer Intern',
  HW: 'Hardware Engineer Intern',
  ML: 'Machine Learning Researcher Intern',
  DS: 'Data Scientist Intern',
};

/** Human title from a descriptive URL slug (Citadel's are), else null. */
function titleFromSlug(url) {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
    const words = seg.split('-').filter(Boolean);
    if (words.length < 3 || words.some((w) => /^\d{4,}$/.test(w)) || !/intern/i.test(seg)) return null;
    return words
      .filter((w, i) => !(i === words.length - 1 && /^(us|usa|na|amer|americas)$/i.test(w)))
      .map((w) => (/^(phd|ml|ai|qr|qt|swe|fpga|nyc)$/i.test(w) ? w.toUpperCase().replace('PHD', 'PhD') : w[0].toUpperCase() + w.slice(1)))
      .join(' ');
  } catch {
    return null;
  }
}

async function nwquant() {
  const md = await get(`${RAW}/northwesternfintech/2027QuantInternships/HEAD/README.md`);
  const out = [];
  let firm = '';
  let locations = '';
  for (const line of md.split('\n')) {
    const h = line.match(/^## (.+)$/);
    if (h) { firm = h[1].trim(); locations = ''; continue; }
    const loc = line.match(/^\*\*Locations\*\*:\s*(.*)$/);
    if (loc) { locations = loc[1].trim(); continue; }
    if (!firm || /^(contributing|using this repository)$/i.test(firm)) continue;
    const cells = splitRow(line);
    if (!cells || cells.length < 2) continue;
    const role = cellText(cells[0]).toUpperCase();
    if (!role || role === 'ROLE' || /^-+$/.test(role)) continue;
    for (const m of cells[1].matchAll(/\[(✅|🔒|❌)?\s*([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g)) {
      if (m[1] && m[1] !== '✅') continue;
      const label = m[2].trim();
      const url = m[3];
      const base = titleFromSlug(url) || NW_ROLE_TITLES[role] || `${role} Intern`;
      const title = `${base}${label && !base.toLowerCase().includes(label.toLowerCase()) ? ` (${label})` : ''} — Summer 2027`;
      const job = keep({
        title,
        company: firm,
        url,
        location: locations,
        postedAt: null,
        feed: 'nwquant',
        source: 'NU FinTech',
      }, { internHint: true, category: 'quant' });
      if (job) out.push(job);
    }
  }
  return out;
}

// ── JobRight daily intern lists (README tables) ─────────────────────

const JR_LIST_REPOS = [
  'jobright-ai/2026-Software-Engineer-Internship',
  'jobright-ai/2026-Data-Analysis-Internship',
  'jobright-ai/2026-Engineer-Internship',
];

async function jrlist() {
  const out = [];
  for (const repo of JR_LIST_REPOS) {
    let md;
    try {
      md = await get(`${RAW}/${repo}/HEAD/README.md`);
    } catch (err) {
      process.stderr.write(`jrlist: ${repo} failed: ${err.message}\n`);
      continue;
    }
    let header = null;
    let lastCompany = '';
    for (const line of md.split('\n')) {
      const cells = splitRow(line);
      if (!cells) { header = null; continue; }
      if (!header) {
        if (cells.some((c) => /^company$/i.test(cellText(c)))) header = cells.map((c) => cellText(c).toLowerCase());
        continue;
      }
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
      const col = (name) => cells[header.indexOf(name)];
      // Repeated-company rows use "↳" in the company cell.
      const companyCell = cellText(col('company'));
      const company = /^↳?$/.test(companyCell) ? lastCompany : companyCell;
      lastCompany = company;
      const titleCell = col('job title');
      const title = cellText(titleCell);
      const url = cellLinks(titleCell)[0];
      if (!company || !title || !url) continue;
      const job = keep({
        title,
        company,
        url,
        location: cellText(col('location')),
        workplace: cellText(col('work model')).replace(/^on ?site$/i, 'Onsite'),
        postedAt: parseMonthDay(cellText(col('date posted'))),
        feed: 'jrlist',
        source: 'JobRight list',
      }, { internHint: true });
      if (job) out.push(job);
    }
  }
  return out;
}

// ── Main ─────────────────────────────────────────────────────────────

const SOURCES = { simplify, cscareers, speedyapply, nwquant, jrlist };

async function main() {
  const started = Date.now();
  const previous = readJson(OUT, { jobs: [] });
  const prevBySource = new Map();
  for (const j of previous.jobs || []) {
    if (!prevBySource.has(j.feed)) prevBySource.set(j.feed, []);
    prevBySource.get(j.feed).push(j);
  }

  const now = new Date().toISOString();
  const counts = {};
  const errors = {};
  let all = [];
  for (const [id, fn] of Object.entries(SOURCES)) {
    if (onlyArg && !onlyArg.has(id)) {
      // Not refreshed this run — carry the previous snapshot forward untouched.
      counts[id] = (prevBySource.get(id) || []).length;
      all = all.concat(prevBySource.get(id) || []);
      continue;
    }
    try {
      const fresh = await fn();
      const merged = mergeSnapshot(prevBySource.get(id) || [], fresh, { keyOf: (j) => jobKey(j.url), now });
      counts[id] = merged.length;
      all = all.concat(merged);
      process.stderr.write(`lists: ${id} kept ${merged.length}\n`);
    } catch (err) {
      // A source that fails keeps its last good snapshot instead of vanishing.
      errors[id] = String(err.message || err);
      counts[id] = (prevBySource.get(id) || []).length;
      all = all.concat(prevBySource.get(id) || []);
      process.stderr.write(`lists: ${id} FAILED (${errors[id]}) — keeping ${counts[id]} from last run\n`);
    }
  }

  writeFeedFile(OUT, { fetchedAt: now, provider: 'lists', counts, errors }, all, { keyOf: (j) => `${j.feed}|${jobKey(j.url)}` });
  const heartbeat = {
    at: now,
    exitCode: Object.keys(errors).length === Object.keys(SOURCES).length ? 1 : 0,
    elapsedSec: Math.round((Date.now() - started) / 1000),
    newMatches: all.length,
    counts,
    errors,
    mode: 'curated-github-lists',
  };
  writeJsonAtomic(HEARTBEAT, heartbeat, { pretty: true });
  console.log(JSON.stringify({ ok: heartbeat.exitCode === 0, count: all.length, counts, errors }));
  process.exit(heartbeat.exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
