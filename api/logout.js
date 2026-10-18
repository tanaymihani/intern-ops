// POST /api/logout — clear the session cookie on this device.
import { clearSessionCookie } from '../lib/auth.mjs';

export function POST() {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'set-cookie': clearSessionCookie() },
  });
}
