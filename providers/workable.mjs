// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Workable provider — public widget JSON API, no auth required.
// Auto-detects from `careers_url` on `apply.workable.com/<account>` or
// `<account>.workable.com`. The bare `https://jobs.workable.com` landing
// page (no account slug) cannot be auto-detected — portals.yml already
// disables that entry pending a real slug (see "pony.ai" seed row).
//
// Confirmed live 2026-10-13: 4 enabled portals.yml companies tagged
// `provider: workable` previously failed every scan with
// "unknown provider: workable" because this file never existed.

/** @param {import('./_types.js').PortalEntry} entry */
function resolveAccount(entry) {
  const url = entry.careers_url || entry.api || '';
  let account = url.match(/apply\.workable\.com\/([^/?#]+)/i)?.[1] || '';
  if (!account) account = url.match(/^https?:\/\/([^.]+)\.workable\.com/i)?.[1] || '';
  // The generic landing page carries no account at all — treat it the same
  // as "no slug", not a false-positive match on "jobs".
  if (/^(apply|jobs|www)$/i.test(account)) return '';
  return account;
}

function apiUrlFor(account) {
  return `https://apply.workable.com/api/v1/widget/accounts/${account}?details=true`;
}

/** @param {any} job */
function formatLocation(job) {
  const parts = [job?.city, job?.state, job?.country].map((p) => String(p || '').trim()).filter(Boolean);
  const place = parts.join(', ');
  if (job?.telecommuting) return place ? `Remote · ${place}` : 'Remote';
  return place;
}

/** @type {Provider} */
export default {
  id: 'workable',

  detect(entry) {
    const account = resolveAccount(entry);
    return account ? { url: apiUrlFor(account) } : null;
  },

  async fetch(entry, ctx) {
    const account = resolveAccount(entry);
    if (!account) throw new Error(`workable: cannot derive account slug for ${entry.name}`);
    const json = await ctx.fetchJson(apiUrlFor(account), { redirect: 'error' });
    const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
    return jobs
      .filter((job) => job?.url)
      .map((job) => ({
        title: job.title || '',
        url: job.url,
        company: entry.name,
        location: formatLocation(job),
        postedAt: job.published_on ? Date.parse(job.published_on) : undefined,
      }));
  },
};
