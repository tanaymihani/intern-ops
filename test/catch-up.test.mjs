import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catchUpSince, readLastOk } from '../lib/catch-up.mjs';
import workday from '../providers/workday.mjs';

const H = 3_600_000;
const NOW = Date.parse('2026-10-19T02:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

test('catchUpSince keeps the configured window while runs are on time', () => {
  assert.equal(catchUpSince('2', ago(0.25 * H), NOW), 2);
  assert.equal(catchUpSince('4', ago(H), NOW), 4);
  assert.equal(catchUpSince('7', ago(24 * H), NOW), 7);
  assert.equal(catchUpSince('2', null, NOW), 2); // never completed → configured
  assert.equal(catchUpSince('abc', null, NOW), 1);
});

test('catchUpSince reaches back past missed runs, with a day of margin, capped at 45', () => {
  // The real gap that prompted this: tracked boards last ran 2.8 days earlier.
  assert.equal(catchUpSince('2', ago(67 * H), NOW), 4);
  assert.equal(catchUpSince('1', ago(0.25 * H), NOW), 2);
  assert.equal(catchUpSince('1', ago(30 * 24 * H), NOW), 31);
  assert.equal(catchUpSince('1', ago(200 * 24 * H), NOW), 45);
  assert.equal(catchUpSince('60', ago(200 * 24 * H), NOW), 60); // an explicit wider backfill wins
});

test('readLastOk: lastOkAt, else a clean complete run, else null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'catch-up-'));
  const hb = (name, body) => {
    const f = join(dir, name);
    writeFileSync(f, JSON.stringify(body));
    return f;
  };
  assert.equal(readLastOk(hb('a.json', { at: '2026-10-19T01:00:00Z', exitCode: 1, lastOkAt: '2026-10-18T01:00:00Z' })), '2026-10-18T01:00:00Z');
  assert.equal(readLastOk(hb('b.json', { at: '2026-10-19T01:00:00Z', exitCode: 0 })), '2026-10-19T01:00:00Z'); // pre-lastOkAt heartbeat
  assert.equal(readLastOk(hb('c.json', { at: '2026-10-19T01:00:00Z', exitCode: 0, incomplete: true })), null);
  assert.equal(readLastOk(hb('d.json', { at: '2026-10-19T01:00:00Z', exitCode: 2 })), null);
  assert.equal(readLastOk(join(dir, 'missing.json')), null);
});

test('workday: "a|b" runs one search per term and merges by URL', async () => {
  const bodies = [];
  const results = {
    internship: [{ title: 'ML Internship', externalPath: '/job/Boston/ML-Internship_R1', postedOn: 'Posted Today' }],
    intern: [
      { title: 'ML Internship', externalPath: '/job/Boston/ML-Internship_R1', postedOn: 'Posted Today' },
      { title: 'Quant Research Intern', externalPath: '/job/NYC/Quant-Intern_R2', postedOn: 'Posted 3 Days Ago' },
    ],
  };
  const ctx = {
    sinceMs: NOW - 45 * 24 * H,
    sleep: async () => {},
    fetchJson: async (_url, opts) => {
      const body = JSON.parse(opts.body);
      bodies.push(body);
      const postings = results[body.searchText] || [];
      return { total: postings.length, jobPostings: postings };
    },
  };
  const entry = { name: 'Acme', careers_url: 'https://acme.wd1.myworkdayjobs.com/External', search_text: 'internship | intern' };
  const jobs = await workday.fetch(entry, ctx);
  assert.deepEqual(bodies.map((b) => b.searchText), ['internship', 'intern']);
  assert.deepEqual(jobs.map((j) => j.title), ['ML Internship', 'Quant Research Intern']);
  assert.ok(jobs.every((j) => j.url.startsWith('https://acme.wd1.myworkdayjobs.com/')));
});
