// GET  /api/state → { marks }      your applied / hidden / opened marks
// POST /api/state { patches }      merge changes (null clears a field)
//
// Stored as one private Vercel Blob (only this server can read it; no public
// URL). Writes are conditional on the ETag we just read, so two devices
// saving at once retry instead of overwriting each other. Behind the
// password gate like every other route (middleware.js).
import { get, put, BlobPreconditionFailedError } from '@vercel/blob';

const PATH = 'state/marks.json';
const FIELDS = ['viewedAt', 'appliedAt', 'hiddenAt', 'hideReason', 'url', 'title', 'company'];
const MARKS = ['viewedAt', 'appliedAt', 'hiddenAt'];

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
});

export function syncConfigured(env = process.env) {
  return Boolean(env.BLOB_READ_WRITE_TOKEN);
}

async function load() {
  const r = await get(PATH, { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200 || !r.stream) return { marks: {}, etag: null };
  const doc = JSON.parse(await new Response(r.stream).text() || '{}');
  return { marks: doc.marks && typeof doc.marks === 'object' ? doc.marks : {}, etag: r.blob.etag };
}

export function applyPatches(marks, patches, now = new Date().toISOString()) {
  const next = { ...marks };
  for (const [key, patch] of Object.entries(patches || {})) {
    if (typeof key !== 'string' || !key || key.length > 400 || !patch || typeof patch !== 'object') continue;
    const entry = { ...(next[key] || {}) };
    for (const f of FIELDS) {
      if (!(f in patch)) continue;
      if (patch[f] == null || patch[f] === '') delete entry[f];
      else entry[f] = String(patch[f]).slice(0, 600);
    }
    if (MARKS.some((m) => entry[m])) next[key] = { ...entry, updatedAt: now };
    else delete next[key];
  }
  return next;
}

export async function GET() {
  if (!syncConfigured()) return json(501, { error: 'sync not configured' });
  try {
    return json(200, { marks: (await load()).marks });
  } catch (err) {
    return json(502, { error: String(err.message || err) });
  }
}

export async function POST(request) {
  if (!syncConfigured()) return json(501, { error: 'sync not configured' });
  const body = await request.json().catch(() => null);
  const patches = body?.patches;
  if (!patches || typeof patches !== 'object' || Object.keys(patches).length > 1000) return json(400, { error: 'bad patches' });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const { marks, etag } = await load();
      const next = applyPatches(marks, patches);
      await put(PATH, JSON.stringify({ v: 1, marks: next }), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
        cacheControlMaxAge: 60,
        ...(etag ? { ifMatch: etag } : {}),
      });
      return json(200, { marks: next });
    } catch (err) {
      if (err instanceof BlobPreconditionFailedError && attempt < 3) continue; // another device saved first — re-read and retry
      return json(502, { error: String(err.message || err) });
    }
  }
  return json(409, { error: 'busy — try again' });
}
