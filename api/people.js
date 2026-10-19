// /api/people — email lookups for the People panel, via Hunter.io.
//
//   GET  ?company=&domain=                 cached result for this company (free), plus whether Hunter is set up
//   POST {action:'lookup', company, domain}  domain search: email format + a few recruiting / HR emails
//   POST {action:'find', name, company, domain}  exact email for one person
//
// Hunter's free plan is 50 credits/month (1 per email found, nothing if
// nothing's found), so lookups only happen when you click, and every result
// is cached for 60 days in the private Blob store — a company never costs
// twice. Behind the password gate (middleware.js); HUNTER_API_KEY is a
// Vercel env var.
import { get, put } from '@vercel/blob';

const HUNTER = 'https://api.hunter.io/v2';
const CACHE_DAYS = 60;

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
});

const cacheKey = ({ company, domain }) => {
  const k = String(domain || company || '').toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return k ? `people/${k}.json` : '';
};

async function readCache(path) {
  if (!path || !process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const r = await get(path, { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    const doc = JSON.parse(await new Response(r.stream).text());
    return Date.now() - Date.parse(doc.fetchedAt || 0) < CACHE_DAYS * 86400000 ? doc : null;
  } catch {
    return null;
  }
}

async function writeCache(path, doc) {
  if (!path || !process.env.BLOB_READ_WRITE_TOKEN) return;
  await put(path, JSON.stringify(doc), {
    access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 60,
  });
}

class HunterError extends Error {}

async function hunter(endpoint, params) {
  const qs = new URLSearchParams({ ...params, api_key: process.env.HUNTER_API_KEY });
  const res = await fetch(`${HUNTER}/${endpoint}?${qs}`, { signal: AbortSignal.timeout(20_000) });
  const body = await res.json().catch(() => ({}));
  if (res.ok) return body.data || {};
  const detail = body?.errors?.[0]?.details || body?.errors?.[0]?.id || '';
  if (res.status === 401) throw new HunterError('Hunter rejected the API key — check HUNTER_API_KEY.');
  if (res.status === 429) throw new HunterError("This month's free Hunter credits are used up — they reset monthly.");
  if (res.status === 403) throw new HunterError(`Hunter refused the request (${detail || 'plan or rate limit'}).`);
  throw new HunterError(`Hunter error ${res.status}${detail ? `: ${detail}` : ''}`);
}

const person = (e) => ({
  email: e.value,
  name: [e.first_name, e.last_name].filter(Boolean).join(' '),
  position: e.position || '',
  department: e.department || '',
  linkedin: e.linkedin || '',
  confidence: e.confidence ?? null,
  verified: e.verification?.status === 'valid',
});

async function lookup({ company, domain }) {
  const target = domain ? { domain } : { company };
  // Recruiting / HR first — the people who answer intern questions.
  let data = await hunter('domain-search', { ...target, department: 'hr', type: 'personal', limit: '3' });
  let emails = (data.emails || []).map(person);
  if (!data.pattern && !emails.length) {
    data = await hunter('domain-search', { ...target, limit: '1' });
    emails = (data.emails || []).map(person);
  }
  return {
    company: data.organization || company || '',
    domain: data.domain || domain || '',
    pattern: data.pattern || '',
    emails,
    finds: {},
    fetchedAt: new Date().toISOString(),
  };
}

export async function GET(request) {
  const q = new URL(request.url).searchParams;
  const company = q.get('company') || '';
  const domain = q.get('domain') || '';
  const cached = await readCache(cacheKey({ company, domain }));
  return json(200, { configured: Boolean(process.env.HUNTER_API_KEY), result: cached });
}

export async function POST(request) {
  if (!process.env.HUNTER_API_KEY) return json(501, { error: 'Email lookup needs a Hunter.io API key (HUNTER_API_KEY).' });
  const body = await request.json().catch(() => ({}));
  const company = String(body.company || '').slice(0, 120);
  const domain = String(body.domain || '').toLowerCase().replace(/[^a-z0-9.-]/g, '').slice(0, 100);
  if (!company && !domain) return json(400, { error: 'company or domain required' });
  const path = cacheKey({ company, domain });
  try {
    if (body.action === 'lookup') {
      const cached = await readCache(path);
      if (cached) return json(200, { result: cached, cached: true });
      const result = await lookup({ company, domain });
      await writeCache(path, result);
      return json(200, { result, cached: false });
    }
    if (body.action === 'find') {
      const name = String(body.name || '').trim().slice(0, 100);
      if (!/\S+\s+\S+/.test(name)) return json(400, { error: 'Need a first and last name.' });
      const doc = (await readCache(path)) || { company, domain, pattern: '', emails: [], finds: {}, fetchedAt: new Date().toISOString() };
      const k = name.toLowerCase();
      if (doc.finds?.[k]) return json(200, { find: doc.finds[k], cached: true });
      const data = await hunter('email-finder', { ...(domain ? { domain } : { company }), full_name: name });
      const find = {
        email: data.email || '',
        score: data.score ?? null,
        position: data.position || '',
        verified: data.verification?.status === 'valid',
        linkedin: data.linkedin_url || '',
      };
      doc.finds = { ...(doc.finds || {}), [k]: find };
      if (!doc.domain && data.domain) doc.domain = data.domain;
      await writeCache(path, doc);
      return json(200, { find, cached: false });
    }
    return json(400, { error: 'unknown action' });
  } catch (err) {
    return json(err instanceof HunterError ? 502 : 500, { error: String(err.message || err) });
  }
}
