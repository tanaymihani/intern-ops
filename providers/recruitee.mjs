// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Recruitee provider — public /api/offers/ JSON endpoint, no auth required.
// Auto-detects from `careers_url` on any `<company>.recruitee.com` host.
//
// Confirmed live 2026-10-13: the one enabled portals.yml company tagged
// `provider: recruitee` previously failed every scan with
// "unknown provider: recruitee" because this file never existed.

/** @param {import('./_types.js').PortalEntry} entry */
function resolveSubdomain(entry) {
  const url = entry.careers_url || entry.api || '';
  const match = url.match(/^https?:\/\/([a-z0-9-]+)\.recruitee\.com/i);
  const sub = match ? match[1] : '';
  // "www.recruitee.com" is the marketing site, not a real tenant.
  return /^www$/i.test(sub) ? '' : sub;
}

/** @param {any} offer */
function formatLocation(offer) {
  if (offer?.remote) return 'Remote';
  return [offer?.city, offer?.country].map((p) => String(p || '').trim()).filter(Boolean).join(', ');
}

/** @type {Provider} */
export default {
  id: 'recruitee',

  detect(entry) {
    const sub = resolveSubdomain(entry);
    return sub ? { url: `https://${sub}.recruitee.com/api/offers/` } : null;
  },

  async fetch(entry, ctx) {
    const sub = resolveSubdomain(entry);
    if (!sub) throw new Error(`recruitee: cannot derive tenant subdomain for ${entry.name}`);
    const json = await ctx.fetchJson(`https://${sub}.recruitee.com/api/offers/`, { redirect: 'error' });
    const offers = Array.isArray(json?.offers) ? json.offers : [];
    return offers
      .filter((offer) => offer?.careers_url)
      .map((offer) => ({
        title: offer.title || '',
        url: offer.careers_url,
        company: entry.name,
        location: formatLocation(offer),
        postedAt: offer.created_at ? Date.parse(offer.created_at) : undefined,
      }));
  },
};
