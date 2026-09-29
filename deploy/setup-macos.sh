#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v python3 >/dev/null 2>&1; then
  echo 'Python 3.11+ is required.' >&2
  exit 1
fi
python3 -m venv .venv
if [ -d wheelhouse/macos ]; then
  .venv/bin/python -m pip install --no-index --find-links wheelhouse/macos -r backend/requirements.txt
else
  .venv/bin/python -m pip install -r backend/requirements.txt
fi
if [ ! -f frontend/dist/index.html ]; then
  echo 'Frontend build missing. Build with: cd frontend && npm ci && npm run build' >&2
  exit 1
fi
mkdir -p data
echo 'Setup complete. Double-click deploy/start-macos.command to open the app.'
