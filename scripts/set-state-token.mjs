#!/usr/bin/env node
/**
 * Connect the site to its private state repo (synced marks, saved logins,
 * email lookups — see lib/doc-store.mjs). Run once after creating the
 * fine-grained token (SETUP.md), with the token copied to the clipboard:
 *
 *   npm run set-state-token
 *   printf %s "$TOKEN" | npm run set-state-token -- --stdin
 *
 * Checks the token can write to the repo, stores STATE_REPO + STATE_TOKEN in
 * Vercel (production) and .secrets.env, then redeploys. Never prints the token.
 */
import { execFileSync, spawnSync } from 'child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SECRETS = join(ROOT, '.secrets.env');
const REPO = process.env.STATE_REPO || 'tanaymihani/intern-ops-state';

const token = (process.argv.includes('--stdin') ? readFileSync(0, 'utf8') : execFileSync('pbpaste').toString()).trim();
if (!/^(github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}$/.test(token)) {
  console.error('No GitHub token found — copy it from the token page (the copy icon next to it) and run this again.');
  process.exit(1);
}

process.env.STATE_REPO = REPO;
process.env.STATE_TOKEN = token;
const { writeDoc } = await import('../lib/doc-store.mjs');
try {
  await writeDoc('state/connected.json', { at: new Date().toISOString() }, { message: 'connect site' });
} catch (err) {
  console.error(`That token can't write to ${REPO}: ${err.message}`);
  console.error('Check it has "Only select repositories" → intern-ops-state, and Contents: Read and write.');
  process.exit(1);
}
console.log(`✓ token can write to ${REPO}`);

for (const [name, value] of [['STATE_REPO', REPO], ['STATE_TOKEN', token]]) {
  spawnSync('vercel', ['env', 'rm', name, 'production', '--yes'], { cwd: ROOT, stdio: 'ignore' });
  const r = spawnSync('vercel', ['env', 'add', name, 'production'], { cwd: ROOT, input: value, stdio: ['pipe', 'ignore', 'inherit'] });
  if (r.status !== 0) {
    console.error(`Could not save ${name} to Vercel (is the Vercel CLI signed in? try: vercel login).`);
    process.exit(1);
  }
}
console.log('✓ saved to Vercel');

const lines = (existsSync(SECRETS) ? readFileSync(SECRETS, 'utf8') : '').split('\n')
  .filter((l) => l && !/^STATE_(REPO|TOKEN)=/.test(l));
writeFileSync(SECRETS, `${[...lines, `STATE_REPO=${REPO}`, `STATE_TOKEN=${token}`].join('\n')}\n`);
chmodSync(SECRETS, 0o600);
console.log('✓ saved to .secrets.env');

const deploy = spawnSync('vercel', ['deploy', '--prod', '--yes'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
if (deploy.status !== 0) {
  console.error('Redeploy failed — run: vercel deploy --prod --yes');
  process.exit(1);
}
console.log('✓ redeployed — marks sync across your devices again');
