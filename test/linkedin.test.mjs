import test from 'node:test';
import assert from 'node:assert/strict';
import { postedFromCard, parseCards } from '../fetch-linkedin-feed.mjs';

const NOW = Date.parse('2026-10-19T02:00:00Z');

test('LinkedIn relative times become exact timestamps', () => {
  assert.equal(postedFromCard('14 hours ago', '2026-10-18', NOW), '2026-10-18T12:00:00.000Z');
  assert.equal(postedFromCard('35 minutes ago', '2026-10-19', NOW), '2026-10-19T01:25:00.000Z');
  assert.equal(postedFromCard('1 hour ago', '2026-10-19', NOW), '2026-10-19T01:00:00.000Z');
  assert.equal(postedFromCard('3 days ago', '2026-10-16', NOW), '2026-10-16'); // days: keep LinkedIn's date
  assert.equal(postedFromCard('', '2026-10-16', NOW), '2026-10-16');
  assert.equal(postedFromCard('', '', NOW), null);
});

test('card parser reads the <time> text', () => {
  const html = `<div class="base-card" data-entity-urn="urn:li:jobPosting:123">
    <h3 class="base-search-card__title">ML Intern</h3>
    <h4 class="base-search-card__subtitle"><a>Acme</a></h4>
    <span class="job-search-card__location">Boston, MA</span>
    <time class="job-search-card__listdate--new" datetime="2026-10-18">
      14 hours ago
    </time></div>`;
  const [card] = parseCards(html, NOW);
  assert.equal(card.title, 'ML Intern');
  assert.equal(card.postedAt, '2026-10-18T12:00:00.000Z');
});
