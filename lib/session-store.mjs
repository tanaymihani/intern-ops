/**
 * session-store.mjs — login sessions (Handshake, JobRight) pasted on the
 * site's Refresh page, kept in the private Vercel Blob store, encrypted with
 * FEED_KEY. Read back by GitHub Actions through /api/session.
 */
import { get, put } from '@vercel/blob';
import { encryptJson } from './feed-crypto.mjs';

export const SESSION_SOURCES = {
  handshake: { host: /(^|\.)joinhandshake\.com$/, mustHave: /\b(hss-global|_trajectory_session)=/ },
  jobright: { host: /(^|\.)jobright\.ai$/, mustHave: /=/ },
};

const pathFor = (source) => `secrets/${source}-session.json`;

export async function saveSession(source, { cookie, host }) {
  const envelope = encryptJson({ source, cookie, host, savedAt: new Date().toISOString() });
  await put(pathFor(source), JSON.stringify(envelope), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 60,
  });
}

/** The stored envelope, still encrypted — or null. */
export async function loadSessionEnvelope(source) {
  const r = await get(pathFor(source), { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200 || !r.stream) return null;
  return JSON.parse(await new Response(r.stream).text());
}
