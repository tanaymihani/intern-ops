/**
 * doc-store.mjs — the site's small private JSON files (synced marks, saved
 * logins, email lookups), kept in a private GitHub repo through the Contents
 * API. Free with no monthly quota (5,000 calls/hour per token); Vercel Blob's
 * Hobby allowance ran out in two days. Every write is a commit, conditional
 * on the file's current sha, so two devices saving at once retry instead of
 * overwriting each other.
 *
 *   STATE_REPO   owner/name of a private repo, e.g. tanaymihani/intern-ops-state
 *   STATE_TOKEN  fine-grained token for that repo only: Contents read & write
 */
const API = 'https://api.github.com';
// Same bot identity as the data commits, so these never count as your own activity.
const COMMITTER = { name: 'intern-ops-site', email: 'actions@users.noreply.github.com' };

export class VersionConflict extends Error {}
export class StoreError extends Error {}

export const storeConfigured = (env = process.env) => Boolean(env.STATE_REPO && env.STATE_TOKEN);

// Last read of each path, for conditional GETs (a 304 doesn't count against the rate limit).
const memo = new Map();

function request(path, { method = 'GET', headers = {}, body } = {}) {
  const segments = path.split('/').map(encodeURIComponent).join('/');
  return fetch(`${API}/repos/${process.env.STATE_REPO}/contents/${segments}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.STATE_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'intern-ops-site',
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
}

function storeError(status, message) {
  if (status === 401) return new StoreError('GitHub rejected STATE_TOKEN (expired or revoked) — make a new one.');
  if (status === 403 || status === 429) return new StoreError(`GitHub refused the request (${message || 'rate limit'}).`);
  return new StoreError(`GitHub ${status}${message ? `: ${message}` : ''}`);
}

/** { data, version } — version is the file's sha, null while the file doesn't exist. */
export async function readDoc(path) {
  const prev = memo.get(path);
  const res = await request(path, { headers: prev ? { 'if-none-match': prev.etag } : {} });
  if (res.status === 304 && prev) return { data: prev.data, version: prev.version };
  if (res.status === 404) {
    memo.delete(path);
    return { data: null, version: null };
  }
  if (!res.ok) throw storeError(res.status, (await res.json().catch(() => ({}))).message);
  const meta = await res.json();
  let text = meta.encoding === 'base64' ? Buffer.from(meta.content || '', 'base64').toString('utf8') : null;
  if (text === null) { // over 1 MB the JSON response leaves the content out
    const raw = await request(path, { headers: { accept: 'application/vnd.github.raw+json' } });
    if (!raw.ok) throw storeError(raw.status, '');
    text = await raw.text();
  }
  const doc = { data: JSON.parse(text || 'null'), version: meta.sha };
  const etag = res.headers.get('etag');
  if (etag) memo.set(path, { etag, ...doc });
  return doc;
}

/**
 * Write a JSON doc. Passing `version` (from readDoc; null = must not exist
 * yet) makes it conditional: VersionConflict if someone else wrote first.
 * Leave it out to overwrite whatever is there.
 */
export async function writeDoc(path, data, { version, message = `update ${path}` } = {}) {
  const conditional = version !== undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const sha = conditional ? version : (await readDoc(path)).version;
    const res = await request(path, {
      method: 'PUT',
      body: {
        message,
        content: Buffer.from(JSON.stringify(data)).toString('base64'),
        committer: COMMITTER,
        ...(sha ? { sha } : {}),
      },
    });
    memo.delete(path);
    if (res.ok) return (await res.json()).content?.sha || null;
    const detail = (await res.json().catch(() => ({}))).message || '';
    // 409: our sha is stale. 422 about the sha: the file exists but we sent none.
    if (res.status === 409 || (res.status === 422 && /sha/i.test(detail))) {
      if (conditional) throw new VersionConflict(path);
      continue;
    }
    throw storeError(res.status, detail);
  }
  throw new VersionConflict(path);
}
