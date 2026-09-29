#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m venv .venv
if [ -d wheelhouse/linux ]; then
  .venv/bin/python -m pip install --no-index --find-links wheelhouse/linux -r backend/requirements.txt
else
  .venv/bin/python -m pip install -r backend/requirements.txt
fi
if [ ! -f frontend/dist/index.html ]; then
  echo 'Frontend build missing. Build with: cd frontend && npm ci && npm run build' >&2
  exit 1
fi
mkdir -p data
echo 'Setup complete. Set DATABASE_URL and install the service units in deploy/systemd/.'
