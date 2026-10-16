import test from 'node:test';
import assert from 'node:assert/strict';

import bamboohr from '../providers/bamboohr.mjs';

test('detects a *.bamboohr.com careers_url and derives the list API URL', () => {
  const hit = bamboohr.detect({ careers_url: 'https://vandenrecycling.bamboohr.com/careers' });
  assert.ok(hit);
  assert.equal(hit.url, 'https://vandenrecycling.bamboohr.com/careers/list');
});

test('detect() returns null for non-bamboohr hosts', () => {
  assert.equal(bamboohr.detect({ careers_url: 'https://example.com/careers' }), null);
  assert.equal(bamboohr.detect({}), null);
});

test('fetch() normalizes postings into {title,url,company,location}, undated', async () => {
  const ctx = {
    async fetchJson(url) {
      assert.equal(url, 'https://vandenrecycling.bamboohr.com/careers/list');
      return {
        meta: { totalCount: 2 },
        result: [
          {
            id: '193',
            jobOpeningName: 'Business Development Manager',
            location: { city: null, state: null },
            atsLocation: { country: 'United Kingdom', state: null, province: null, city: null },
            isRemote: null,
          },
          {
            id: '200',
            jobOpeningName: 'Logistics Manager',
            location: { city: 'Kowloon', state: 'Kowloon' },
            atsLocation: { country: null, state: null, province: null, city: null },
            isRemote: null,
          },
        ],
      };
    },
  };

  const jobs = await bamboohr.fetch({ name: 'Vanden Recycling', careers_url: 'https://vandenrecycling.bamboohr.com/careers' }, ctx);

  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].title, 'Business Development Manager');
  assert.equal(jobs[0].url, 'https://vandenrecycling.bamboohr.com/careers/193');
  assert.equal(jobs[0].company, 'Vanden Recycling');
  assert.equal(jobs[0].location, 'United Kingdom');
  assert.equal(jobs[0].postedAt, undefined);
  assert.equal(jobs[1].location, 'Kowloon, Kowloon');
});

test('fetch() marks a remote posting as Remote', async () => {
  const ctx = {
    async fetchJson() {
      return {
        meta: { totalCount: 1 },
        result: [{ id: '1', jobOpeningName: 'Remote Engineer', location: {}, atsLocation: {}, isRemote: true }],
      };
    },
  };
  const jobs = await bamboohr.fetch({ name: 'X', careers_url: 'https://x.bamboohr.com/careers' }, ctx);
  assert.equal(jobs[0].location, 'Remote');
});

test('fetch() throws clearly when the entry has no derivable subdomain', async () => {
  await assert.rejects(
    () => bamboohr.fetch({ name: 'Bad', careers_url: 'https://example.com/careers' }, { fetchJson: async () => ({}) }),
    /bamboohr/,
  );
});
