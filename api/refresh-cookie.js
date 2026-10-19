// POST /api/refresh-cookie {password, source, curl} — save a fresh login for
// Handshake or JobRight. Paste a DevTools "Copy as cURL" from a signed-in tab
// on any computer; the cookie is encrypted (FEED_KEY) into the private Blob
// store, and the next scheduled GitHub run picks it up via /api/session.
// Behind the site's password gate, and asks for the password again.
import { passwordMatches } from '../lib/auth.mjs';
import { extractCookie, curlHost } from '../lib/cookie.mjs';
import { saveSession, SESSION_SOURCES } from '../lib/session-store.mjs';
import { hasFeedKey } from '../lib/feed-crypto.mjs';

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export async function POST(request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN || !hasFeedKey()) {
    return json(501, { error: 'Login refresh is not configured on this deployment.' });
  }
  const { password, source, curl } = await request.json().catch(() => ({}));
  if (!(await passwordMatches(password))) {
    await new Promise((r) => setTimeout(r, 900));
    return json(401, { error: 'Wrong password.' });
  }
  const cfg = SESSION_SOURCES[source];
  if (!cfg) return json(400, { error: 'Unknown source.' });
  const host = curlHost(curl);
  if (!host || !cfg.host.test(host)) return json(400, { error: `Copy a request to ${source === 'handshake' ? 'joinhandshake.com' : 'jobright.ai'} (this one went to ${host || 'an unknown host'}).` });
  const cookie = extractCookie(curl);
  if (cookie.length < 20 || !cfg.mustHave.test(cookie)) {
    return json(400, { error: 'No login cookie in that request — make sure you copied it from a signed-in tab.' });
  }
  try {
    await saveSession(source, { cookie, host });
    return json(200, { message: `Saved. The next ${source === 'handshake' ? 'Handshake (every 6 h)' : 'JobRight (every 2 h)'} run will use it.` });
  } catch (err) {
    return json(502, { error: String(err.message || err) });
  }
}
