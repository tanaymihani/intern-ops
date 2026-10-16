import test from 'node:test';
import assert from 'node:assert/strict';

import workable from '../providers/workable.mjs';

test('detects an apply.workable.com account careers_url', () => {
  const hit = workable.detect({ careers_url: 'https://apply.workable.com/brightplan' });
  assert.ok(hit);
  assert.equal(hit.url, 'https://apply.workable.com/api/v1/widget/accounts/brightplan?details=true');
});

test('detect() returns null without a resolvable account slug', () => {
  assert.equal(workable.detect({ careers_url: 'https://jobs.workable.com' }), null);
  assert.equal(workable.detect({ careers_url: 'https://example.com/careers' }), null);
  assert.equal(workable.detect({}), null);
});

test('fetch() normalizes jobs into {title,url,company,location,postedAt}', async () => {
  const ctx = {
    async fetchJson(url) {
      assert.equal(url, 'https://apply.workable.com/api/v1/widget/accounts/brightplan?details=true');
      return {
        name: 'Brightplan',
        jobs: [
          {
            title: 'Applied AI Engineer (Python/AI)',
            shortcode: 'DC6C229CA6',
            url: 'https://apply.workable.com/j/DC6C229CA6',
            published_on: '2026-08-07',
            country: 'United States',
            city: '',
            state: '',
            telecommuting: true,
          },
        ],
      };
    },
  };

  const jobs = await workable.fetch({ name: 'BrightPlan', careers_url: 'https://apply.workable.com/brightplan' }, ctx);

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Applied AI Engineer (Python/AI)');
  assert.equal(jobs[0].url, 'https://apply.workable.com/j/DC6C229CA6');
  assert.equal(jobs[0].company, 'BrightPlan');
  assert.equal(jobs[0].location, 'Remote · United States');
  assert.equal(jobs[0].postedAt, Date.parse('2026-08-07'));
});

test('fetch() formats a non-remote location from city/state/country', async () => {
  const ctx = {
    async fetchJson() {
      return { jobs: [{ title: 'Eng', shortcode: 'X', url: 'https://apply.workable.com/j/X', city: 'Austin', state: 'TX', country: 'United States', telecommuting: false }] };
    },
  };
  const jobs = await workable.fetch({ name: 'X', careers_url: 'https://apply.workable.com/x' }, ctx);
  assert.equal(jobs[0].location, 'Austin, TX, United States');
});

test('fetch() throws clearly when no account slug can be derived', async () => {
  await assert.rejects(
    () => workable.fetch({ name: 'Bad', careers_url: 'https://example.com/careers' }, { fetchJson: async () => ({}) }),
    /workable/,
  );
});
