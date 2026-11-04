#!/usr/bin/env bash
# Commit what a scraper wrote and push, rebasing over the other workflows'
# pushes (they all commit to the same branch on offset schedules; each one
# writes only its own files, so the rebase is clean). Fails loudly if the
# push never lands — a green run that published nothing is worse than red.
#
# The only conflict left is with another run of the same scraper (GitHub's
# cron and scheduler.yml can start it minutes apart). This run is the newer
# one, so its copy of a conflicted file wins; append-only logs keep both
# runs' rows instead (merge=union in .gitattributes).
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

rebase_onto_remote() {
  git pull --rebase --quiet && return 0
  local conflicted
  conflicted=$(git diff --name-only --diff-filter=U)
  [ -n "$conflicted" ] || return 1
  echo "conflict with another $label run — keeping this run's copy of: $(echo $conflicted)"
  while IFS= read -r f; do
    # In a rebase, stage 3 ("theirs") is the commit being replayed: this run's.
    if git cat-file -e ":3:$f" 2>/dev/null; then
      git checkout --theirs -- "$f" && git add -- "$f"
    else
      git rm -q -- "$f"
    fi
  done <<< "$conflicted"
  GIT_EDITOR=true git rebase --continue >/dev/null
}

for attempt in 1 2 3 4 5; do
  git rebase --abort >/dev/null 2>&1 || true
  if rebase_onto_remote && git push --quiet; then
    echo "pushed $label"
    exit 0
  fi
  echo "push attempt $attempt failed, retrying..."
  sleep $((attempt * 4))
done
echo "::error::failed to push $label results after 5 attempts"
exit 1
