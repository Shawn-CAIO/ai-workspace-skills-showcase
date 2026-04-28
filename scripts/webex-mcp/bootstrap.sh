#!/usr/bin/env bash
# One-time setup: clone WebexSamples upstream into projects/webex-mcp-server + npm install.
# Re-run safe; skips clone if already present.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="$(cd "$DIR/../.." && pwd)"
SERVER_DIR="${WEBEX_SERVER_DIR:-$WORKSPACE/projects/webex-mcp-server}"

if [ ! -d "$SERVER_DIR" ]; then
  echo "Cloning WebexSamples/webex-messaging-mcp-server -> $SERVER_DIR"
  mkdir -p "$(dirname "$SERVER_DIR")"
  git clone https://github.com/WebexSamples/webex-messaging-mcp-server.git "$SERVER_DIR"
else
  echo "Upstream server already present at $SERVER_DIR (skipping clone)"
fi

echo ""
echo "Installing npm dependencies..."
(cd "$SERVER_DIR" && npm install)

echo ""
echo "Upstream server ready: $SERVER_DIR"
echo ""

if [ ! -f "$DIR/.env" ]; then
  echo "Next: create .env from template"
  echo "    cp \"$DIR/.env.example\" \"$DIR/.env\""
  echo "    \$EDITOR \"$DIR/.env\""
elif [ ! -f "$DIR/.webex-tokens.json" ]; then
  echo "Next: run OAuth setup (creates .webex-tokens.json)"
  echo "    node \"$DIR/oauth-setup.js\""
else
  echo "Register with Claude Code (User scope, global):"
  echo "    claude mcp add webex-messaging -s user \"$DIR/start-mcp.sh\""
fi
