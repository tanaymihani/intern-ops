import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeDiscoveredJobs } from '../lib/feed-discovery.mjs';

const keyOf = (job) => String(job.url || '').split('?')[0].toLowerCase();
const NOW = '2026-10-13T15:00:00.000Z';

test('a job discovered in a later scrape keeps its old employer date but gets a new discovery time', () => {
  const jobs = mergeDiscoveredJobs([], [{
    url: 'https://jobs.example.com/suno/123',
    company: 'Suno',
    title: 'Software Engineer',
    postedAt: Date.parse('2026-10-12T12:00:00Z'),
  }], { keyOf, now: NOW, keepHours: 72 });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].postedAt, Date.parse('2026-10-12T12:00:00Z'));
  assert.equal(jobs[0].discoveredAt, NOW);
  assert.equal(jobs[0].lastSeenAt, NOW);
});

test('a repeated scrape updates lastSeenAt without resetting discoveredAt', () => {
  const previous = [{
    url: 'https://jobs.example.com/suno/123',
    company: 'Suno',
    title: 'Software Engineer',
    postedAt: Date.parse('2026-10-12T12:00:00Z'),
    discoveredAt: '2026-10-13T14:00:00.000Z',
    lastSeenAt: '2026-10-13T14:00:00.000Z',
  }];

  const jobs = mergeDiscoveredJobs(previous, [{
    ...previous[0],
    summary: 'Updated description',
  }], { keyOf, now: NOW, keepHours: 72 });

  assert.equal(jobs[0].discoveredAt, '2026-10-13T14:00:00.000Z');
  assert.equal(jobs[0].lastSeenAt, NOW);
  assert.equal(jobs[0].summary, 'Updated description');
});

test('tracking parameters do not create a second discovery event', () => {
  const previous = [{
    url: 'https://jobs.example.com/suno/123?source=hiringcafe',
    title: 'Software Engineer',
    postedAt: Date.parse('2026-10-12T12:00:00Z'),
    discoveredAt: '2026-10-13T14:00:00.000Z',
  }];
  const incoming = [{
    url: 'https://jobs.example.com/suno/123?utm_source=nextplay',
    title: 'Software Engineer',
    postedAt: Date.parse('2026-10-12T12:00:00Z'),
  }];

  const jobs = mergeDiscoveredJobs(previous, incoming, { keyOf, now: NOW, keepHours: 72 });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].discoveredAt, '2026-10-13T14:00:00.000Z');
});

test('an old employer posting seen again does not reset its discovery time', () => {
  const previous = [{
    url: 'https://jobs.example.com/old-but-open/1',
    title: 'Software Engineer',
    postedAt: Date.parse('2026-10-08T12:00:00Z'),
    discoveredAt: '2026-10-09T14:00:00.000Z',
    lastSeenAt: '2026-10-12T14:00:00.000Z',
  }];
  const incoming = [{ ...previous[0] }];

  const jobs = mergeDiscoveredJobs(previous, incoming, { keyOf, now: NOW, keepHours: 72 });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].discoveredAt, '2026-10-09T14:00:00.000Z');
  assert.equal(jobs[0].lastSeenAt, NOW);
});

test('legacy snapshot rows inherit the snapshot fetchedAt instead of becoming new today', () => {
  const jobs = mergeDiscoveredJobs([{
    url: 'https://jobs.example.com/existing/1',
    title: 'Backend Engineer',
    postedAt: Date.parse('2026-10-12T10:00:00Z'),
  }], [], {
    keyOf,
    now: NOW,
    keepHours: 72,
    legacyDiscoveredAt: '2026-10-13T09:00:00.000Z',
  });

  assert.equal(jobs[0].discoveredAt, '2026-10-13T09:00:00.000Z');
  assert.equal(jobs[0].lastSeenAt, '2026-10-13T09:00:00.000Z');
});
