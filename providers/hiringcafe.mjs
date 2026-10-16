// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Hiring Cafe aggregator — paginates the public SSR search page
// (https://hiringcafe.com/?page=N&searchState=…). Zero auth; each page embeds
// hits in __NEXT_DATA__.pageProps.ssrHits. Job URLs are the employer apply
// links (apply_url), not hiringcafe.com.
//
// Wire via job_boards: with `provider: hiringcafe` and optional `searchState:`
// (same shape as the site's URL param). Defaults match a US software-engineer
// IC search over the last few days.

import { BROWSER_LIKE_USER_AGENT } from './_http.mjs';

const ORIGIN = 'https://hiringcafe.com';
const MAX_PAGES = 40;
const PAGE_DELAY_MS = 150;

/** @type {Record<string, unknown>} */
export const DEFAULT_SEARCH_STATE = {
  locations: [{
    formatted_address: 'United States',
    types: ['country'],
    geometry: { location: { lat: 33.7485, lon: -84.3871 } },
    id: 'user_country',
    address_components: [{ long_name: 'United States', short_name: 'US', types: ['country'] }],
    options: { flexible_regions: ['anywhere_in_continent', 'anywhere_in_world'] },
  }],
  searchQuery: 'software engineer',
  dateFetchedPastNDays: 4,
  hideJobTypes: ['Applied'],
  departments: ['Software Development', 'Engineering', 'Information Technology'],
  roleTypes: ['Individual Contributor'],
  seniorityLevel: ['Entry Level', 'Mid Level', 'No Prior Experience Required'],
  securityClearances: ['None'],
  sortBy: 'date',
};

function sleep(ms, ctx) {
  if (typeof ctx?.sleep === 'function') return ctx.sleep(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** @param {unknown} entry */
export function resolveSearchState(entry) {
  const raw = entry && typeof entry === 'object' ? /** @type {any} */ (entry).searchState : null;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...DEFAULT_SEARCH_STATE, ...raw };
  }
  return { ...DEFAULT_SEARCH_STATE };
}

/**
 * Build a search URL for page N (0-indexed).
 * @param {Record<string, unknown>} searchState
 * @param {number} page
 */
export function buildSearchUrl(searchState, page = 0) {
  const u = new URL(ORIGIN + '/');
  if (page > 0) u.searchParams.set('page', String(page));
  u.searchParams.set('searchState', JSON.stringify(searchState));
  return u.href;
}

/**
 * Extract pageProps from a Hiring Cafe HTML document.
 * @param {string} html
 * @returns {any | null}
 */
export function extractPageProps(html) {
  if (typeof html !== 'string') return null;
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1])?.props?.pageProps ?? null;
  } catch {
    return null;
  }
}

/** @param {any} v5 */
function formatCompensation(v5) {
  if (!v5 || typeof v5 !== 'object') return '';
  const fmt = (n) => {
    const x = Number(n);
    if (!Number.isFinite(x) || x <= 0) return '';
    if (x >= 1000) return `$${Math.round(x / 1000)}k`;
    return `$${Math.round(x)}`;
  };
  const yMin = fmt(v5.yearly_min_compensation);
  const yMax = fmt(v5.yearly_max_compensation);
  if (yMin || yMax) {
    if (yMin && yMax && yMin !== yMax) return `${yMin}-${yMax}/yr`;
    return `${yMin || yMax}/yr`;
  }
  const hMin = fmt(v5.hourly_min_compensation);
  const hMax = fmt(v5.hourly_max_compensation);
  if (hMin || hMax) {
    if (hMin && hMax && hMin !== hMax) return `${hMin}-${hMax}/hr`;
    return `${hMin || hMax}/hr`;
  }
  return '';
}

/** @param {any} v5 */
function formatYoe(v5) {
  const y = v5?.min_industry_and_role_yoe;
  if (y == null || y === '' || v5?.is_min_industry_and_role_yoe_not_mentioned) return '';
  const n = Number(y);
  if (!Number.isFinite(n)) return '';
  return `${n}+ YOE`;
}

/**
 * Normalize SSR hits into the scanner Job contract (+ optional HC-rich fields).
 * @param {any[]} hits
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number, salary?: string, workplace?: string, commitment?: string, yoe?: string, summary?: string, tools?: string[], company_tagline?: string, ats_source?: string}>}
 */
export function parseHits(hits) {
  const rows = Array.isArray(hits) ? hits : [];
  const out = [];
  for (const h of rows) {
    if (!h || typeof h !== 'object') continue;
    if (h.is_expired) continue;
    const title = String(h.job_information?.title || h.job_information?.job_title_raw || '').trim();
    const url = typeof h.apply_url === 'string' ? h.apply_url.trim() : '';
    if (!title || !/^https?:\/\//i.test(url)) continue;
    const v5 = h.v5_processed_job_data || {};
    const company = String(
      h.enriched_company_data?.name
      || v5.company_name
      || h.board_token
      || 'Hiring Cafe'
    ).trim();
    const location = String(v5.formatted_workplace_location || '').trim();
    const ms = Number(v5.estimated_publish_date_millis);
    const postedAt = Number.isFinite(ms) && ms > 0
      ? ms
      : (() => {
          const parsed = Date.parse(v5.estimated_publish_date || '');
          return Number.isNaN(parsed) ? undefined : parsed;
        })();
    const tools = Array.isArray(v5.technical_tools)
      ? v5.technical_tools.map((t) => String(t).trim()).filter(Boolean).slice(0, 12)
      : [];
    const commitment = Array.isArray(v5.commitment)
      ? v5.commitment.map((c) => String(c).trim()).filter(Boolean).join(' · ')
      : String(v5.commitment || '').trim();
    out.push({
      title,
      url,
      company,
      location,
      postedAt,
      salary: formatCompensation(v5),
      workplace: String(v5.workplace_type || '').trim(),
      commitment,
      yoe: formatYoe(v5),
      summary: String(v5.requirements_summary || '').trim().slice(0, 320),
      tools,
      company_tagline: String(v5.company_tagline || v5.company_sector_and_industry || '').trim().slice(0, 180),
      ats_source: String(h.source || '').trim().toLowerCase(),
    });
  }
  return out;
}

function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES);
  return MAX_PAGES;
}

/** @type {Provider} */
export default {
  id: 'hiringcafe',

  detect(entry) {
    if (entry?.provider === 'hiringcafe') return { url: ORIGIN + '/' };
    const raw = entry?.api || entry?.careers_url || '';
    if (typeof raw !== 'string' || !raw) return null;
    try {
      const u = new URL(raw);
      if (u.protocol === 'https:' && (u.hostname === 'hiringcafe.com' || u.hostname === 'www.hiringcafe.com')) {
        return { url: ORIGIN + '/' };
      }
    } catch {
      return null;
    }
    return null;
  },

  async fetch(entry, ctx) {
    const searchState = resolveSearchState(entry);
    const maxPages = resolveMaxPages(entry);
    const seen = new Set();
    const jobs = [];
    let page = 0;
    let isLast = false;

    while (page < maxPages && !isLast) {
      const url = buildSearchUrl(searchState, page);
      const html = await ctx.fetchText(url, {
        redirect: 'error',
        headers: {
          'user-agent': BROWSER_LIKE_USER_AGENT,
          accept: 'text/html',
        },
      });
      const pp = extractPageProps(html);
      if (!pp) throw new Error(`hiringcafe: missing __NEXT_DATA__ on page ${page}`);
      const batch = parseHits(pp.ssrHits);
      for (const job of batch) {
        const key = job.url.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        jobs.push(job);
      }
      isLast = Boolean(pp.ssrIsLastPage) || batch.length === 0;
      page += 1;
      if (!isLast && page < maxPages) await sleep(PAGE_DELAY_MS, ctx);
    }

    if (page >= maxPages && !isLast) {
      console.error(`⚠️  hiringcafe: hit max_pages=${maxPages}; results may be truncated`);
    }
    return jobs;
  },
};
