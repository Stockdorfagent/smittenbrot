#!/usr/bin/env bash
# Smittenbrot Backstube — start the local tool.
#
# Serves this folder on http://localhost:8420 and opens the browser.
# Nothing is published: the server binds to localhost only.
set -euo pipefail
cd "$(dirname "$0")"

# Generate js/config.js from the local credentials if it is not there
# (it is gitignored, so a fresh clone needs this).
CRED="$HOME/Smittenbrot-App/.credentials/aoryok.env"
if [ ! -f js/config.js ]; then
  if [ ! -f "$CRED" ]; then
    echo "ERROR: js/config.js is missing and $CRED was not found." >&2
    echo "Copy js/config.example.js to js/config.js and paste the anon key." >&2
    exit 1
  fi
  URL_V=$(grep '^SUPABASE_URL=' "$CRED" | cut -d= -f2- | tr -d '"'"'"' ')
  ANON_V=$(grep '^SUPABASE_ANON_KEY=' "$CRED" | cut -d= -f2- | tr -d '"'"'"' ')
  sed -e "s#PASTE_ANON_KEY_OR_RUN_start.sh#${ANON_V}#" \
      -e "s#https://aoryokgzmpezanmlgxtl.supabase.co#${URL_V}#" \
      js/config.example.js > js/config.js
  echo "Generated js/config.js from .credentials"
fi

PORT="${PORT:-8420}"
URL="http://localhost:${PORT}/"

if command -v ss >/dev/null 2>&1 && ss -ltn "( sport = :${PORT} )" 2>/dev/null | grep -q LISTEN; then
  echo "Something is already serving port ${PORT} — assuming it is Backstube."
  echo "Open: ${URL}"
else
  echo "Starting Backstube on ${URL}  (Ctrl-C to stop)"
  # bind to loopback only, so nothing on the network can reach it
  python3 -m http.server "${PORT}" --bind 127.0.0.1 >/dev/null 2>&1 &
  SRV=$!
  trap 'kill ${SRV} 2>/dev/null || true' EXIT
  sleep 1
fi

for opener in xdg-open open sensible-browser firefox google-chrome; do
  if command -v "$opener" >/dev/null 2>&1; then "$opener" "$URL" >/dev/null 2>&1 & break; fi
done

echo
echo "  Backstube is running.  ${URL}"
echo "  Sign in with sophia@smittenbrot.de and the 6-digit code."
echo
wait ${SRV:-$$} 2>/dev/null || true
