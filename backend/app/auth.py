"""Optional local HTTP Basic accounts for shared deployments.

Create accounts with ``python -m backend.app.auth set-user NAME ROLE``.
When no account file exists, local mode runs as a single administrator.
Set BCP_AUTH_REQUIRED=true on shared servers to fail closed.
"""
import getpass
import hashlib
import hmac
import json
import os
import secrets
import sys
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import Request
from fastapi.responses import JSONResponse

ROLES = {"reader": 0, "analyst": 1, "admin": 2}


def users_file():
    data_dir = Path(os.getenv("BCP_DATA_DIR", "data")).resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    return Path(os.getenv("BCP_AUTH_USERS_FILE", str(data_dir / "users.json")))


def load_users():
    path = users_file()
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def password_hash(password: str, salt: str):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 300_000).hex()


def role_needed(path: str, method: str):
    if method in ("GET", "HEAD", "OPTIONS"):
        return "reader"
    if path.startswith("/api/suppliers"):
        return "admin"
    if path.startswith("/api/events/") and path.endswith("/reviews"):
        return "analyst"
    if path == "/api/scan-jobs":
        return "analyst"
    return "admin"


def _unauthorized(message="Authentication required"):
    return JSONResponse({"detail": message}, status_code=401,
                        headers={"WWW-Authenticate": 'Basic realm="BCP Risk Platform"'})


async def auth_middleware(request: Request, call_next):
    if request.url.path == "/api/health":
        return await call_next(request)
    users = load_users()
    if not users:
        if os.getenv("BCP_AUTH_REQUIRED", "false").lower() in ("1", "true", "yes"):
            return JSONResponse({"detail": "No accounts configured"}, status_code=503)
        request.state.user = "local_user"
        request.state.role = "admin"
        return await call_next(request)
    header = request.headers.get("authorization", "")
    if not header.startswith("Basic "):
        return _unauthorized()
    try:
        import base64
        username, password = base64.b64decode(header[6:], validate=True).decode().split(":", 1)
        account = users.get(username)
        if not account or not hmac.compare_digest(password_hash(password, account["salt"]), account["hash"]):
            return _unauthorized()
    except (ValueError, KeyError, UnicodeDecodeError):
        return _unauthorized()
    role = account.get("role", "reader")
    if ROLES.get(role, -1) < ROLES[role_needed(request.url.path, request.method)]:
        return JSONResponse({"detail": "Insufficient role"}, status_code=403)
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        if origin and urlsplit(origin).netloc != request.headers.get("host", ""):
            return JSONResponse({"detail": "Cross-origin write blocked"}, status_code=403)
    request.state.user = username
    request.state.role = role
    return await call_next(request)


def cli():
    if len(sys.argv) != 4 or sys.argv[1] != "set-user" or sys.argv[3] not in ROLES:
        raise SystemExit("Usage: python -m backend.app.auth set-user USERNAME reader|analyst|admin")
    name, role = sys.argv[2], sys.argv[3]
    if not name or ":" in name:
        raise SystemExit("Username must be nonempty and contain no colon")
    password = getpass.getpass("Password: ")
    if len(password) < 12:
        raise SystemExit("Use at least 12 characters")
    if password != getpass.getpass("Confirm password: "):
        raise SystemExit("Passwords do not match")
    salt = secrets.token_hex(16)
    users = load_users()
    users[name] = {"role": role, "salt": salt, "hash": password_hash(password, salt)}
    path = users_file()
    path.write_text(json.dumps(users, indent=2), encoding="utf-8")
    if os.name != "nt":
        path.chmod(0o600)
    print(f"Saved {name} ({role}) to {path}")


if __name__ == "__main__":
    cli()
