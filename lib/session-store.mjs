/**
 * session-store.mjs — login sessions (Handshake, JobRight) pasted on the
 * site's Refresh page, kept in the private state repo (lib/doc-store.mjs),
 * encrypted with FEED_KEY. Read back by GitHub Actions through /api/session.
 */
import { readDoc, writeDoc } from './doc-store.mjs';
import { encryptJson } from './feed-crypto.mjs';

export const SESSION_SOURCES = {
  handshake: { host: /(^|\.)joinhandshake\.com$/, mustHave: /\b(hss-global|_trajectory_session)=/ },
  jobright: { host: /(^|\.)jobright\.ai$/, mustHave: /=/ },
};

const pathFor = (source) => `secrets/${source}-session.json`;

export async function saveSession(source, { cookie, host }) {
  const envelope = encryptJson({ source, cookie, host, savedAt: new Date().toISOString() });
  await writeDoc(pathFor(source), envelope, { message: `save ${source} login` });
}

/** The stored envelope, still encrypted — or null. */
export async function loadSessionEnvelope(source) {
  return (await readDoc(pathFor(source))).data;
}
