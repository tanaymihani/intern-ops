// GET  /api/state → { marks }      your applied / hidden / opened marks
// POST /api/state { patches }      merge changes (null clears a field)
//
// Stored as one file in the private state repo (lib/doc-store.mjs). Writes
// are conditional on the version we just read, so two devices saving at once
// retry instead of overwriting each other. Behind the password gate like
// every other route (middleware.js).
import { readDoc, writeDoc, storeConfigured, VersionConflict } from '../lib/doc-store.mjs';

const PATH = 'state/marks.json';
const FIELDS = ['viewedAt', 'appliedAt', 'hiddenAt', 'hideReason', 'url', 'title', 'company'];
const MARKS = ['viewedAt', 'appliedAt', 'hiddenAt'];

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
});

async function load() {
  const { data, version } = await readDoc(PATH);
  return { marks: data?.marks && typeof data.marks === 'object' ? data.marks : {}, version };
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
  if (!storeConfigured()) return json(501, { error: 'sync not configured' });
  try {
    return json(200, { marks: (await load()).marks });
  } catch (err) {
    return json(502, { error: String(err.message || err) });
  }
}

export async function POST(request) {
  if (!storeConfigured()) return json(501, { error: 'sync not configured' });
  const body = await request.json().catch(() => null);
  const patches = body?.patches;
  if (!patches || typeof patches !== 'object' || Object.keys(patches).length > 1000) return json(400, { error: 'bad patches' });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const { marks, version } = await load();
      const next = applyPatches(marks, patches);
      await writeDoc(PATH, { v: 1, marks: next }, { version, message: 'marks' });
      return json(200, { marks: next });
    } catch (err) {
      if (err instanceof VersionConflict && attempt < 3) continue; // another device saved first — re-read and retry
      return json(502, { error: String(err.message || err) });
    }
  }
  return json(409, { error: 'busy — try again' });
}
