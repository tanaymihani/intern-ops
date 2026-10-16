#!/usr/bin/env node
/**
 * Store a session cookie as a GitHub Actions secret from your terminal.
 * Copy a request from a logged-in tab (DevTools → Network → right-click →
 * Copy → Copy as cURL), then:
 *
 *   node scripts/set-cookie.mjs jobright          # reads the clipboard (macOS)
 *   pbpaste | node scripts/set-cookie.mjs jobright -
 *
 * Uses the `gh` CLI, so the cookie never touches a file.
 */
import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { extractCookie, curlHost } from '../lib/cookie.mjs';

const SECRETS = { jobright: 'JOBRIGHT_COOKIE' };
const source = process.argv[2];
if (!SECRETS[source]) {
  console.error(`usage: node scripts/set-cookie.mjs <${Object.keys(SECRETS).join('|')}> [-]`);
  process.exit(2);
}
const text = process.argv[3] === '-'
  ? readFileSync(0, 'utf8')
  : spawnSync('pbpaste', { encoding: 'utf8' }).stdout || '';
const cookie = extractCookie(text);
if (cookie.length < 20) {
  console.error('No cookie found. Copy the request with DevTools → "Copy as cURL" and try again.');
  process.exit(1);
}
const host = curlHost(text);
if (host && !host.endsWith(`${source}.ai`) && !host.includes(source)) {
  console.error(`That request went to ${host}, not ${source}.`);
  process.exit(1);
}
const r = spawnSync('gh', ['secret', 'set', SECRETS[source]], { input: cookie, encoding: 'utf8', stdio: ['pipe', 'inherit', 'inherit'] });
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(`✓ ${SECRETS[source]} updated (${cookie.split(';').length} cookies). Trigger a run: gh workflow run ${source}.yml`);
