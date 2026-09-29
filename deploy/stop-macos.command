#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
for service in api worker; do
  pid_file="data/bcp-${service}.pid"
  if [ -f "$pid_file" ]; then
    pid="$(cat "$pid_file")"
    marker='app.main:app'
    if [ "$service" = worker ]; then marker='collector.worker'; fi
    command="$(ps -ww -p "$pid" -o command= 2>/dev/null || true)"
    if [[ "$command" == *"$PWD/.venv/bin/python"* && "$command" == *"$marker"* ]]; then
      kill "$pid"
      echo "Stopped $service (PID $pid)."
    fi
    rm -f "$pid_file"
  fi
done
