// GET /api/session?source=handshake — for the GitHub Actions scrapers only.
// Not behind the password gate (a runner has no browser session); instead it
// must send a fresh HMAC proof made with FEED_KEY (lib/session-proof.mjs).
// Returns the session still encrypted with FEED_KEY.
import { verifyProof } from '../lib/session-proof.mjs';
import { loadSessionEnvelope, SESSION_SOURCES } from '../lib/session-store.mjs';
import { storeConfigured } from '../lib/doc-store.mjs';

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

export async function GET(request) {
  const source = new URL(request.url).searchParams.get('source') || '';
  if (!SESSION_SOURCES[source]) return json(400, { error: 'unknown source' });
  if (!verifyProof(request.headers.get('x-session-proof'), source)) return json(401, { error: 'bad proof' });
  if (!storeConfigured()) return json(404, { error: 'no storage' });
  try {
    const envelope = await loadSessionEnvelope(source);
    return envelope ? json(200, { envelope }) : json(404, { error: 'no session saved' });
  } catch (err) {
    return json(502, { error: String(err.message || err) });
  }
}
