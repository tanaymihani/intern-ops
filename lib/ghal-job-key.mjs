/**
 * Stable identity for Greenhouse / Ashby / Lever postings so the Jobs UI can
 * merge Hiring Cafe URLs with ATS-scan URLs without duplicate cards.
 *
 * Same Greenhouse job id on job-boards.greenhouse.io vs a company career page
 * with ?gh_jid= must collapse. Distinct job ids (Anduril DC vs Boston) stay
 * separate.
 */

const ASHBY_UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function normalizeHref(url) {
  if (typeof url !== 'string' || !url) return '';
  try {
    const u = new URL(url.trim());
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|gh_src|source|ref)/i.test(k)) u.searchParams.delete(k);
    }
    let href = u.href;
    if (href.endsWith('/')) href = href.slice(0, -1);
    return href.toLowerCase();
  } catch {
    return url.trim().toLowerCase().replace(/\/$/, '');
  }
}

function greenhouseId(url, u) {
  const fromQuery = u.searchParams.get('gh_jid') || u.searchParams.get('token');
  if (fromQuery && /^\d{6,}$/.test(fromQuery)) return fromQuery;
  const fromPath = u.pathname.match(/\/jobs\/(\d{6,})/);
  if (fromPath) return fromPath[1];
  return '';
}

function looksGreenhouse(u) {
  const host = u.hostname.toLowerCase();
  return host.includes('greenhouse') || host.includes('grnh.se') || u.searchParams.has('gh_jid');
}

/**
 * Canonical map key for a GHAL apply URL. Falls back to a normalized href
 * when the ATS id cannot be read.
 */
export function canonicalGhalKey(url) {
  if (typeof url !== 'string' || !url) return '';
  let u;
  try {
    u = new URL(url.trim());
  } catch {
    return normalizeHref(url);
  }
  const host = u.hostname.toLowerCase();

  if (looksGreenhouse(u)) {
    const id = greenhouseId(url, u);
    if (id) return `greenhouse:${id}`;
  }

  if (host.includes('ashbyhq.com') || host.includes('ashby')) {
    const m = u.pathname.match(ASHBY_UUID_RE) || url.match(ASHBY_UUID_RE);
    if (m) return `ashby:${m[0].toLowerCase()}`;
  }

  if (host.includes('lever.co')) {
    const parts = u.pathname.split('/').filter(Boolean)
      .filter((p) => !/^(apply|application)$/i.test(p));
    const id = parts[parts.length - 1];
    if (id && parts.length >= 2) return `lever:${id.toLowerCase()}`;
  }

  return normalizeHref(url);
}

/** Extra ATS ids so Tsenta / ApplyTrack / JobRight / Hiring Cafe URLs collide. */
export function extraAtsKeys(url) {
  if (typeof url !== 'string' || !url) return [];
  const out = [];
  let u;
  try {
    u = new URL(url.trim());
  } catch {
    return out;
  }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const path = u.pathname;

  const gh = greenhouseId(url, u);
  if (gh) out.push(`greenhouse:${gh}`);

  const ashby = (host.includes('ashby') ? (url.match(ASHBY_UUID_RE) || path.match(ASHBY_UUID_RE)) : null);
  if (ashby) out.push(`ashby:${ashby[0].toLowerCase()}`);

  if (host.includes('lever.co')) {
    const parts = path.split('/').filter(Boolean)
      .filter((p) => !/^(apply|application)$/i.test(p));
    const id = parts[parts.length - 1];
    if (id && parts.length >= 2) {
      out.push(`lever:${id.toLowerCase()}`);
      out.push(`lever:${host}/${parts.join('/').toLowerCase()}`);
      out.push(`lever:${host}/${parts.join('/').toLowerCase()}/apply`);
    }
  }

  if (host.includes('myworkdayjobs.com') || host.includes('workday.com')) {
    let reqId =
      path.match(/_((?:JR|R|REQ)[-_]?\d{3,}(?:[-_]\d+)?)\b/i)?.[1] ||
      url.match(/_((?:JR|R|REQ)[-_]?\d{3,}(?:[-_]\d+)?)\b/i)?.[1] ||
      u.searchParams.get('jobRequisitionId') ||
      u.searchParams.get('requisitionId');
    if (reqId) {
      reqId = String(reqId)
        .toUpperCase()
        .replace(/\s+/g, '')
        .replace(/^(R)(\d{3,})(?:[-_]\d+)?$/i, 'R-$2')
        .replace(/^((?:JR|R|REQ)-?\d{3,})[-_]\d+$/i, '$1');
      if (/^R\d{3,}$/.test(reqId)) reqId = `R-${reqId.slice(1)}`;
      out.push(`workday:${reqId}`);
    }
  }

  if (host.includes('oraclecloud.com')) {
    const id = path.match(/\/job\/(\d+)/)?.[1];
    if (id) out.push(`oracle:${id}`);
  }
  if (host.includes('icims.com')) {
    const id = path.match(/\/jobs\/(\d+)/)?.[1];
    if (id) out.push(`icims:${id}`);
  }
  if (host.includes('indeed.com')) {
    const jk = u.searchParams.get('jk');
    if (jk) out.push(`indeed:${jk.toLowerCase()}`);
  }
  if (host.includes('workable.com')) {
    const id = path.match(/\/view\/([^/]+)/i)?.[1] || path.match(/\/j\/([^/]+)/i)?.[1];
    if (id) out.push(`workable:${decodeURIComponent(id).toLowerCase()}`);
  }
  if (host.includes('smartrecruiters.com')) {
    const id = path.match(/\/(\d{10,})(?:-|\/|$)/)?.[1];
    if (id) out.push(`smartrecruiters:${id}`);
  }
  if (host.includes('bamboohr.com')) {
    const id = path.match(/\/careers\/(\d+)/i)?.[1] || path.match(/\/jobs\/(\d+)/i)?.[1];
    if (id) out.push(`bamboohr:${id}`);
  }
  if (host.includes('rippling.com')) {
    const id = path.match(/\/jobs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1];
    if (id) out.push(`rippling:${id.toLowerCase()}`);
  }
  if (host.includes('dover.com')) {
    const id = path.match(ASHBY_UUID_RE);
    if (id) out.push(`dover:${id[0].toLowerCase()}`);
  }
  if (host.includes('paylocity.com')) {
    const id = path.match(/\/Details\/(\d+)/i)?.[1] || path.match(/\/Jobs\/(\d+)/i)?.[1];
    if (id) out.push(`paylocity:${id}`);
  }
  return [...new Set(out)];
}

/** Every key we might have stored for this posting (canonical + href + ATS id). */
export function ghalIdentityKeys(url) {
  const keys = new Set();
  const href = normalizeHref(url);
  const canon = canonicalGhalKey(url);
  if (href) keys.add(href);
  if (canon) keys.add(canon);
  for (const k of extraAtsKeys(url)) keys.add(k);
  return [...keys];
}

/** Prefer a real ATS apply URL over a branded careers page with gh_jid. */
export function preferGhalApplyUrl(a, b) {
  const rank = (url) => {
    if (!url) return 0;
    try {
      const h = new URL(url).hostname.toLowerCase();
      if (h.includes('job-boards.greenhouse.io') || h === 'boards.greenhouse.io') return 5;
      if (h.includes('jobs.ashbyhq.com') || h.includes('ashbyhq.com')) return 5;
      if (h.includes('jobs.lever.co') || h.includes('lever.co')) return 5;
      if (h.includes('greenhouse.io')) return 3;
      if (/[?&]gh_jid=/.test(url)) return 2;
      return 1;
    } catch {
      return 0;
    }
  };
  return rank(a) >= rank(b) ? a : b;
}

export function firstStateHit(map, url) {
  if (!map || !url) return null;
  for (const k of ghalIdentityKeys(url)) {
    if (map[k]) return map[k];
  }
  return null;
}
