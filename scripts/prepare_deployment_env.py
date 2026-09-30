#!/usr/bin/env python3
"""Create VM-local Supabase and study environment files with matching keys."""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import time


ROOT = Path(__file__).resolve().parents[1]


def base64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def jwt(secret: str, role: str) -> str:
    now = int(time.time())
    header = base64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = base64url(
        json.dumps(
            {
                "role": role,
                "iss": "supabase",
                "iat": now,
                "exp": now + (10 * 365 * 24 * 60 * 60),
            },
            separators=(",", ":"),
        ).encode()
    )
    unsigned = f"{header}.{payload}"
    signature = hmac.new(secret.encode(), unsigned.encode(), hashlib.sha256).digest()
    return f"{unsigned}.{base64url(signature)}"


def replace_value(contents: str, key: str, value: str) -> str:
    updated, count = re.subn(
        rf"^{re.escape(key)}=.*$",
        f"{key}={value}",
        contents,
        count=1,
        flags=re.MULTILINE,
    )
    if count != 1:
        raise RuntimeError(f"Expected exactly one {key} entry in the template")
    return updated


def write_private(path: Path, contents: str, force: bool) -> None:
    if path.exists() and not force:
        raise FileExistsError(f"{path} already exists; use --force to replace it")
    path.write_text(contents, encoding="utf-8")
    os.chmod(path, 0o600)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--force",
        action="store_true",
        help="replace existing local environment files",
    )
    args = parser.parse_args()

    jwt_secret = secrets.token_urlsafe(48)
    anon_key = jwt(jwt_secret, "anon")
    service_role_key = jwt(jwt_secret, "service_role")

    supabase_env = (ROOT / "supabase/.env.example").read_text(encoding="utf-8")
    replacements = {
        "POSTGRES_PASSWORD": secrets.token_urlsafe(36),
        "JWT_SECRET": jwt_secret,
        "ANON_KEY": anon_key,
        "SERVICE_ROLE_KEY": service_role_key,
        "DASHBOARD_PASSWORD": secrets.token_urlsafe(36),
        "SITE_URL": "https://iivm11.cit.tum.de",
        "API_EXTERNAL_URL": "https://iivm11.cit.tum.de/supabase",
        "SUPABASE_PUBLIC_URL": "https://iivm11.cit.tum.de/supabase",
        "LOGFLARE_API_KEY": secrets.token_urlsafe(48),
    }
    for key, value in replacements.items():
        supabase_env = replace_value(supabase_env, key, value)

    study_env = (ROOT / ".env.docker.example").read_text(encoding="utf-8")
    study_env = replace_value(study_env, "VITE_SUPABASE_ANON_KEY", anon_key)
    study_env = replace_value(
        study_env,
        "SUPABASE_SERVICE_ROLE_KEY",
        service_role_key,
    )

    write_private(ROOT / "supabase/.env", supabase_env, args.force)
    write_private(ROOT / ".env.docker", study_env, args.force)
    print("Created supabase/.env and .env.docker with permissions 0600.")
    print("Next: add the OpenRouter key and SONA completion URLs to .env.docker.")


if __name__ == "__main__":
    main()
