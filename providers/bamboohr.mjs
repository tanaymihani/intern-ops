// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// BambooHR provider — public /careers/list JSON endpoint, no auth required.
// Auto-detects from `careers_url` on any `*.bamboohr.com` host.
//
// Confirmed live 2026-10-13: 8 enabled portals.yml companies tagged
// `provider: bamboohr` previously failed every scan with
// "unknown provider: bamboohr" because this file never existed.
//
// The list endpoint carries no posting date at all (verified against a real
// tenant) — same undated-policy shape as iCIMS's list page, so postedAt is
// simply omitted rather than guessed.

/** @param {import('./_types.js').PortalEntry} entry */
function resolveHost(entry) {
  const url = entry.careers_url || entry.api || '';
  const match = url.match(/^https?:\/\/([a-z0-9-]+\.bamboohr\.com)/i);
  return match ? match[1] : '';
}

/** @param {any} job */
function formatLocation(job) {
  if (job?.isRemote) return 'Remote';
  const fromLocation = [job?.location?.city, job?.location?.state].map((p) => String(p || '').trim()).filter(Boolean);
  if (fromLocation.length) return fromLocation.join(', ');
  const ats = job?.atsLocation || {};
  const fromAts = [ats.city, ats.state || ats.province, ats.country].map((p) => String(p || '').trim()).filter(Boolean);
  return fromAts.join(', ');
}

/** @type {Provider} */
export default {
  id: 'bamboohr',

  detect(entry) {
    const host = resolveHost(entry);
    return host ? { url: `https://${host}/careers/list` } : null;
  },

  async fetch(entry, ctx) {
    const host = resolveHost(entry);
    if (!host) throw new Error(`bamboohr: cannot derive tenant host for ${entry.name}`);
    const json = await ctx.fetchJson(`https://${host}/careers/list`, { redirect: 'error' });
    const result = Array.isArray(json?.result) ? json.result : [];
    return result
      .filter((job) => job?.id)
      .map((job) => ({
        title: job.jobOpeningName || '',
        url: `https://${host}/careers/${job.id}`,
        company: entry.name,
        location: formatLocation(job),
      }));
  },
};
