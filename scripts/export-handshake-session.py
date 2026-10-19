#!/usr/bin/env python3
"""Print your saved Handshake login (cookies from data/handshake-profile) as
JSON, for the HANDSHAKE_SESSION GitHub secret — so the scheduled GitHub
workflow can search Handshake as you without your computer.

    .venv/bin/python scripts/export-handshake-session.py | gh secret set HANDSHAKE_SESSION

Cloudflare's own cookies are left out (they're tied to this browser); the
cookie values only travel through the pipe, never to the screen.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROFILE = ROOT / "data" / "handshake-profile"
SKIP = {"__cf_bm", "_cfuvid", "cf_clearance"}

if not PROFILE.exists():
    sys.exit("No saved Handshake login — run: npm run feed:handshake -- --login")

from patchright.sync_api import sync_playwright

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(user_data_dir=str(PROFILE), channel="chrome", headless=True, chromium_sandbox=True)
    cookies = [
        {k: c[k] for k in ("name", "value", "domain", "path", "expires", "httpOnly", "secure", "sameSite") if k in c}
        for c in ctx.cookies()
        if "joinhandshake.com" in c.get("domain", "") and c.get("name") not in SKIP
    ]
    ctx.close()

if not any(c["name"] in ("hss-global", "_trajectory_session") for c in cookies):
    sys.exit("The saved profile isn't signed in — run: npm run feed:handshake -- --login")
sys.stdout.write(json.dumps(cookies))
print(f"exported {len(cookies)} Handshake cookies", file=sys.stderr)
