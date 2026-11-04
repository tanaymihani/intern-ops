import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { trimPortalHealth } from '../lib/portal-health-trim.mjs';

// Node 18 has no global Web Crypto in ES modules (Vercel's Node 22 does).
if (!globalThis.crypto) globalThis.crypto = webcrypto;

test('portal health keeps only the newest runs, in order', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'health-')), 'portal-health.tsv');
  const rows = [];
  for (let run = 1; run <= 13; run++) for (const c of ['Acme', 'Globex']) rows.push(`2026-11-04T00:${String(run).padStart(2, '0')}:00Z\t${c}\treachable`);
  writeFileSync(file, `timestamp\tcompany\tstatus\n${rows.join('\n')}\n`);
  trimPortalHealth(file, 10);
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines[0], 'timestamp\tcompany\tstatus');
  assert.equal(lines.length, 1 + 10 * 2);
  assert.ok(lines[1].startsWith('2026-11-04T00:04:00Z'));
  assert.ok(lines.at(-1).startsWith('2026-11-04T00:13:00Z\tGlobex'));
  const before = readFileSync(file, 'utf8');
  trimPortalHealth(file, 10); // already within the limit: untouched
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('/api/jobs answers a repeat poll with a bodiless 304', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'data-'));
  writeFileSync(join(dir, 'lists-feed.json'), JSON.stringify({
    jobs: [{ url: 'https://acme.example/jobs/1', title: 'Machine Learning Intern', company: 'Acme', location: 'Boston, MA', postedAt: '2026-11-01' }],
  }));
  process.env.DATA_DIR = dir;
  const { GET } = await import('../api/jobs.js');
  const first = await GET(new Request('http://x/api/jobs?track=all'));
  assert.equal(first.status, 200);
  assert.equal((await first.json()).length, 1);
  const etag = first.headers.get('etag');
  assert.match(etag, /^"[\w-]+"$/);
  for (const sent of [etag, `W/${etag}`, `"other", ${etag}`]) {
    const again = await GET(new Request('http://x/api/jobs?track=all', { headers: { 'if-none-match': sent } }));
    assert.equal(again.status, 304, sent);
    assert.equal(await again.text(), '');
  }
});
