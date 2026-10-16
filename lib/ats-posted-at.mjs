/**
 * Employer-board publish dates (Greenhouse first_published, Ashby publishedAt,
 * Lever createdAt, Workday job-detail startDate). JobRight's "posted just now"
 * clock is not this — GH drops its New tag when first_published ages out; JR
 * still shows New on re-lists. Workday list "Posted Today" is a refresh badge;
 * we read the job-detail startDate instead.
 */
import { BROWSER_LIKE_USER_AGENT } from '../providers/_http.mjs';
import { fetchWorkdayJobPostedAt } from '../providers/workday.mjs';

const ASHBY_UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function toIso(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }
  const ms = Date.parse(String(value).replace(' ', 'T'));
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toISOString();
}

export function greenhouseRef(url) {
  if (typeof url !== 'string' || !url) return { board: '', id: '' };
  let u;
  try { u = new URL(url.trim()); } catch { return { board: '', id: '' }; }
  const id = u.searchParams.get('token')
    || u.searchParams.get('gh_jid')
    || (u.pathname.match(/\/jobs\/(\d{6,})/) || [])[1]
    || '';
  let board = u.searchParams.get('for') || '';
  const pathBoard = u.pathname.match(/\/([^/]+)\/jobs\/\d{6,}/);
  if (!board && pathBoard && pathBoard[1] !== 'embed') board = pathBoard[1];
  return { board: String(board || '').toLowerCase(), id: String(id || '') };
}

export function ashbyRef(url) {
  if (typeof url !== 'string' || !url) return { org: '', id: '' };
  let u;
  try { u = new URL(url.trim()); } catch { return { org: '', id: '' }; }
  if (!/ashby/i.test(u.hostname)) return { org: '', id: '' };
  const parts = u.pathname.split('/').filter(Boolean);
  const org = parts[0] || '';
  const id = (url.match(ASHBY_UUID_RE) || [])[0] || '';
  if (!org || org === 'api' || !id) return { org: '', id: '' };
  return { org, id: id.toLowerCase() };
}

export function leverRef(url) {
  if (typeof url !== 'string' || !url) return { company: '', id: '' };
  let u;
  try { u = new URL(url.trim()); } catch { return { company: '', id: '' }; }
  if (!u.hostname.toLowerCase().includes('lever.co')) return { company: '', id: '' };
  const parts = u.pathname.split('/').filter((p) => p && p !== 'apply');
  if (parts.length < 2) return { company: '', id: '' };
  return { company: parts[0], id: parts[1] };
}

async function fetchText(url, { timeoutMs = 12000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': BROWSER_LIKE_USER_AGENT, accept: 'application/json,text/html;q=0.9' },
      redirect: 'follow',
      signal: ac.signal,
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, url: res.url, body };
  } finally {
    clearTimeout(t);
  }
}

async function fetchJson(url) {
  const r = await fetchText(url);
  if (!r.ok) return null;
  try { return JSON.parse(r.body); } catch { return null; }
}

async function resolveGreenhouseRef(url) {
  let ref = greenhouseRef(url);
  if (ref.id && !ref.board) {
    const followed = await fetchText(url);
    ref = greenhouseRef(followed.url);
    if (!ref.board && followed.body) {
      const m = followed.body.match(/job-boards\.greenhouse\.io\/([^/"']+)\/jobs\/(\d{6,})/i)
        || followed.body.match(/[?&]for=([a-z0-9_-]+)/i);
      if (m) ref = { board: String(m[1]).toLowerCase(), id: ref.id || m[2] || '' };
    }
  }
  return ref;
}

/** Board slug from a Greenhouse apply URL (follows embed token= if needed). */
export async function resolveGreenhouseBoard(url) {
  const ref = await resolveGreenhouseRef(url);
  return ref.board || '';
}

export async function greenhousePostedAt(url) {
  const ref = await resolveGreenhouseRef(url);
  if (!ref.board || !ref.id) return '';
  const json = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(ref.board)}/jobs/${encodeURIComponent(ref.id)}`);
  return toIso(json?.first_published);
}

const ashbyBoardCache = new Map();

export async function ashbyPostedAt(url) {
  const ref = ashbyRef(url);
  if (!ref.org || !ref.id) return '';
  let jobs = ashbyBoardCache.get(ref.org);
  if (!jobs) {
    const json = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(ref.org)}`);
    jobs = Array.isArray(json?.jobs) ? json.jobs : (Array.isArray(json) ? json : []);
    ashbyBoardCache.set(ref.org, jobs);
  }
  const hit = jobs.find((j) => String(j.id || '').toLowerCase() === ref.id
    || String(j.jobUrl || '').toLowerCase().includes(ref.id));
  return toIso(hit?.publishedAt);
}

export async function leverPostedAt(url) {
  const ref = leverRef(url);
  if (!ref.company || !ref.id) return '';
  const json = await fetchJson(`https://api.lever.co/v0/postings/${encodeURIComponent(ref.company)}/${encodeURIComponent(ref.id)}`);
  return toIso(json?.createdAt);
}

export async function workdayPostedAt(url) {
  const ms = await fetchWorkdayJobPostedAt(url);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

/** Public ATS first-published date, or '' when the board has no zero-auth date. */
export async function fetchAtsPostedAt(url) {
  if (typeof url !== 'string' || !url) return '';
  const host = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } })();
  try {
    if (host.includes('greenhouse') || host.includes('grnh.se') || /[?&](token|gh_jid)=/.test(url)) {
      return await greenhousePostedAt(url);
    }
    if (host.includes('ashby')) return await ashbyPostedAt(url);
    if (host.includes('lever.co')) return await leverPostedAt(url);
    if (host.includes('myworkdayjobs.com') || host.includes('workdayjobs.com')) {
      return await workdayPostedAt(url);
    }
  } catch {
    return '';
  }
  return '';
}

export async function mapPool(items, concurrency, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}
