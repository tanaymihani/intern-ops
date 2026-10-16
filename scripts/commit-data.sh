#!/usr/bin/env bash
# Commit what a scraper wrote and push, rebasing over the other workflows'
# pushes (they all commit to the same branch on offset schedules; each one
# writes only its own files, so the rebase is clean). Fails loudly if the
# push never lands — a green run that published nothing is worse than red.
#
#   scripts/commit-data.sh <label> [paths...]     (paths default: data/)
set -uo pipefail
label="$1"; shift
if [ "$#" -eq 0 ]; then set -- data/; fi
git config user.name "intern-ops-bot"
git config user.email "actions@users.noreply.github.com"
git add -- "$@"
if git diff --cached --quiet; then
  echo "no changes to commit"
  exit 0
fi
git commit -q -m "$label: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
for attempt in 1 2 3 4 5; do
  git rebase --abort >/dev/null 2>&1 || true
  if git pull --rebase --quiet && git push --quiet; then
    echo "pushed $label"
    exit 0
  fi
  echo "push attempt $attempt failed, retrying..."
  sleep $((attempt * 4))
done
echo "::error::failed to push $label results after 5 attempts"
exit 1
