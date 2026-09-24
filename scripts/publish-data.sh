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

# The identity is passed per command, never written to a config file.
#
# `git -C .databranch config user.name ...` looks scoped and is not: a linked
# worktree shares .git/config with the main one, so running this script on a
# workstation rewrote the developer's own name and email for the whole repo.
# Thirty-one hand-made commits between 15 and 16 September 2026 were authored
# as rl-tracker-bot <actions@github.com> - which GitHub renders as
# "actions-user" - and counted toward nobody's contributions. -c sets the value
# for one invocation and leaves nothing behind.
BOT=(-c user.name=rl-tracker-bot -c user.email=actions@github.com)

for attempt in 1 2 3 4 5; do
  # Start each attempt from the current remote tip, so a push that lost a race
  # is retried against what actually landed.
  #
  # The first attempt too. The workflow checked the branch out when the job
  # started, and by the time a tracker run reaches this step that checkout is
  # a minute and a half old; presence publishes every two minutes, so the tip
  # had nearly always moved. Every sampled tracker run lost its first push,
  # slept 3-10s and fetched anyway: the publish step took 8-11s where the
  # second attempt alone took under 3. Fetching first costs about a second
  # and makes the first push the one that normally lands.
  git -C "$WORK" fetch --depth=1 origin "$BRANCH" || true
  git -C "$WORK" reset -q --hard FETCH_HEAD || true
  git -C "$WORK" clean -qfd || true

  for p in "$@"; do
    [ -e "$p" ] || continue
    mkdir -p "$WORK/$(dirname "$p")"
    # Delete the destination first. `cp -r dir dest/dir` copies INTO dest/dir
    # when it already exists, so a directory published twice became
    # data/presence/presence, then data/presence/presence/presence, one level
    # deeper every three minutes. It reached 265 levels and 2,398 characters of
    # path before a checkout hit "Filename too long"; worse, the collector went
    # on reading the top level, which no longer received the new log, so a day
    # of presence polls was written to a path nothing read back.
    rm -rf "$WORK/$p"
    cp -r "$p" "$WORK/$p"
  done

  # One path at a time, and only paths that exist on the branch after the
  # copy. `git add` aborts the WHOLE add when any one pathspec matches nothing,
  # so a file listed here but produced by neither this run nor an earlier one
  # made every run report "no changes to publish" and publish nothing.
  for p in "$@"; do
    [ -e "$WORK/$p" ] || continue
    git -C "$WORK" add -- "$p"
  done
  if git -C "$WORK" diff --staged --quiet; then
    echo "no changes to publish"
    exit 0
  fi

  git "${BOT[@]}" -C "$WORK" commit -q -m "$MSG"
  if git -C "$WORK" push -q origin "HEAD:$BRANCH"; then
    echo "published to $BRANCH"
    exit 0
  fi
  echo "push retry $attempt"
  sleep $((RANDOM % 8 + 3))
done

echo "publish failed after retries"
exit 1
