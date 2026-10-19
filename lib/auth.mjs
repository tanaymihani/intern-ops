/**
 * auth.mjs — single-password gate for the dashboard. Web Crypto only, so the
 * same code runs in Vercel's edge middleware and in Node (api/login, the
 * local dev server).
 *
 * Session cookie: `<expiry-ms>.<HMAC-SHA256(SITE_SECRET, expiry + password hash)>`,
 * HttpOnly + Secure + SameSite=Lax. Folding the password hash into the
 * signature means changing SITE_PASSWORD signs every device out.
 */
export const SESSION_COOKIE = 'io_session';
export const SESSION_DAYS = 90;

const enc = new TextEncoder();

function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(text) {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(String(text))));
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

/** Length-independent constant-time string comparison. */
function safeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

export function gateEnabled(env = process.env) {
  return Boolean(env.SITE_PASSWORD);
}

/** Secret for signing sessions; SITE_SECRET in production, derived from the password otherwise. */
function signingSecret(env) {
  return env.SITE_SECRET || `derived:${env.SITE_PASSWORD}`;
}

export async function passwordMatches(given, env = process.env) {
  if (!env.SITE_PASSWORD) return false;
  return safeEqual(await sha256(given || ''), await sha256(env.SITE_PASSWORD));
}

export async function makeSessionCookie(env = process.env, now = Date.now()) {
  const exp = now + SESSION_DAYS * 86400000;
  const sig = await hmac(signingSecret(env), `${exp}.${await sha256(env.SITE_PASSWORD)}`);
  return `${SESSION_COOKIE}=${exp}.${sig}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

export async function hasValidSession(cookieHeader, env = process.env, now = Date.now()) {
  if (!env.SITE_PASSWORD) return true;
  const value = readCookie(cookieHeader, SESSION_COOKIE);
  const dot = value.indexOf('.');
  if (dot <= 0) return false;
  const exp = Number(value.slice(0, dot));
  if (!Number.isFinite(exp) || exp < now) return false;
  const want = await hmac(signingSecret(env), `${exp}.${await sha256(env.SITE_PASSWORD)}`);
  return safeEqual(value.slice(dot + 1), want);
}

/** Paths reachable without a session: the login page and its assets. */
export function isPublicPath(pathname) {
  // api/session authenticates itself (HMAC proof from GitHub Actions).
  return /^\/(login\.html|login\.js|style\.css|favicon\.ico|api\/login|api\/session)$/.test(pathname);
}
