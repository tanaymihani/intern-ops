const GH_HOSTS = new Set(['job-boards.greenhouse.io', 'job-boards.eu.greenhouse.io', 'boards.greenhouse.io']);
const ASHBY_HOSTS = new Set(['jobs.ashbyhq.com']);
const LEVER_HOSTS = new Set(['jobs.lever.co', 'jobs.eu.lever.co']);
const LOCALE_RE = /^[a-z]{2}(?:-[a-z]{2})?$/i;

function cleanParts(pathname) {
  // Keep both the raw (still percent-encoded) and decoded form of each path
  // segment — boardUrl must stay a valid fetchable URL (raw), while slug/key
  // should read and compare as a human name (decoded). Using the decoded
  // form for boardUrl produces an invalid URL for any slug with a space or
  // other now-literal character (e.g. "8090%20Solutions%20Inc" decoding to
  // "8090 Solutions Inc").
  const raw = pathname.split('/').filter(Boolean);
  return raw.map((p) => ({ raw: p, decoded: decodeURIComponent(p) }));
}

export function extractOfficialBoardCandidate(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  const parts = cleanParts(url.pathname);

  if (GH_HOSTS.has(host)) {
    let slug = '';
    let rawSlug = '';
    if (parts[0]?.decoded === 'embed' && parts[1]?.decoded === 'job_app') {
      slug = url.searchParams.get('for') || '';
      rawSlug = encodeURIComponent(slug);
    } else {
      slug = parts[0]?.decoded || '';
      rawSlug = parts[0]?.raw || '';
    }
    if (!slug || /^(jobs?|embed)$/i.test(slug)) return null;
    return {
      key: `greenhouse:${slug.toLowerCase()}`,
      ats: 'greenhouse', slug,
      boardUrl: `https://${host}/${rawSlug}`,
    };
  }

  if (ASHBY_HOSTS.has(host)) {
    const slug = parts[0]?.decoded || '';
    const rawSlug = parts[0]?.raw || '';
    if (!slug) return null;
    return { key: `ashby:${slug.toLowerCase()}`, ats: 'ashby', slug, boardUrl: `https://${host}/${rawSlug}` };
  }

  if (LEVER_HOSTS.has(host)) {
    const slug = parts[0]?.decoded || '';
    const rawSlug = parts[0]?.raw || '';
    if (!slug) return null;
    return { key: `lever:${slug.toLowerCase()}`, ats: 'lever', slug, boardUrl: `https://${host}/${rawSlug}` };
  }

  if (host.endsWith('.myworkdayjobs.com')) {
    const withoutLocale = parts[0] && LOCALE_RE.test(parts[0].decoded) ? parts.slice(1) : parts;
    const slug = withoutLocale[0]?.decoded || '';
    const rawSlug = withoutLocale[0]?.raw || '';
    if (!slug) return null;
    return {
      key: `workday:${host}/${slug.toLowerCase()}`,
      ats: 'workday', slug,
      boardUrl: `https://${host}/${rawSlug}`,
    };
  }

  return null;
}

function validIso(value, fallback = '') {
  return value && Number.isFinite(Date.parse(String(value))) ? new Date(Date.parse(String(value))).toISOString() : fallback;
}

function earlier(a, b) {
  if (!a) return b || '';
  if (!b) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

function later(a, b) {
  if (!a) return b || '';
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

export function buildOfficialBoardRegistry({ feeds = [], previous = {}, trackedKeys = new Set(), now = new Date().toISOString() } = {}) {
  const generatedAt = validIso(now, new Date().toISOString());
  const previousByKey = new Map((previous.boards || []).map((board) => [board.key, board]));
  const byKey = new Map();

  for (const feed of feeds) {
    const source = String(feed.source || 'unknown');
    const feedSeen = validIso(feed.fetchedAt, generatedAt);
    for (const job of Array.isArray(feed.jobs) ? feed.jobs : []) {
      const candidate = extractOfficialBoardCandidate(job.url || job.applyUrl || job.jobUrl);
      if (!candidate) continue;
      const seenAt = validIso(job.discoveredAt || job.first_seen || job.firstSeenAt, feedSeen);
      const lastSeenAt = validIso(job.lastSeenAt || job.last_seen, feedSeen);
      const existing = byKey.get(candidate.key) || previousByKey.get(candidate.key) || {};
      const claims = new Set([...(existing.companyClaims || []), String(job.company || job.companyName || '').trim()].filter(Boolean));
      const sourceMap = new Map((existing.sources || []).map((entry) => [entry.source, { ...entry }]));
      const sourceEntry = sourceMap.get(source) || { source, sampleJobUrl: job.url || job.applyUrl || job.jobUrl || '' };
      sourceEntry.sampleJobUrl ||= job.url || job.applyUrl || job.jobUrl || '';
      sourceEntry.firstSeenAt = earlier(validIso(sourceEntry.firstSeenAt), seenAt) || seenAt;
      sourceEntry.lastSeenAt = later(validIso(sourceEntry.lastSeenAt), lastSeenAt) || lastSeenAt;
      sourceMap.set(source, sourceEntry);

      byKey.set(candidate.key, {
        ...candidate,
        companyClaims: [...claims].sort((a, b) => a.localeCompare(b)),
        sources: [...sourceMap.values()].sort((a, b) => a.source.localeCompare(b.source)),
        firstSeenAt: earlier(validIso(existing.firstSeenAt), seenAt) || seenAt,
        lastSeenAt: later(validIso(existing.lastSeenAt), lastSeenAt) || lastSeenAt,
        state: existing.state || 'candidate',
        alreadyTracked: trackedKeys.has(candidate.key),
        verification: existing.verification || { status: 'not_checked' },
      });
    }
  }

  // Preserve manually reviewed rows even when their evidence aged out of rolling feeds.
  for (const board of previous.boards || []) {
    if (!byKey.has(board.key) && ['accepted', 'rejected'].includes(board.state)) {
      byKey.set(board.key, { ...board, alreadyTracked: trackedKeys.has(board.key) });
    }
  }

  const boards = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  return {
    generatedAt,
    boardCount: boards.length,
    candidateCount: boards.filter((b) => b.state === 'candidate').length,
    acceptedCount: boards.filter((b) => b.state === 'accepted').length,
    alreadyTrackedCount: boards.filter((b) => b.alreadyTracked).length,
    boards,
  };
}
