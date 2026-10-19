/**
 * remote-session.mjs — in GitHub Actions, fetch the login you last saved on
 * the site's Refresh page (see api/session.js). Returns { cookie, host,
 * savedAt } or null when there's none / the site isn't reachable, so callers
 * fall back to the HANDSHAKE_SESSION / JOBRIGHT_COOKIE secrets.
 */
import { makeProof } from './session-proof.mjs';
import { decryptJson, hasFeedKey } from './feed-crypto.mjs';

export async function fetchRemoteSession(source, { base = process.env.SESSION_SOURCE_URL } = {}) {
  if (!base || !hasFeedKey()) return null;
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/api/session?source=${encodeURIComponent(source)}`, {
      headers: { 'x-session-proof': makeProof(source) },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status !== 200) return null;
    const { envelope } = await res.json();
    const session = decryptJson(envelope);
    return session?.cookie ? session : null;
  } catch {
    return null;
  }
}
