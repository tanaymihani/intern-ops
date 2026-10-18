// Vercel Routing Middleware: every page and API route needs a valid session
// cookie (lib/auth.mjs) except the login page itself. Unset SITE_PASSWORD to
// turn the gate off.
import { gateEnabled, hasValidSession, isPublicPath } from './lib/auth.mjs';

export const config = { matcher: '/:path*' };

// Same as `next()` from @vercel/functions: continue to the static file / function.
const pass = () => new Response(null, { headers: { 'x-middleware-next': '1' } });

export default async function middleware(request) {
  if (!gateEnabled()) return pass();
  const url = new URL(request.url);
  if (isPublicPath(url.pathname)) return pass();
  if (await hasValidSession(request.headers.get('cookie'))) return pass();
  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'Sign in first.' }), {
      status: 401,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
  const login = new URL('/login.html', url);
  if (url.pathname !== '/' && url.pathname !== '/index.html') login.searchParams.set('next', url.pathname);
  return Response.redirect(login, 302);
}
