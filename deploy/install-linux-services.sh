#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v systemctl >/dev/null 2>&1; then
  echo 'systemd is required for this installer.' >&2
  exit 1
fi
app_dir="$(pwd -P)"
if [[ "$app_dir" == *' '* ]]; then
  echo 'Place this installation in a Linux path without spaces.' >&2
  exit 1
fi
app_user="${SUDO_USER:-$(id -un)}"
if [ "$app_user" = root ]; then
  echo 'Run this script as the unprivileged account that should own the application.' >&2
  exit 1
fi
if [ ! -x .venv/bin/python ]; then
  echo 'Run deploy/setup-linux.sh first.' >&2
  exit 1
fi
if [ ! -f data/users.json ]; then
  echo 'Create an administrator account with .venv/bin/python -m backend.app.auth set-user admin admin first.' >&2
  exit 1
fi
if [ ! -f .env ] || ! grep -Eq '^BCP_AUTH_REQUIRED[[:space:]]*=[[:space:]]*true[[:space:]]*$' .env; then
  echo 'Set BCP_AUTH_REQUIRED=true in .env before enabling shared services.' >&2
  exit 1
fi
mkdir -p deploy/generated
BCP_APP_DIR="$app_dir" BCP_APP_USER="$app_user" python3 - <<'PY'
import os
from pathlib import Path

for service in ("bcp-api", "bcp-worker"):
    template = Path("deploy/systemd", service + ".service.template").read_text()
    unit = template.replace("__BCP_DIR__", os.environ["BCP_APP_DIR"])
    unit = unit.replace("__BCP_USER__", os.environ["BCP_APP_USER"])
    Path("deploy/generated", service + ".service").write_text(unit)
PY
systemd-analyze verify deploy/generated/bcp-api.service deploy/generated/bcp-worker.service
sudo install -m 0644 deploy/generated/bcp-api.service /etc/systemd/system/bcp-api.service
sudo install -m 0644 deploy/generated/bcp-worker.service /etc/systemd/system/bcp-worker.service
sudo systemctl daemon-reload
sudo systemctl enable --now bcp-api.service bcp-worker.service
systemctl --no-pager --full status bcp-api.service bcp-worker.service
