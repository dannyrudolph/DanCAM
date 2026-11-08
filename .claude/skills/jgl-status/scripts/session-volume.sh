#!/usr/bin/env bash
# Measures how much has been generated since the last commit — the GIT-5
# checkpoint trigger. Prints key: value lines; read-only.
#
#   files_changed   tracked files differing from HEAD (staged or not) + untracked files
#   lines_added     added lines in tracked files + every line of untracked text files
#   checkpoint      yes when files_changed >= 10 or lines_added >= 400
#
# Thresholds can be overridden: FILES_LIMIT=6 LINES_LIMIT=250 session-volume.sh
set -euo pipefail

FILES_LIMIT=${FILES_LIMIT:-10}
LINES_LIMIT=${LINES_LIMIT:-400}

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "error: not a git repository" >&2
  exit 1
fi

if git rev-parse --verify -q HEAD >/dev/null; then
  base=HEAD
else
  # No commits yet: compare against the empty tree.
  base=$(git hash-object -t tree /dev/null)
fi

tracked_files=$(git diff --name-only "$base" | wc -l | tr -d ' ')
tracked_lines=$(git diff --numstat "$base" | awk '$1 != "-" { s += $1 } END { print s + 0 }')

untracked_files=0
untracked_lines=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  untracked_files=$((untracked_files + 1))
  # Count text files only; grep -I treats binaries as non-matching.
  if grep -Iq . "$f" 2>/dev/null; then
    n=$(wc -l < "$f" | tr -d ' ')
    untracked_lines=$((untracked_lines + n))
  fi
done < <(git ls-files --others --exclude-standard)

files=$((tracked_files + untracked_files))
lines=$((tracked_lines + untracked_lines))
checkpoint=no
if [ "$files" -ge "$FILES_LIMIT" ] || [ "$lines" -ge "$LINES_LIMIT" ]; then
  checkpoint=yes
fi

echo "files_changed: $files"
echo "lines_added: $lines"
echo "checkpoint: $checkpoint (limits: $FILES_LIMIT files / $LINES_LIMIT lines)"
