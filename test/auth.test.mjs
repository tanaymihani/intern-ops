import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

// Node 18 has no global Web Crypto in ES modules (Vercel's Node 22 does).
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const { credentialsMatch, makeSessionCookie, hasValidSession, isPublicPath } = await import('../lib/auth.mjs');

const env = { SITE_USERNAME: 'admin', SITE_PASSWORD: 'correct horse battery', SITE_SECRET: 'test-secret' };
const cookieValue = (setCookie) => setCookie.split(';')[0];

test('username + password must both match', async () => {
  assert.equal(await credentialsMatch('admin', 'correct horse battery', env), true);
  assert.equal(await credentialsMatch(' Admin ', 'correct horse battery', env), true); // username is case/space-insensitive
  assert.equal(await credentialsMatch('root', 'correct horse battery', env), false);
  assert.equal(await credentialsMatch('admin', 'wrong', env), false);
  assert.equal(await credentialsMatch('', '', env), false);
  assert.equal(await credentialsMatch('admin', 'x', { SITE_USERNAME: 'admin' }), false); // no password configured
});

test('session cookies: valid, forged, expired, and invalidated by credential changes', async () => {
  const now = Date.now();
  const c = cookieValue(await makeSessionCookie(env, now));
  assert.equal(await hasValidSession(c, env, now + 1000), true);
  assert.equal(await hasValidSession(`${c}x`, env, now + 1000), false);
  assert.equal(await hasValidSession('io_session=9999999999999.forged', env, now), false);
  assert.equal(await hasValidSession(c, env, now + 91 * 86400000), false); // past 90 days
  assert.equal(await hasValidSession(c, { ...env, SITE_PASSWORD: 'new password' }, now + 1000), false);
  assert.equal(await hasValidSession(c, { ...env, SITE_USERNAME: 'tanay' }, now + 1000), false);
});

test('only the login page and the runner endpoint skip the gate', () => {
  for (const p of ['/login.html', '/login.js', '/style.css', '/api/login', '/api/session']) assert.equal(isPublicPath(p), true, p);
  for (const p of ['/', '/index.html', '/app.js', '/api/jobs', '/api/state', '/api/refresh-cookie', '/refresh.html']) assert.equal(isPublicPath(p), false, p);
});
