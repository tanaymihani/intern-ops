function validIso(value) {
  if (!value) return '';
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

/**
 * Merge a rolling snapshot while preserving the first time each canonical job
 * was discovered. Re-observing a job updates lastSeenAt only.
 */
export function mergeDiscoveredJobs(previous, incoming, {
  keyOf,
  now = new Date().toISOString(),
  keepHours = 72,
  legacyDiscoveredAt = '',
} = {}) {
  if (typeof keyOf !== 'function') throw new TypeError('keyOf is required');
  const nowIso = validIso(now) || new Date().toISOString();
  const legacyIso = validIso(legacyDiscoveredAt) || nowIso;
  const cutoff = Date.parse(nowIso) - keepHours * 3600 * 1000;
  const byKey = new Map();
  const previousByKey = new Map();

  for (const job of Array.isArray(previous) ? previous : []) {
    const key = keyOf(job);
    if (!key) continue;
    const discoveredAt = validIso(job.discoveredAt) || legacyIso;
    const normalized = {
      ...job,
      discoveredAt,
      lastSeenAt: validIso(job.lastSeenAt) || discoveredAt,
    };
    previousByKey.set(key, normalized);
    // Old jobs disappear from the rolling snapshot only when they are also
    // absent from this scrape. Their identity remains available below so a
    // continuing or returning posting never becomes "new" again.
    if (!job?.postedAt || Number(job.postedAt) >= cutoff) byKey.set(key, normalized);
  }

  for (const job of Array.isArray(incoming) ? incoming : []) {
    const key = keyOf(job);
    if (!key) continue;
    const existing = previousByKey.get(key);
    byKey.set(key, {
      ...(existing || {}),
      ...job,
      discoveredAt: validIso(existing?.discoveredAt) || nowIso,
      lastSeenAt: nowIso,
    });
  }

  return [...byKey.values()].sort((a, b) => {
    const ap = Number(a.postedAt) || 0;
    const bp = Number(b.postedAt) || 0;
    if (ap !== bp) return bp - ap;
    return Date.parse(b.discoveredAt || '') - Date.parse(a.discoveredAt || '');
  });
}
