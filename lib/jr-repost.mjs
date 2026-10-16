/**
 * JobRight often treats a re-list as "posted just now". Collapse those onto
 * the existing HC/scan card and keep the older date so they don't jump to
 * the top of Past 24h / 2 days.
 */

export function companyTitleKey(company, title) {
  const c = String(company || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const t = String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!c || !t) return '';
  return `${c}\t${t}`;
}

function epoch(iso) {
  if (!iso) return NaN;
  const s = String(iso).trim();
  if (!s) return NaN;
  const ms = Date.parse(s.length === 10 ? `${s}T12:00:00Z` : s.replace(' ', 'T'));
  return Number.isFinite(ms) ? ms : NaN;
}

/** Prefer the earlier timestamp (original post, not the re-list clock). */
export function olderIso(a, b) {
  const ae = epoch(a);
  const be = epoch(b);
  if (Number.isFinite(ae) && Number.isFinite(be)) return ae <= be ? a : b;
  return a || b || '';
}

/**
 * True when JobRight's date is at least 36h newer than a date we already
 * trust (HC / ATS scan / scan-history).
 */
export function isJrRepostClock(jrIso, earlierIso, minLagMs = 36 * 60 * 60 * 1000) {
  const jr = epoch(jrIso);
  const earlier = epoch(earlierIso);
  if (!Number.isFinite(jr) || !Number.isFinite(earlier)) return false;
  return jr - earlier >= minLagMs;
}

export function emptyJrClockStore() {
  return { byKey: {}, byRole: {} };
}

/** Keep the earliest date we have ever seen for this job / company+title. */
export function rememberJrDate(store, { key, role, iso }) {
  if (!store) return store;
  if (!store.byKey) store.byKey = {};
  if (!store.byRole) store.byRole = {};
  if (key && iso) store.byKey[key] = olderIso(store.byKey[key], iso);
  if (role && iso) store.byRole[role] = olderIso(store.byRole[role], iso);
  return store;
}

/**
 * Collapse a JobRight "posted just now" stamp onto the first date we stored
 * for this apply URL or company+title.
 */
export function groundJrJob(job, store) {
  const key = job.key || '';
  const role = job.role || companyTitleKey(job.company, job.title);
  const jrDate = job.postedAt || job.posted_at || '';
  const prev = (key && store?.byKey?.[key]) || (role && store?.byRole?.[role]) || '';
  const grounded = olderIso(jrDate, prev) || jrDate;
  const repost = Boolean(job.repost) || isJrRepostClock(jrDate, prev);
  rememberJrDate(store, { key, role, iso: grounded || jrDate });
  return { ...job, postedAt: grounded, posted_at: grounded, repost };
}
