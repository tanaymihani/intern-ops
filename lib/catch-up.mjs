// Look-back window for the scan runners. GitHub's cron can go quiet for days
// (it never fired at all while this repo was new), and a scan that comes back
// after a gap with its usual --since drops everything posted during the gap
// as "too old". So each runner records lastOkAt — when its last complete
// sweep finished — and the next fresh sweep looks back at least that far,
// plus a day of margin for date-only posting labels.
import { readFileSync } from 'fs';

const DAY_MS = 86_400_000;
const MAX_DAYS = 45;

/** When the last complete sweep finished, from a runner's heartbeat file (or null). */
export function readLastOk(heartbeatPath) {
  try {
    const hb = JSON.parse(readFileSync(heartbeatPath, 'utf8'));
    return hb.lastOkAt || (hb.exitCode === 0 && !hb.incomplete ? hb.at : null);
  } catch {
    return null;
  }
}

/** --since in days: the configured window, widened to reach back past lastOk (capped at 45). */
export function catchUpSince(configured, lastOk, now = Date.now()) {
  const base = Math.max(1, Math.ceil(Number(configured)) || 1);
  const t = Date.parse(lastOk || '');
  if (!Number.isFinite(t)) return base;
  return Math.max(base, Math.min(Math.ceil((now - t) / DAY_MS + 1), MAX_DAYS));
}
