import test from 'node:test';
import assert from 'node:assert/strict';

import smartrecruiters from '../providers/smartrecruiters.mjs';

test('detects a jobs.smartrecruiters.com careers_url and derives the API URL', () => {
  const hit = smartrecruiters.detect({ careers_url: 'https://jobs.smartrecruiters.com/CoffmanEngineersInc' });
  assert.ok(hit);
  assert.equal(hit.url, 'https://api.smartrecruiters.com/v1/companies/CoffmanEngineersInc/postings');
});

test('detect() returns null for unrelated hosts', () => {
  assert.equal(smartrecruiters.detect({ careers_url: 'https://example.com/careers' }), null);
  assert.equal(smartrecruiters.detect({}), null);
});

test('fetch() paginates and normalizes postings into {title,url,company,location,postedAt}', async () => {
  const pages = [
    {
      totalFound: 2,
      content: [
        {
          id: '1',
          name: 'Software Engineer',
          location: { city: 'San Diego', region: 'CA', country: 'us', remote: false },
          releasedDate: '2026-10-12T21:28:14.614Z',
        },
      ],
    },
    {
      totalFound: 2,
      content: [
        {
          id: '2',
          name: 'Backend Engineer',
          location: { city: '', region: '', country: '', remote: true },
          releasedDate: '2026-10-11T10:00:00.000Z',
        },
      ],
    },
  ];
  let call = 0;
  const ctx = {
    async fetchJson(url) {
      assert.match(url, /limit=100/);
      return pages[call++];
    },
  };

  const jobs = await smartrecruiters.fetch({ name: 'Coffman Engineers', careers_url: 'https://jobs.smartrecruiters.com/CoffmanEngineersInc' }, ctx);

  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].title, 'Software Engineer');
  assert.equal(jobs[0].url, 'https://jobs.smartrecruiters.com/CoffmanEngineersInc/1');
  assert.equal(jobs[0].company, 'Coffman Engineers');
  assert.equal(jobs[0].location, 'San Diego, CA, United States');
  assert.equal(jobs[0].postedAt, Date.parse('2026-10-12T21:28:14.614Z'));
  assert.equal(jobs[1].location, 'Remote');
});

test('fetch() stops paginating once every posting has been returned', async () => {
  let calls = 0;
  const ctx = {
    async fetchJson() {
      calls++;
      return { totalFound: 1, content: [{ id: '1', name: 'Only Job', location: {}, releasedDate: '' }] };
    },
  };
  const jobs = await smartrecruiters.fetch({ name: 'X', careers_url: 'https://jobs.smartrecruiters.com/x' }, ctx);
  assert.equal(jobs.length, 1);
  assert.equal(calls, 1);
});

test('fetch() throws clearly when the entry has no derivable API URL', async () => {
  await assert.rejects(
    () => smartrecruiters.fetch({ name: 'Bad', careers_url: 'https://example.com/jobs' }, { fetchJson: async () => ({}) }),
    /smartrecruiters/,
  );
});
