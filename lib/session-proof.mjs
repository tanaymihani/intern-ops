/**
 * session-proof.mjs — lets a GitHub Actions run fetch a login session that
 * you saved through the website's Refresh page, without any GitHub token in
 * Vercel and without the Vercel password in GitHub. Both sides already share
 * FEED_KEY, so the runner proves itself with a short-lived HMAC:
 *
 *   x-session-proof: <unix-ms>.<base64url HMAC-SHA256(FEED_KEY, "<source>.<unix-ms>")>
 *
 * Valid for 5 minutes. The session itself is stored (and returned) encrypted
 * with FEED_KEY, so even the response is useless without the key.
 */
import { createHmac, timingSafeEqual } from 'crypto';

const WINDOW_MS = 5 * 60 * 1000;

function sign(key, source, ts) {
  return createHmac('sha256', Buffer.from(String(key), 'base64')).update(`${source}.${ts}`).digest('base64url');
}

export function makeProof(source, key = process.env.FEED_KEY, now = Date.now()) {
  return `${now}.${sign(key, source, now)}`;
}

export function verifyProof(header, source, key = process.env.FEED_KEY, now = Date.now()) {
  const [tsText, mac] = String(header || '').split('.');
  const ts = Number(tsText);
  if (!key || !mac || !Number.isFinite(ts) || Math.abs(now - ts) > WINDOW_MS) return false;
  const want = Buffer.from(sign(key, source, ts));
  const got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got);
}
