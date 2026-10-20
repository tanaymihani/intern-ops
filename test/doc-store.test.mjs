import test from 'node:test';
import assert from 'node:assert/strict';

process.env.STATE_REPO = 'me/state';
process.env.STATE_TOKEN = 'test-token';

// In-memory stand-in for GitHub's Contents API: sha-checked writes, ETags, 304s.
const files = new Map(); // path → { text, sha }
let shaSeq = 0;
let beforePut = null; // hook to simulate another device writing first
const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const path = decodeURIComponent(new URL(url).pathname.replace('/repos/me/state/contents/', ''));
  const method = opts.method || 'GET';
  calls.push({ method, path, headers: opts.headers });
  if (opts.headers.authorization !== 'Bearer test-token') return Response.json({ message: 'Bad credentials' }, { status: 401 });
  const file = files.get(path);
  if (method === 'GET') {
    if (!file) return Response.json({ message: 'Not Found' }, { status: 404 });
    const etag = `"etag-${file.sha}"`;
    if (opts.headers['if-none-match'] === etag) return new Response(null, { status: 304 });
    return Response.json({ sha: file.sha, encoding: 'base64', content: Buffer.from(file.text).toString('base64') }, { headers: { etag } });
  }
  if (beforePut) { const hook = beforePut; beforePut = null; hook(path); }
  const body = JSON.parse(opts.body);
  const current = files.get(path);
  if (current && !body.sha) return Response.json({ message: 'Invalid request.\n\n"sha" wasn\'t supplied.' }, { status: 422 });
  if (current && body.sha !== current.sha) return Response.json({ message: `${path} does not match ${body.sha}` }, { status: 409 });
  const sha = `sha${++shaSeq}`;
  files.set(path, { text: Buffer.from(body.content, 'base64').toString('utf8'), sha });
  return Response.json({ content: { sha } }, { status: current ? 200 : 201 });
};

const { readDoc, writeDoc, VersionConflict, StoreError } = await import('../lib/doc-store.mjs');
const state = await import('../api/state.js');

test('read a missing doc, create it, read it back', async () => {
  assert.deepEqual(await readDoc('a.json'), { data: null, version: null });
  const sha = await writeDoc('a.json', { n: 1 }, { version: null });
  assert.deepEqual(await readDoc('a.json'), { data: { n: 1 }, version: sha });
});

test('conditional writes fail on a stale or missing version; plain writes overwrite', async () => {
  const v1 = await writeDoc('b.json', { n: 1 }, { version: null });
  await writeDoc('b.json', { n: 2 }, { version: v1 });
  await assert.rejects(writeDoc('b.json', { n: 3 }, { version: v1 }), VersionConflict); // v1 is stale now
  await assert.rejects(writeDoc('b.json', { n: 3 }, { version: null }), VersionConflict); // "must not exist"
  await writeDoc('b.json', { n: 4 }); // no version: overwrite whatever is there
  assert.deepEqual((await readDoc('b.json')).data, { n: 4 });
});

test('an unchanged doc is re-read with If-None-Match and served from the 304', async () => {
  await writeDoc('c.json', { n: 1 });
  await readDoc('c.json');
  calls.length = 0;
  assert.deepEqual((await readDoc('c.json')).data, { n: 1 });
  assert.match(calls[0].headers['if-none-match'], /^"etag-/);
});

test('a rejected token surfaces as a StoreError that says what to fix', async () => {
  process.env.STATE_TOKEN = 'expired';
  await assert.rejects(readDoc('a.json'), (err) => err instanceof StoreError && /STATE_TOKEN/.test(err.message));
  process.env.STATE_TOKEN = 'test-token';
});

test('/api/state merges marks and retries when another device saved first', async () => {
  const post = (patches) => state.POST(new Request('http://x/api/state', { method: 'POST', body: JSON.stringify({ patches }) }));
  assert.equal((await post({ job1: { appliedAt: '2026-10-20T10:00:00Z', url: 'https://a' } })).status, 200);
  // Another device writes between our read and our write → 409 → re-read and retry.
  beforePut = (path) => {
    const doc = JSON.parse(files.get(path).text);
    doc.marks.job2 = { hiddenAt: '2026-10-20T10:01:00Z' };
    files.set(path, { text: JSON.stringify(doc), sha: `sha${++shaSeq}` });
  };
  assert.equal((await post({ job3: { viewedAt: '2026-10-20T10:02:00Z' } })).status, 200);
  const { marks } = await (await state.GET()).json();
  assert.deepEqual(Object.keys(marks).sort(), ['job1', 'job2', 'job3']);
});
