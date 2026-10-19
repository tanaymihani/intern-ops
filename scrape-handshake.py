#!/usr/bin/env python3
"""Search Handshake as you, from inside your own logged-in Handshake tab.

Opens a real (visible) Chrome window on a dedicated profile under
data/handshake-profile/. The first time, run with --login and sign in through
your school's SSO; the session is kept in that profile for later runs. Each run
issues the same GraphQL `JobSearchQuery` the job-search page sends (same
origin, same cookies, same CSRF token), newest first, internships/co-ops only.

Handshake's Terms of Service restrict automated access, and this runs on your
own student account — keep it low-volume (the defaults are ~18 requests per
run, a few seconds apart) and run it occasionally, not on a tight loop.

  .venv/bin/python scrape-handshake.py --login            # first time: sign in
  .venv/bin/python scrape-handshake.py --out data/hs-hits.tmp.json

Exit codes: 0 ok · 2 not signed in (re-run with --login) · 1 error.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_PROFILE = ROOT / "data" / "handshake-profile"
# Keep Chrome's sandbox on (Playwright launches with --no-sandbox by default,
# which weakens isolation and shows a warning bar). Linux CI runners can't
# start the sandbox, so it stays off there unless CHROME_SANDBOX=1.
CHROME_SANDBOX = sys.platform != "linux" or os.environ.get("CHROME_SANDBOX") == "1"

DEFAULT_QUERIES = [
    "machine learning",
    "artificial intelligence",
    "data science",
    "deep learning",
    "computer vision",
    "research scientist",
    "quantitative",
    "quant trading",
    "algorithmic trading",
]

JOB_SEARCH_QUERY = """
query JobSearchQuery($first: Int, $after: String, $input: JobSearchInput) {
  jobSearch(first: $first, after: $after, input: $input) {
    totalCount
    edges {
      node {
        id
        isPromoted
        shouldPromote
        job {
          id title createdAt applyStart expirationDate
          remote onSite hybrid workLocationType
          locations { name displayName city state country }
          employer { id name }
          jobType { id name behaviorIdentifier }
          employmentType { id name behaviorIdentifier }
          salaryType { behaviorIdentifier }
          salaryRange { min max currency paySchedule { behaviorIdentifier } }
        }
      }
    }
  }
}
"""

FILTER_IDS_QUERY = "query JobSearchFilterIds { jobTypes { id name behaviorIdentifier } }"

# Same query Handshake's profile pages send; returns the user only when the
# session is genuinely signed in.
CURRENT_USER_QUERY = "query CurrentUserProbe { currentUser { id userType } }"

# Runs inside the Handshake page: same-origin fetch, exactly like the site's
# own Apollo client (cookies via credentials, CSRF from the page's meta tag).
IN_PAGE_GRAPHQL = """
async ({ operationName, query, variables }) => {
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
  const res = await fetch('/hs/graphql', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      accept: '*/*',
      'x-csrf-token': csrf,
      'graphql-operation-type': 'query',
      'apollographql-client-name': 'consumer',
      'apollographql-client-version': '1.2',
      'x-request-id': crypto.randomUUID(),
    },
    body: JSON.stringify({ operationName, variables, query }),
  });
  const text = await res.text();
  return { status: res.status, cfMitigated: res.headers.get('cf-mitigated') || '', text: text.slice(0, 2_000_000) };
}
"""


class NotSignedIn(Exception):
    pass


def minimize(page) -> None:
    """Minimize the window (macOS can clamp an off-screen position back into view)."""
    try:
        cdp = page.context.new_cdp_session(page)
        info = cdp.send("Browser.getWindowForTarget")
        cdp.send("Browser.setWindowBounds", {"windowId": info["windowId"], "bounds": {"windowState": "minimized"}})
    except Exception:
        pass


def offset_cursor(offset: int) -> str:
    return base64.b64encode(str(offset).encode()).decode()


def signed_in(page) -> bool:
    """True only when Handshake's own API answers `currentUser` for this tab."""
    url = (page.url or "").lower()
    if "joinhandshake.com" not in url or any(seg in url for seg in ("/login", "/access", "/sso", "/saml")):
        return False
    try:
        r = page.evaluate(IN_PAGE_GRAPHQL, {"operationName": "CurrentUserProbe", "query": CURRENT_USER_QUERY, "variables": {}})
        if r.get("status") != 200:
            return False
        user = (json.loads(r.get("text") or "{}").get("data") or {}).get("currentUser") or {}
        return bool(user.get("id"))
    except Exception:
        return False


def gql(page, operation: str, query: str, variables: dict) -> dict:
    r = page.evaluate(IN_PAGE_GRAPHQL, {"operationName": operation, "query": query, "variables": variables})
    if r["status"] in (401,) or (r["status"] == 403 and "not_logged_in" in r["text"]):
        raise NotSignedIn("Handshake session expired")
    if r["cfMitigated"]:
        raise RuntimeError("Cloudflare challenge on /hs/graphql — open Handshake in this window once, then retry")
    if r["status"] != 200:
        raise RuntimeError(f"/hs/graphql HTTP {r['status']}: {r['text'][:200]}")
    payload = json.loads(r["text"])
    if payload.get("errors") and not payload.get("data"):
        raise RuntimeError(f"GraphQL errors: {json.dumps(payload['errors'])[:300]}")
    return payload.get("data") or {}


def intern_type_ids(page) -> list[str]:
    """Internship + co-op job-type IDs (co-op's numeric id isn't published)."""
    try:
        data = gql(page, "JobSearchFilterIds", FILTER_IDS_QUERY, {})
        ids = [t["id"] for t in data.get("jobTypes") or [] if t.get("behaviorIdentifier") in ("INTERNSHIP", "CO_OP")]
        if ids:
            return ids
    except NotSignedIn:
        raise
    except Exception as err:  # noqa: BLE001
        print(f"job-type lookup failed ({err}); using Internship only", file=sys.stderr)
    return ["3"]


def scrape(args) -> dict:
    from patchright.sync_api import sync_playwright

    host = os.environ.get("HANDSHAKE_HOST", args.host).strip().rstrip("/")
    origin = host if host.startswith("http") else f"https://{host}"
    profile = Path(args.profile)
    profile.mkdir(parents=True, exist_ok=True)
    cutoff_ms = (time.time() - args.days * 86400) * 1000
    hits: dict[str, dict] = {}
    per_query: dict[str, int] = {}

    with sync_playwright() as p:
        launch = {"headless": False, "no_viewport": True, "chromium_sandbox": CHROME_SANDBOX}
        channel = os.environ.get("HS_BROWSER_CHANNEL", "chrome")
        if channel != "chromium":
            launch["channel"] = channel
        if not args.login:
            # Same trick as the HiringCafe scraper: a real headed window, parked off-screen.
            launch["args"] = ["--window-position=-32000,-32000", "--window-size=1000,800"]
        ctx = p.chromium.launch_persistent_context(user_data_dir=str(profile), **launch)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            page.goto(f"{origin}/job-search?jobType=3&sort=posted_date_desc", wait_until="domcontentloaded", timeout=90_000)
            if not args.login:
                minimize(page)
            page.wait_for_timeout(3_000)
            if not signed_in(page):
                if not args.login:
                    raise NotSignedIn("not signed in")
                print("\n>>> Sign in to Handshake in the Chrome window that just opened (Northeastern SSO).", flush=True)
                print(">>> Leave the window open when you're done — it continues on its own. Waiting up to 10 minutes…\n", flush=True)
                deadline = time.time() + 600
                while time.time() < deadline:
                    page.wait_for_timeout(2_000)
                    if "job-search" not in (page.url or "") and signed_in(page):
                        page.goto(f"{origin}/job-search?jobType=3&sort=posted_date_desc", wait_until="domcontentloaded", timeout=90_000)
                        page.wait_for_timeout(2_000)
                    if signed_in(page):
                        break
                else:
                    raise NotSignedIn("login timed out")
                print(">>> Signed in — session saved for future runs. Searching for internships now…", flush=True)

            type_ids = intern_type_ids(page)
            for q in args.queries:
                kept = 0
                for page_no in range(args.pages):
                    variables = {
                        "first": 25,
                        "after": offset_cursor(page_no * 25),
                        "input": {
                            "filter": {"query": q, "jobTypeIds": type_ids},
                            "sort": {"field": "POST_DATE", "direction": "DESC"},
                            "channel": "JOB_SEARCH_CHANNEL",
                        },
                    }
                    data = gql(page, "JobSearchQuery", JOB_SEARCH_QUERY, variables)
                    edges = (data.get("jobSearch") or {}).get("edges") or []
                    older = 0
                    for e in edges:
                        node = e.get("node") or {}
                        job = node.get("job") or {}
                        if not job.get("id"):
                            continue
                        posted = job.get("applyStart") or job.get("createdAt") or ""
                        try:
                            from datetime import datetime
                            posted_ms = datetime.fromisoformat(posted.replace("Z", "+00:00")).timestamp() * 1000
                        except Exception:
                            posted_ms = None
                        if posted_ms and posted_ms < cutoff_ms and not node.get("isPromoted"):
                            older += 1
                            continue
                        job["_promoted"] = bool(node.get("isPromoted") or node.get("shouldPromote"))
                        hits[str(job["id"])] = job
                        kept += 1
                    time.sleep(args.sleep)
                    # Newest-first: a page that's mostly past the cutoff ends this query.
                    if len(edges) < 25 or older > len(edges) // 2:
                        break
                per_query[q] = kept
                print(f"Handshake [{q}] kept={kept}", file=sys.stderr, flush=True)
        finally:
            ctx.close()

    return {
        "ok": True,
        "host": origin,
        "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "days": args.days,
        "perQuery": per_query,
        "count": len(hits),
        "jobs": list(hits.values()),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Handshake internship search from your own logged-in session")
    ap.add_argument("--login", action="store_true", help="open a visible window and wait for you to sign in")
    ap.add_argument("--host", default="app.joinhandshake.com", help="Handshake host (or HANDSHAKE_HOST env)")
    ap.add_argument("--profile", default=str(DEFAULT_PROFILE))
    ap.add_argument("--queries", nargs="*", default=DEFAULT_QUERIES)
    ap.add_argument("--pages", type=int, default=2, help="25-result pages per query (default 2)")
    ap.add_argument("--days", type=int, default=21, help="ignore postings older than this")
    ap.add_argument("--sleep", type=float, default=3.0, help="seconds between requests")
    ap.add_argument("--out", default=str(ROOT / "data" / "hs-hits.tmp.json"))
    args = ap.parse_args()
    args.pages = max(1, min(4, args.pages))
    args.sleep = max(1.5, args.sleep)
    try:
        payload = scrape(args)
    except NotSignedIn as err:
        print(f"Handshake: {err} — run with --login", file=sys.stderr)
        return 2
    except Exception as err:  # noqa: BLE001
        print(f"Handshake scrape failed: {err}", file=sys.stderr)
        return 1
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload), encoding="utf-8")
    print(json.dumps({"ok": True, "count": payload["count"], "perQuery": payload["perQuery"], "out": str(out)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
