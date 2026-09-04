#!/usr/bin/env bash
# Publish collector output to the `data` branch, leaving main's history to code.
#
# main was taking about 1,140 commits a day, all of them "[skip ci] data:
# something", which buried every real change and made `git log` useless. The
# commits are still needed - the site reads its JSON out of the repo through the
# GitHub API - so they move rather than stop.
#
# The branch is checked out separately by the workflow at .databranch, so this
# never switches branches in the main working tree.
#
# Retries by starting over from the newest remote tip rather than rebasing: each
# collector writes a disjoint set of files, so re-applying ours on top of
# whatever landed meanwhile is always correct and cannot conflict.
#
# Usage:  scripts/publish-data.sh "<commit message>" <path> [<path>...]
#         paths are relative to the repo root
set -uo pipefail

MSG=${1:?commit message required}
shift
[ "$#" -gt 0 ] || { echo "publish-data: no paths given"; exit 1; }

BRANCH=data
WORK=.databranch
[ -d "$WORK" ] || { echo "publish-data: $WORK is missing; the workflow must check out $BRANCH there"; exit 1; }

git -C "$WORK" config user.name "rl-tracker-bot"
git -C "$WORK" config user.email "actions@github.com"

for attempt in 1 2 3 4 5; do
  # Start each attempt from the current remote tip, so a push that lost a race
  # is retried against what actually landed.
  if [ "$attempt" -gt 1 ]; then
    git -C "$WORK" fetch --depth=1 origin "$BRANCH" || true
    git -C "$WORK" reset -q --hard FETCH_HEAD || true
    git -C "$WORK" clean -qfd || true
  fi

  for p in "$@"; do
    [ -e "$p" ] || continue
    mkdir -p "$WORK/$(dirname "$p")"
    cp -r "$p" "$WORK/$p"
  done

  git -C "$WORK" add -- "$@" 2>/dev/null || true
  if git -C "$WORK" diff --staged --quiet; then
    echo "no changes to publish"
    exit 0
  fi

  git -C "$WORK" commit -q -m "$MSG"
  if git -C "$WORK" push -q origin "HEAD:$BRANCH"; then
    echo "published to $BRANCH"
    exit 0
  fi
  echo "push retry $attempt"
  sleep $((RANDOM % 8 + 3))
done

echo "publish failed after retries"
exit 1
