#!/usr/bin/env python3
"""
Standalone OAuth token exchange — bypasses google_auth_oauthlib for
confidential clients where PKCE causes 'code_verifier or verifier is not
needed' errors.

Usage:
  python scripts/oauth_raw_exchange.py AUTH_CODE  [redirect_uri]

Reads client_id / client_secret from google_client_secret.json and
writes the result to google_token.json.

Use when setup.py --auth-code fails with a PKCE-related error.
"""
import json
import sys
import urllib.request
import urllib.parse
from pathlib import Path

_HH = str(Path.home()) + "/.hermes"
HERMES_HOME = Path(_HH)
CLIENT_SECRET_PATH = Path(str(HERMES_HOME) + "/google_client_secret.json")
TOKEN_PATH = Path(str(HERMES_HOME) + "/google_token.json")
DEFAULT_REDIRECT = "http://localhost:1"


def main():
    if len(sys.argv) < 2:
        print("Usage: oauth_raw_exchange.py AUTH_CODE [redirect_uri]", file=sys.stderr)
        sys.exit(1)

    code = sys.argv[1]
    redirect_uri = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_REDIRECT

    if not CLIENT_SECRET_PATH.exists():
        print("ERROR: No google_client_secret.json found.", file=sys.stderr)
        sys.exit(1)

    client = json.loads(CLIENT_SECRET_PATH.read_text())["installed"]

    data = urllib.parse.urlencode({
        "grant_type": "authorization_code",
        "code": code,
        "client_id": client["client_id"],
        "client_secret": client["client_secret"],
        "redirect_uri": redirect_uri,
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=data,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            token = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"ERROR {e.code}: {body}", file=sys.stderr)
        sys.exit(1)

    # Add fields Credentials.from_authorized_user_file expects
    token["type"] = "authorized_user"
    token["client_id"] = client["client_id"]
    token["client_secret"] = client["client_secret"]
    token["token_uri"] = "https://oauth2.googleapis.com/token"
    # Convert space-separated scope string to scopes array for setup.py --check
    if "scope" in token and isinstance(token["scope"], str):
        token["scopes"] = token["scope"].split()
        del token["scope"]

    TOKEN_PATH.write_text(json.dumps(token, indent=2))

    # Clean up pending session if present
    pending = Path(str(HERMES_HOME) + "/google_oauth_pending.json")
    if pending.exists():
        pending.unlink()

    print(f"OK: Token saved to {TOKEN_PATH}")
    print(f"Has refresh_token: {bool(token.get('refresh_token'))}")


if __name__ == "__main__":
    main()
