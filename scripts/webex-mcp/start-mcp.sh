#!/usr/bin/env bash
# Wrapper: refresh Webex access_token if needed, then exec the MCP server.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

TOKEN="$(node refresh-token.js)"
if [ -z "$TOKEN" ]; then
  echo "Failed to obtain access token" >&2
  exit 1
fi

export WEBEX_PUBLIC_WORKSPACE_API_KEY="$TOKEN"
export WEBEX_API_BASE_URL="${WEBEX_API_BASE_URL:-https://webexapis.com/v1}"

# WebexSamples upstream lives in projects/webex-mcp-server (gitignored, installed by bootstrap.sh).
# Override with WEBEX_SERVER_DIR if installed elsewhere.
SERVER_DIR="${WEBEX_SERVER_DIR:-$DIR/../../projects/webex-mcp-server}"
if [ ! -f "$SERVER_DIR/mcpServer.js" ]; then
  echo "mcpServer.js not found at $SERVER_DIR" >&2
  echo "Run scripts/webex-mcp/bootstrap.sh first." >&2
  exit 1
fi

exec node "$SERVER_DIR/mcpServer.js"
