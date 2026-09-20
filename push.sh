#!/usr/bin/env bash
# Push the shop repo (website + mobile) to GitHub Stockdorfagent/smittenbrot; Vercel auto-deploys main.
#
# The remote is stored WITHOUT credentials on purpose, so the token never sits
# in .git/config. This reads it from the same place the shop's repo does.
set -euo pipefail
cd "$(dirname "$0")"
CRED="$HOME/Smittenbrot-App/.credentials/Github personal access token.rtf"
[ -f "$CRED" ] || { echo "No PAT at $CRED" >&2; exit 1; }
PAT=$(python3 -c "
import re,io,sys
s=io.open(sys.argv[1],encoding='latin-1').read()
m=re.search(r'gh[pousr]_[A-Za-z0-9]{20,}', s)
print(m.group(0) if m else '')" "$CRED")
[ -n "$PAT" ] || { echo "Could not read the token out of the .rtf" >&2; exit 1; }
BRANCH="${1:-main}"
git push "https://Stockdorfagent:${PAT}@github.com/Stockdorfagent/smittenbrot.git" "$BRANCH"
# keep origin/<branch> honest: pushing via a URL leaves the tracking ref stale,
# so `git status` would keep claiming the branch is ahead
git update-ref "refs/remotes/origin/$BRANCH" "$(git rev-parse "$BRANCH")"
echo "Pushed $(git rev-parse --short "$BRANCH") to https://github.com/Stockdorfagent/smittenbrot (private)"
