/**
 * Apply URLs (Hiring Cafe or cached JobRight) → unique ATS boards we fetch
 * ourselves. Aggregators say "this company is hiring"; Greenhouse / Ashby /
 * Lever / Workday tell us which jobs on that board are actually new — titles
 * still have to match portals.yml title_filter.positive (a GM software lead
 * is not a license to ingest pipefitters).
 */
import { greenhouseRef, ashbyRef, leverRef, resolveGreenhouseBoard, mapPool } from './ats-posted-at.mjs';
import { loadPortalsTitleFilter } from './title-filter.mjs';
import { isUsLocation } from './us-location.mjs';
import { requiresClearance } from './clearance.mjs';
import { makeHttpCtx } from '../providers/_http.mjs';
import greenhouse from '../providers/greenhouse.mjs';
import ashby from '../providers/ashby.mjs';
import lever from '../providers/lever.mjs';
import workday, { fetchWorkdayJobPostedAt, postedAtFromWorkdayDetail } from '../providers/workday.mjs';

const SKIP_HOST = /jobright\.ai|linkedin\.com|indeed\.com|glassdoor\.com|ziprecruiter|jobs\.google|careers\.google|amazon\.jobs/i;

const KIND_RANK = { greenhouse: 0, ashby: 1, lever: 2, workday: 3 };
export const MAX_LEADS_BY_KIND = { greenhouse: 40, ashby: 25, lever: 20, workday: 8 };

const ATS_LABEL = {
  greenhouse: 'Greenhouse',
  ashby: 'Ashby',
  lever: 'Lever',
  workday: 'Workday',
};

const MAX_KEEP_BY_KIND = { greenhouse: 80, ashby: 80, lever: 80, workday: 12 };
/** List "Posted Today" is not first-published. Confirm at most this many details. */
const WORKDAY_DETAIL_CAP = 24;

function greenhouseBoardSlug(url) {
  const ref = greenhouseRef(url);
  if (ref.board && ref.board !== 'embed') return ref.board;
  try {
    const u = new URL(url);
    if (!/greenhouse/i.test(u.hostname) && !u.searchParams.has('gh_jid') && !u.searchParams.has('token')) {
      return '';
    }
    if (!/greenhouse/i.test(u.hostname)) return ref.board || '';
    const slug = (u.pathname.split('/').filter(Boolean)[0] || '').toLowerCase();
    if (!slug || slug === 'embed' || slug === 'job_app') return '';
    return slug;
  } catch {
    return '';
  }
}

function hostLooksSkipped(url) {
  try { return SKIP_HOST.test(new URL(url).hostname); } catch { return true; }
}

function ashbyOrg(url) {
  const ref = ashbyRef(url);
  if (ref.org) return ref.org;
  try {
    const u = new URL(url);
    if (!/ashby/i.test(u.hostname)) return '';
    const org = u.pathname.split('/').filter(Boolean)[0] || '';
    if (!org || org === 'api' || org === 'posting-api') return '';
    return org;
  } catch {
    return '';
  }
}

function leverCompany(url) {
  const ref = leverRef(url);
  if (ref.company) return ref.company;
  try {
    const u = new URL(url);
    if (!u.hostname.toLowerCase().includes('lever.co')) return '';
    const slug = u.pathname.split('/').filter((p) => p && p !== 'apply')[0] || '';
    return slug;
  } catch {
    return '';
  }
}

function workdayLead(url, company) {
  const m = String(url || '').match(
    /^https:\/\/([\w-]+)\.(wd[\w-]*)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/?#]+)/i,
  );
  if (!m) return null;
  const [, tenant, instance, site] = m;
  const host = `${tenant}.${instance}.myworkdayjobs.com`.toLowerCase();
  return {
    kind: 'workday',
    key: `workday:${host}/${site}`,
    sampleUrl: `https://${tenant}.${instance}.myworkdayjobs.com/${site}`,
    company: company || tenant,
    slug: site,
  };
}

/**
 * @param {string} url
 * @param {string} [company]
 * @returns {{ kind: string, key: string, sampleUrl: string, company: string, slug: string } | null}
 */
export function leadFromApplyUrl(url, company = '') {
  if (typeof url !== 'string' || !url) return null;
  if (hostLooksSkipped(url)) return null;
  const gh = greenhouseRef(url);
  const board = greenhouseBoardSlug(url);
  if (board || gh.id) {
    return {
      kind: 'greenhouse',
      key: board ? `greenhouse:${board}` : `greenhouse-id:${gh.id}`,
      sampleUrl: url,
      company: company || board || 'Unknown',
      slug: board || '',
    };
  }
  const org = ashbyOrg(url);
  if (org) {
    return {
      kind: 'ashby',
      key: `ashby:${org.toLowerCase()}`,
      sampleUrl: url,
      company: company || org,
      slug: org,
    };
  }
  const lev = leverCompany(url);
  if (lev) {
    return {
      kind: 'lever',
      key: `lever:${lev.toLowerCase()}`,
      sampleUrl: url,
      company: company || lev,
      slug: lev,
    };
  }
  return workdayLead(url, company);
}

export function collectLeads(jobs) {
  const byKey = new Map();
  for (const job of jobs || []) {
    const url = job.applyUrl || job.url || '';
    const lead = leadFromApplyUrl(url, job.company || '');
    if (!lead) continue;
    const prev = byKey.get(lead.key);
    if (!prev) byKey.set(lead.key, lead);
    else if (!prev.slug && lead.slug) byKey.set(lead.key, lead);
  }
  return [...byKey.values()];
}

/** Unique companies / ATS boards to watch — not JobRight listing cards. */
export function companyTrackFromJobs(jobs) {
  return collectLeads(jobs)
    .map((l) => ({
      company: l.company,
      ats: l.kind,
      board: l.slug || '',
      key: l.key,
      url: l.sampleUrl,
    }))
    .sort((a, b) => String(a.company).localeCompare(String(b.company), 'en'));
}

export function capLeads(leads) {
  const counts = { greenhouse: 0, ashby: 0, lever: 0, workday: 0 };
  const ranked = [...leads].sort((a, b) => {
    const kr = (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9);
    if (kr !== 0) return kr;
    const as = a.slug ? 1 : 0;
    const bs = b.slug ? 1 : 0;
    return bs - as;
  });
  return ranked.filter((lead) => {
    const max = MAX_LEADS_BY_KIND[lead.kind] ?? 0;
    const n = counts[lead.kind] ?? 0;
    if (n >= max) return false;
    counts[lead.kind] = n + 1;
    return true;
  });
}

async function resolveMissingGreenhouseSlugs(leads) {
  const byKey = new Map();
  for (const lead of leads) {
    let next = lead;
    if (lead.kind === 'greenhouse' && !lead.slug) {
      try {
        const slug = await resolveGreenhouseBoard(lead.sampleUrl);
        if (!slug || slug === 'embed') continue;
        next = { ...lead, slug, key: `greenhouse:${slug}`, company: lead.company || slug };
      } catch {
        continue;
      }
    }
    if (!byKey.has(next.key)) byKey.set(next.key, next);
  }
  return [...byKey.values()];
}

function withinDays(postedAt, days, nowMs = Date.now()) {
  if (postedAt == null || postedAt === '') return false;
  const ms = typeof postedAt === 'number' ? postedAt : Date.parse(String(postedAt).replace(' ', 'T'));
  if (!Number.isFinite(ms)) return false;
  return nowMs - ms <= days * 86400000;
}

/**
 * Fail closed: no detail date → drop. Refreshed list "Posted Today" with a
 * months-old startDate → drop. Only job-detail dates enter the fresh list.
 */
export function confirmWorkdayBoardRow(row, info, { days, nowMs = Date.now() } = {}) {
  const ms = postedAtFromWorkdayDetail(info, nowMs);
  if (!Number.isFinite(ms) || !withinDays(ms, days, nowMs)) return null;
  return { ...row, postedAt: new Date(ms).toISOString(), postedAtSource: 'workday-detail' };
}

async function confirmWorkdayCandidates(candidates, ctx, days) {
  const toCheck = candidates.slice(0, WORKDAY_DETAIL_CAP);
  const checked = await mapPool(toCheck, 4, async (row) => {
    const ms = await fetchWorkdayJobPostedAt(row.url, ctx);
    if (typeof ms !== 'number' || !withinDays(ms, days)) return null;
    return { ...row, postedAt: new Date(ms).toISOString(), postedAtSource: 'workday-detail' };
  });
  const confirmed = checked.filter(Boolean);
  confirmed.sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt));
  return confirmed;
}

function salaryText(salary) {
  if (!salary) return '';
  if (typeof salary === 'string') return salary;
  if (typeof salary === 'object' && salary.min != null) {
    const cur = salary.currency === 'USD' || !salary.currency ? '$' : `${salary.currency} `;
    if (salary.max != null && salary.max !== salary.min) return `${cur}${salary.min}–${salary.max}`;
    return `${cur}${salary.min}`;
  }
  return '';
}

async function fetchLead(lead, ctx, days) {
  const sinceMs = Date.now() - days * 86400000;
  const name = lead.company || lead.slug || lead.key;
  try {
    if (lead.kind === 'greenhouse') {
      const slug = lead.slug;
      if (!slug || slug === 'embed') return [];
      return await greenhouse.fetch(
        { name, careers_url: `https://job-boards.greenhouse.io/${slug}` },
        ctx,
      );
    }
    if (lead.kind === 'ashby') {
      return await ashby.fetch(
        { name, careers_url: `https://jobs.ashbyhq.com/${lead.slug}` },
        ctx,
      );
    }
    if (lead.kind === 'lever') {
      return await lever.fetch(
        { name, careers_url: `https://jobs.lever.co/${lead.slug}` },
        ctx,
      );
    }
    if (lead.kind === 'workday') {
      return await workday.fetch(
        { name, careers_url: lead.sampleUrl, max_pages: 4 },
        { ...ctx, sinceMs },
      );
    }
  } catch (err) {
    console.error(`jr-board ${lead.key}: ${err instanceof Error ? err.message : err}`);
    return [];
  }
  return [];
}

/**
 * Pull recent US jobs from boards Hiring Cafe or JobRight pointed at.
 * JR dates are untrusted (reposts look new); the ATS board is source of truth.
 * @param {object[]} jrJobs
 * @param {{ days?: number, concurrency?: number }} [opts]
 */
export async function fetchFreshFromJrLeads(jrJobs, { days = 2, concurrency = 6 } = {}) {
  const resolved = await resolveMissingGreenhouseSlugs(collectLeads(jrJobs));
  const leads = capLeads(resolved);
  const ctx = makeHttpCtx();
  const titleOk = loadPortalsTitleFilter();
  const rows = [];
  const seen = new Set();
  const boardStats = [];
  await mapPool(leads, concurrency, async (lead) => {
    const jobs = await fetchLead(lead, ctx, days);
    const candidates = [];
    for (const j of jobs || []) {
      const url = j.url || '';
      if (!url) continue;
      if (!withinDays(j.postedAt, days)) continue;
      if (!titleOk(j.title, { company: j.company || lead.company })) continue;
      const loc = j.location || '';
      if (!isUsLocation(loc, { url, allowUnknown: true })) continue;
      if (requiresClearance({
        title: j.title,
        location: loc,
        company: j.company || lead.company,
        url,
      })) continue;
      const postedIso = typeof j.postedAt === 'number'
        ? new Date(j.postedAt).toISOString()
        : String(j.postedAt || '');
      candidates.push({
        title: j.title || '',
        url,
        company: j.company || lead.company || '',
        location: loc,
        postedAt: postedIso,
        salary: salaryText(j.salary),
        ats: ATS_LABEL[lead.kind] || lead.kind,
        board: lead.slug || lead.key,
      });
    }
    candidates.sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt));
    const fresh = lead.kind === 'workday'
      ? await confirmWorkdayCandidates(candidates, ctx, days)
      : candidates;
    const maxKeep = MAX_KEEP_BY_KIND[lead.kind] ?? 40;
    let kept = 0;
    for (const row of fresh.slice(0, maxKeep)) {
      const key = `${lead.kind}:${row.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
      kept += 1;
    }
    boardStats.push({ key: lead.key, fetched: (jobs || []).length, kept });
  });
  return { leadCount: leads.length, jobs: rows, boards: boardStats };
}
