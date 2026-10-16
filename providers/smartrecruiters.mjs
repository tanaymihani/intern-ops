// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// SmartRecruiters provider — public JSON postings API, no auth required.
// Auto-detects from `careers_url` on the `jobs.smartrecruiters.com/<identifier>`
// form; the identifier (case-preserved) is the company path segment used by
// both the public careers page and the API.
//
// Confirmed live 2026-10-13: every portals.yml entry tagged
// `provider: smartrecruiters` (19 enabled companies) previously failed every
// scan with "unknown provider: smartrecruiters" because this file never
// existed — scan.mjs/_registry.mjs correctly reported the error, it just had
// no provider to resolve to.

const PAGE_LIMIT = 100;
// Safety cap matching workday.mjs's pattern — SmartRecruiters tenants here
// are small (dozens to low hundreds of postings), so this is generous
// headroom, not a tight budget.
const MAX_PAGES = 50;

/** @param {import('./_types.js').PortalEntry} entry */
function resolveApiUrl(entry) {
  if (entry.api) return entry.api;
  const url = entry.careers_url || '';
  const match = url.match(/jobs\.smartrecruiters\.com\/([^/?#]+)/i);
  if (!match) return null;
  return `https://api.smartrecruiters.com/v1/companies/${match[1]}/postings`;
}

/** @param {any} location */
function formatLocation(location) {
  if (!location) return '';
  if (location.remote) return 'Remote';
  const parts = [location.city, location.region, location.country]
    .map((p) => String(p || '').trim())
    .filter(Boolean);
  // SmartRecruiters emits lowercase ISO country codes ("us") on the list
  // endpoint; location_filter matches on the words a human wrote in
  // portals.yml ("United States"), so a bare "us" would slip past a filter
  // that spells the country out. Expand only the handful actually seen on
  // this API rather than pulling in a full ISO table for one field.
  const COUNTRY_NAMES = { us: 'United States', gb: 'United Kingdom', ca: 'Canada', in: 'India' };
  if (parts.length) {
    const last = parts[parts.length - 1].toLowerCase();
    if (COUNTRY_NAMES[last]) parts[parts.length - 1] = COUNTRY_NAMES[last];
  }
  return parts.join(', ');
}

/** @type {Provider} */
export default {
  id: 'smartrecruiters',

  detect(entry) {
    const url = resolveApiUrl(entry);
    return url ? { url } : null;
  },

  async fetch(entry, ctx) {
    const apiUrl = resolveApiUrl(entry);
    if (!apiUrl) throw new Error(`smartrecruiters: cannot derive API URL for ${entry.name}`);
    const companyUrlMatch = (entry.careers_url || '').match(/jobs\.smartrecruiters\.com\/([^/?#]+)/i);
    const companySlug = companyUrlMatch ? companyUrlMatch[1] : '';

    const jobs = [];
    for (let offset = 0, page = 0; page < MAX_PAGES; page++) {
      const json = await ctx.fetchJson(`${apiUrl}?offset=${offset}&limit=${PAGE_LIMIT}`, { redirect: 'error' });
      const content = Array.isArray(json?.content) ? json.content : [];
      for (const posting of content) {
        if (!posting?.id) continue;
        jobs.push({
          title: posting.name || '',
          url: `https://jobs.smartrecruiters.com/${companySlug}/${posting.id}`,
          company: entry.name,
          location: formatLocation(posting.location),
          postedAt: posting.releasedDate ? Date.parse(posting.releasedDate) : undefined,
        });
      }
      offset += content.length;
      const totalFound = Number(json?.totalFound) || 0;
      if (content.length === 0 || offset >= totalFound) break;
    }
    return jobs;
  },
};
