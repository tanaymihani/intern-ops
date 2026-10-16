// POST /api/refresh-cookie {password, source, curl} — paste a DevTools
// "Copy as cURL" from a logged-in JobRight tab; the cookie is sealed with the
// repo's Actions public key and stored as a GitHub Actions secret, then a run
// is kicked off. Needs Vercel env: GH_TOKEN (fine-grained PAT: this repo,
// Secrets read/write + Actions read/write), DASHBOARD_PASSWORD, DATA_REPO.
import { createHash, timingSafeEqual } from 'crypto';
import sodium from 'libsodium-wrappers';
import { extractCookie, curlHost } from '../lib/cookie.mjs';

const SOURCES = {
  jobright: { secret: 'JOBRIGHT_COOKIE', workflow: 'jobright.yml', host: /(^|\.)jobright\.ai$/ },
};

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function passwordOk(given) {
  const want = process.env.DASHBOARD_PASSWORD || '';
  const a = createHash('sha256').update(String(given || '')).digest();
  const b = createHash('sha256').update(want).digest();
  return want.length > 0 && timingSafeEqual(a, b);
}

async function github(path, init = {}) {
  const res = await fetch(`https://api.github.com/repos/${process.env.DATA_REPO}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${process.env.GH_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub ${init.method || 'GET'} ${path} → ${res.status}`);
  return res.status === 204 || res.status === 201 ? null : res.json();
}

export async function POST(request) {
  if (!process.env.GH_TOKEN || !process.env.DASHBOARD_PASSWORD || !process.env.DATA_REPO) {
    return json(501, { error: 'Login refresh is not configured on this deployment (see SETUP.md).' });
  }
  const { password, source, curl } = await request.json().catch(() => ({}));
  if (!passwordOk(password)) return json(401, { error: 'Wrong dashboard password.' });
  const cfg = SOURCES[source];
  if (!cfg) return json(400, { error: 'Unknown source.' });
  const host = curlHost(curl);
  if (host && !cfg.host.test(host)) return json(400, { error: `That request went to ${host}, not ${source}.` });
  const cookie = extractCookie(curl);
  if (cookie.length < 20) return json(400, { error: 'No cookie found — paste the whole "Copy as cURL" output.' });

  try {
    const { key, key_id: keyId } = await github('/actions/secrets/public-key');
    await sodium.ready;
    const sealed = sodium.crypto_box_seal(sodium.from_string(cookie), sodium.from_base64(key, sodium.base64_variants.ORIGINAL));
    await github(`/actions/secrets/${cfg.secret}`, {
      method: 'PUT',
      body: JSON.stringify({ encrypted_value: sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL), key_id: keyId }),
    });
    let kicked = true;
    try {
      await github(`/actions/workflows/${cfg.workflow}/dispatches`, {
        method: 'POST',
        body: JSON.stringify({ ref: process.env.DATA_BRANCH || 'main' }),
      });
    } catch {
      kicked = false;
    }
    return json(200, { message: `Updated ${cfg.secret}.${kicked ? ' A fresh run has started.' : ''}` });
  } catch (err) {
    return json(502, { error: String(err.message || err) });
  }
}
