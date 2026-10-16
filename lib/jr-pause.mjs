import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const JR_PAUSE_FILE = join(ROOT, 'data/jr-pause.json');

/**
 * JobRight account pause after Fair Use / automation suspension.
 * Scrapers must not hit jobright.ai while this is active.
 */
export function jrPauseUntil() {
  if (!existsSync(JR_PAUSE_FILE)) return 0;
  try {
    const raw = JSON.parse(readFileSync(JR_PAUSE_FILE, 'utf8'));
    const t = Date.parse(raw.until || '');
    return Number.isFinite(t) ? t : 0;
  } catch {
    return 0;
  }
}

export function jrPauseActive() {
  const until = jrPauseUntil();
  return until > Date.now();
}

export function jrPauseMessage() {
  const until = jrPauseUntil();
  if (!until || until <= Date.now()) return '';
  let reason = 'JobRight account pause';
  try {
    reason = JSON.parse(readFileSync(JR_PAUSE_FILE, 'utf8')).reason || reason;
  } catch { /* default */ }
  return `skip JobRight — paused until ${new Date(until).toISOString()} (${reason})`;
}
