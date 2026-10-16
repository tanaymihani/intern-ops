import test from 'node:test';
import assert from 'node:assert/strict';

import recruitee from '../providers/recruitee.mjs';

test('detects a *.recruitee.com subdomain careers_url', () => {
  const hit = recruitee.detect({ careers_url: 'https://gravity9.recruitee.com' });
  assert.ok(hit);
  assert.equal(hit.url, 'https://gravity9.recruitee.com/api/offers/');
});

test('detect() returns null for non-recruitee hosts and bare subdomain names', () => {
  assert.equal(recruitee.detect({ careers_url: 'https://example.com/careers' }), null);
  assert.equal(recruitee.detect({ careers_url: 'https://www.recruitee.com' }), null);
  assert.equal(recruitee.detect({}), null);
});

test('fetch() normalizes offers into {title,url,company,location,postedAt}', async () => {
  const ctx = {
    async fetchJson(url) {
      assert.equal(url, 'https://gravity9.recruitee.com/api/offers/');
      return {
        offers: [
          {
            id: 1,
            title: 'Senior Backend Engineer',
            careers_url: 'https://gravity9.recruitee.com/o/senior-backend-engineer',
            city: 'London',
            country: 'United Kingdom',
            remote: false,
            created_at: '2026-09-01T12:00:00.000Z',
          },
          {
            id: 2,
            title: 'Remote Frontend Engineer',
            careers_url: 'https://gravity9.recruitee.com/o/remote-frontend-engineer',
            city: '',
            country: '',
            remote: true,
            created_at: '2026-09-02T12:00:00.000Z',
          },
        ],
      };
    },
  };

  const jobs = await recruitee.fetch({ name: 'gravity9', careers_url: 'https://gravity9.recruitee.com' }, ctx);

  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].title, 'Senior Backend Engineer');
  assert.equal(jobs[0].url, 'https://gravity9.recruitee.com/o/senior-backend-engineer');
  assert.equal(jobs[0].company, 'gravity9');
  assert.equal(jobs[0].location, 'London, United Kingdom');
  assert.equal(jobs[0].postedAt, Date.parse('2026-09-01T12:00:00.000Z'));
  assert.equal(jobs[1].location, 'Remote');
});

test('fetch() throws clearly when no subdomain can be derived', async () => {
  await assert.rejects(
    () => recruitee.fetch({ name: 'Bad', careers_url: 'https://example.com/careers' }, { fetchJson: async () => ({}) }),
    /recruitee/,
  );
});
