#!/usr/bin/env bash
# Change-shape evidence for /jgl-review-code. Read-only.
#
#   change-shape.sh [N] [WINDOW]
#
# Section 1: the last N (default 5) commits that look like feature work —
#   subjects matching fix/bump/rename/chore/deps/format/typo/revert/merge are
#   skipped — with how many files and top-level directories each touched.
# Section 2: repeat offenders — files touched most often across the last
#   WINDOW (default 30) commits. A file in nearly every change is a bottleneck.
#
# The numbers are where to look, not the finding: read the commits before
# calling a wide diff a coupling problem.
set -euo pipefail

N=${1:-5}
WINDOW=${2:-30}
SKIP='^(fix|bump|rename|chore|deps?|format|typo|revert|merge)\b|^Merge '

echo "== feature commits (last $N)"
count=0
while IFS=$'\t' read -r sha subject; do
  [ -z "$sha" ] && continue
  if printf '%s' "$subject" | grep -Eiq "$SKIP"; then continue; fi
  files=$(git show --name-only --format= "$sha" | sed '/^$/d')
  nfiles=$(printf '%s\n' "$files" | sed '/^$/d' | wc -l | tr -d ' ')
  ndirs=$(printf '%s\n' "$files" | sed '/^$/d' | awk -F/ '{ print (NF > 1 ? $1 : ".") }' | sort -u | wc -l | tr -d ' ')
  echo "${sha:0:8}  files=$nfiles dirs=$ndirs  $subject"
  count=$((count + 1))
  [ "$count" -ge "$N" ] && break
done < <(git log --format='%H%x09%s' --no-merges)
[ "$count" -eq 0 ] && echo "(none found)"

echo "== repeat offenders (last $WINDOW commits)"
git log -n "$WINDOW" --format= --name-only --no-merges | sed '/^$/d' | sort | uniq -c | sort -rn | awk '$1 > 1' | head -10
