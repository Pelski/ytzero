#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -d "$ROOT_DIR/app/node_modules" ] || [ ! -d "$ROOT_DIR/ui/node_modules" ]; then
  echo "Dependencies are missing. Run 'bun run setup' first."
  exit 1
fi

cleanup() {
  if [ -n "${APP_PID:-}" ]; then
    kill "$APP_PID" >/dev/null 2>&1 || true
  fi
  if [ -n "${UI_PID:-}" ]; then
    kill "$UI_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

(
  cd "$ROOT_DIR/app"
  bun run dev --host 0.0.0.0
) &
APP_PID=$!

(
  cd "$ROOT_DIR/ui"
  bun run dev --host 0.0.0.0 --port 5174
) &
UI_PID=$!

echo "ytzero dev"
echo "  ui:  http://localhost:5174"
echo "  api: http://localhost:3001"

wait "$APP_PID" "$UI_PID"
