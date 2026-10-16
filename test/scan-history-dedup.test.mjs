import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldDedupScanHistoryRow } from '../scan.mjs';

test('dedup re-check accepts a plain date-only first_seen (legacy rows)', () => {
  const dedup = shouldDedupScanHistoryRow(
    { firstSeen: '2026-10-01', status: 'added' },
    { recheckAfterDays: 7, today: '2026-10-13' },
  );
  // 12 days old, past the 7-day recheck window -> eligible for recheck, not deduped
  assert.equal(dedup, false);
});

test('dedup re-check accepts a full ISO timestamp first_seen (new precise rows)', () => {
  const dedup = shouldDedupScanHistoryRow(
    { firstSeen: '2026-10-01T18:28:51.769Z', status: 'added' },
    { recheckAfterDays: 7, today: '2026-10-13' },
  );
  assert.equal(dedup, false);
});

test('a recent full-ISO first_seen within the recheck window still dedupes', () => {
  const dedup = shouldDedupScanHistoryRow(
    { firstSeen: '2026-10-12T18:28:51.769Z', status: 'added' },
    { recheckAfterDays: 7, today: '2026-10-13' },
  );
  assert.equal(dedup, true);
});

test('a garbage first_seen still falls back to "treat as seen" rather than crashing', () => {
  const dedup = shouldDedupScanHistoryRow(
    { firstSeen: 'not-a-date', status: 'added' },
    { recheckAfterDays: 7, today: '2026-10-13' },
  );
  assert.equal(dedup, true);
});
