import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractOfficialBoardCandidate,
  buildOfficialBoardRegistry,
} from '../lib/official-board-registry.mjs';

test('extracts only allowlisted official ATS hosts', () => {
  assert.deepEqual(
    extractOfficialBoardCandidate('https://job-boards.greenhouse.io/acme/jobs/1234567?gh_src=x'),
    { key: 'greenhouse:acme', ats: 'greenhouse', slug: 'acme', boardUrl: 'https://job-boards.greenhouse.io/acme' },
  );
  assert.deepEqual(
    extractOfficialBoardCandidate('https://jobs.ashbyhq.com/ElevenLabs/11111111-1111-1111-1111-111111111111/application'),
    { key: 'ashby:elevenlabs', ats: 'ashby', slug: 'ElevenLabs', boardUrl: 'https://jobs.ashbyhq.com/ElevenLabs' },
  );
  assert.deepEqual(
    extractOfficialBoardCandidate('https://jobs.lever.co/acme/abc/apply?source=x'),
    { key: 'lever:acme', ats: 'lever', slug: 'acme', boardUrl: 'https://jobs.lever.co/acme' },
  );
  assert.deepEqual(
    extractOfficialBoardCandidate('https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Test/R-123'),
    { key: 'workday:acme.wd5.myworkdayjobs.com/careers', ats: 'workday', slug: 'Careers', boardUrl: 'https://acme.wd5.myworkdayjobs.com/Careers' },
  );
});

test('rejects generic jobs paths, branded gh_jid pages, and non-allowlisted hosts', () => {
  for (const url of [
    'https://jobs.uber.com/en/jobs/123/software-engineer',
    'https://americanusa.applicantpool.com/jobs/1334996',
    'https://ats.rippling.com/acme/jobs/11111111-1111-1111-1111-111111111111',
    'https://www.asm.com/open-vacancies/test?gh_jid=4966075101',
    'https://example.com/jobs/123?token=999999',
  ]) {
    assert.equal(extractOfficialBoardCandidate(url), null, url);
  }
});

test('boardUrl stays a valid, fetchable URL for a slug containing spaces', () => {
  const candidate = extractOfficialBoardCandidate('https://jobs.ashbyhq.com/8090%20Solutions%20Inc/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  assert.equal(candidate.slug, '8090 Solutions Inc');
  assert.equal(candidate.boardUrl, 'https://jobs.ashbyhq.com/8090%20Solutions%20Inc');
  assert.doesNotThrow(() => new URL(candidate.boardUrl));
  assert.equal(candidate.boardUrl.includes(' '), false);
});

test('registry merges provenance and preserves first seen and manual review state', () => {
  const previous = {
    boards: [{
      key: 'ashby:acme', ats: 'ashby', slug: 'acme', boardUrl: 'https://jobs.ashbyhq.com/acme',
      companyClaims: ['Acme'], sources: [], firstSeenAt: '2026-10-10T10:00:00.000Z',
      lastSeenAt: '2026-10-10T10:00:00.000Z', state: 'accepted',
      verification: { status: 'verified', checkedAt: '2026-10-11T10:00:00.000Z' },
    }],
  };
  const feeds = [
    { source: 'hiringcafe', fetchedAt: '2026-10-13T10:00:00.000Z', jobs: [{ company: 'Acme, Inc.', url: 'https://jobs.ashbyhq.com/acme/one', discoveredAt: '2026-10-12T10:00:00.000Z' }] },
    { source: 'nextplay', fetchedAt: '2026-10-13T11:00:00.000Z', jobs: [{ company: 'Acme', url: 'https://jobs.ashbyhq.com/acme/two', discoveredAt: '2026-10-13T09:00:00.000Z' }] },
  ];

  const registry = buildOfficialBoardRegistry({ feeds, previous, trackedKeys: new Set(['ashby:acme']), now: '2026-10-13T12:00:00.000Z' });
  assert.equal(registry.boards.length, 1);
  const board = registry.boards[0];
  assert.equal(board.firstSeenAt, '2026-10-10T10:00:00.000Z');
  assert.equal(board.lastSeenAt, '2026-10-13T11:00:00.000Z');
  assert.equal(board.state, 'accepted');
  assert.equal(board.verification.status, 'verified');
  assert.equal(board.alreadyTracked, true);
  assert.deepEqual(board.companyClaims, ['Acme', 'Acme, Inc.']);
  assert.deepEqual(board.sources.map((s) => s.source), ['hiringcafe', 'nextplay']);
});

test('registry output is unique and deterministic', () => {
  const registry = buildOfficialBoardRegistry({
    feeds: [{ source: 'nextplay', fetchedAt: '2026-10-13T11:00:00.000Z', jobs: [
      { company: 'Zed', url: 'https://jobs.lever.co/zed/1' },
      { company: 'Acme', url: 'https://job-boards.greenhouse.io/acme/jobs/1234567' },
      { company: 'Acme', url: 'https://job-boards.greenhouse.io/acme/jobs/7654321?utm_source=x' },
    ] }],
    previous: {}, trackedKeys: new Set(), now: '2026-10-13T12:00:00.000Z',
  });

  assert.deepEqual(registry.boards.map((b) => b.key), ['greenhouse:acme', 'lever:zed']);
  assert.equal(new Set(registry.boards.map((b) => b.key)).size, registry.boards.length);
});
