// POST /api/login {password} → session cookie. Wrong passwords wait ~1s so
// guessing is slow; the cookie is HttpOnly so page scripts never see it.
import { passwordMatches, makeSessionCookie, gateEnabled } from '../lib/auth.mjs';

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
});

export async function POST(request) {
  if (!gateEnabled()) return json(200, { ok: true });
  const { password } = await request.json().catch(() => ({}));
  if (!(await passwordMatches(password))) {
    await new Promise((r) => setTimeout(r, 900 + Math.random() * 400));
    return json(401, { error: 'Wrong password.' });
  }
  return json(200, { ok: true }, { 'set-cookie': await makeSessionCookie() });
}
