// data/portal-health.tsv only feeds scan.mjs's "unreachable N runs in a row"
// warning (threshold 3), but the tracked scan appends ~1,400 rows a run,
// every 15 min — it reached 70 MB, and GitHub rejects files over 100 MB.
// Keeping the last 10 runs leaves that warning unchanged.
import { existsSync, readFileSync, writeFileSync } from 'fs';

export function trimPortalHealth(file, keepRuns = 10) {
  if (!existsSync(file)) return;
  const [header, ...rows] = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const runOf = (row) => row.slice(0, row.indexOf('\t'));
  const runs = [...new Set(rows.map(runOf))]; // appended in run order
  if (runs.length <= keepRuns) return;
  const kept = new Set(runs.slice(-keepRuns));
  writeFileSync(file, `${[header, ...rows.filter((row) => kept.has(runOf(row)))].join('\n')}\n`);
}
