#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
PY=python3; command -v python3 >/dev/null 2>&1 || PY=python
command -v "$PY" >/dev/null 2>&1 || { echo "Python 3.9+ is required"; exit 1; }
command -v npm   >/dev/null 2>&1 || { echo "Node.js 18+ (with npm) is required"; exit 1; }
if [ ! -d frontend/node_modules ]; then
  echo ">> Installing dashboard packages (one time, ~1 minute)..."
  (cd frontend && npm install --no-audit --no-fund)
fi
PIDS=""
cleanup() { echo; echo "Stopping..."; for p in $PIDS; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM
wait_api() {
  for i in $(seq 1 20); do
    "$PY" -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:$1/api/health',timeout=1)" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "!! The node on port $1 did not start"; exit 1
}
(cd backend && "$PY" -m peerloom --api-port 8801) & PIDS="$PIDS $!"
wait_api 8801
echo ">> Dashboard: http://localhost:3000"
(cd frontend && npm run dev) & PIDS="$PIDS $!"
wait
