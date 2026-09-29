#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -x .venv/bin/python ] || [ ! -f frontend/dist/index.html ]; then
  echo 'Run deploy/setup-macos.sh after the frontend has been built.' >&2
  exit 1
fi
mkdir -p data
is_our_process() {
  local pid="$1" marker="$2" command
  command="$(ps -ww -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$command" == *"$PWD/.venv/bin/python"* && "$command" == *"$marker"* ]]
}
if [ -f data/bcp-api.pid ] && is_our_process "$(cat data/bcp-api.pid)" 'app.main:app'; then
  echo 'App is already running.'
else
  nohup .venv/bin/python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 >data/api.log 2>&1 </dev/null &
  echo $! > data/bcp-api.pid
fi
if [ -f data/bcp-worker.pid ] && is_our_process "$(cat data/bcp-worker.pid)" 'collector.worker'; then
  echo 'Collector is already running.'
else
  nohup .venv/bin/python -m collector.worker >data/collector.log 2>&1 </dev/null &
  echo $! > data/bcp-worker.pid
fi
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
    open http://127.0.0.1:8000
    echo 'App opened at http://127.0.0.1:8000'
    exit 0
  fi
  sleep 1
done
echo 'App failed to become ready. Check data/api.log and data/collector.log.' >&2
exit 1
