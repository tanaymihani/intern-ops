#!/usr/bin/env python3
"""Scrape Hiring Cafe SSR search via patchright (headed Chrome).

Cloudflare blocks node fetch and Playwright headless after ~1 page.
Patchright headed paginates the same __NEXT_DATA__ the HTTP path used to read.

  .venv-scrapling/bin/python scripts/scrape-hiringcafe.py --pages 50 --days 2 --out data/hc-hits.tmp.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_PROFILE = ROOT / "data" / "hiringcafe-profile"
DEFAULT_OUT = ROOT / "data" / "hc-hits.tmp.json"
ORIGIN = "https://hiringcafe.com"

NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>',
    re.S,
)


def search_state(query: str, days: int) -> dict:
    return {
        "locations": [{
            "formatted_address": "United States",
            "types": ["country"],
            "geometry": {"location": {"lat": 33.7485, "lon": -84.3871}},
            "id": "user_country",
            "address_components": [{
                "long_name": "United States",
                "short_name": "US",
                "types": ["country"],
            }],
            "options": {
                "flexible_regions": ["anywhere_in_continent", "anywhere_in_world"],
            },
        }],
        "searchQuery": query,
        "dateFetchedPastNDays": days,
        "securityClearances": ["None"],
        "sortBy": "date",
    }


def url_for(state: dict, page: int) -> str:
    qs = {"searchState": json.dumps(state, separators=(",", ":"))}
    if page > 0:
        qs["page"] = str(page)
    return ORIGIN + "/?" + urllib.parse.urlencode(qs)


def props_from_html(html: str):
    m = NEXT_DATA_RE.search(html or "")
    if not m:
        return None
    try:
        return json.loads(m.group(1)).get("props", {}).get("pageProps")
    except Exception:
        return None


def scrape(pages: int, days: int, query: str, sleep_s: float, profile: Path) -> dict:
    from patchright.sync_api import sync_playwright

    state = search_state(query, days)
    profile.mkdir(parents=True, exist_ok=True)
    hits: list = []
    seen: set[str] = set()
    total = None
    pages_fetched = 0
    truncated = False

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(profile),
            channel="chrome",
            headless=False,
            no_viewport=True,
            args=[
                "--window-position=-32000,-32000",
                "--window-size=800,600",
            ],
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            def minimize():
                try:
                    cdp = page.context.new_cdp_session(page)
                    info = cdp.send("Browser.getWindowForTarget")
                    cdp.send(
                        "Browser.setWindowBounds",
                        {
                            "windowId": info["windowId"],
                            "bounds": {"windowState": "minimized"},
                        },
                    )
                except Exception:
                    pass

            for i in range(pages):
                t0 = time.time()
                page.goto(url_for(state, i), wait_until="domcontentloaded", timeout=60_000)
                if i == 0:
                    minimize()
                page.wait_for_selector("#__NEXT_DATA__", state="attached", timeout=45_000)
                pp = props_from_html(page.content())
                if not pp:
                    raise RuntimeError(f"hiringcafe: missing __NEXT_DATA__ on page {i}")
                if total is None:
                    raw_total = pp.get("ssrTotalCount")
                    if isinstance(raw_total, (int, float)) and raw_total == raw_total:
                        total = int(raw_total)
                batch = pp.get("ssrHits") or []
                added = 0
                for h in batch:
                    if not isinstance(h, dict) or h.get("is_expired"):
                        continue
                    url = (h.get("apply_url") or "").strip().lower()
                    if not url or url in seen:
                        continue
                    seen.add(url)
                    hits.append(h)
                    added += 1
                pages_fetched = i + 1
                print(
                    f"HC [{query}] page {pages_fetched}/{pages} "
                    f"hits={len(batch)} new={added} kept={len(seen)}"
                    + (f"/{total}" if total is not None else "")
                    + f" {int((time.time() - t0) * 1000)}ms",
                    file=sys.stderr,
                    flush=True,
                )
                is_last = (
                    len(batch) == 0
                    or added == 0
                    or (total is not None and len(seen) >= total)
                )
                if is_last:
                    truncated = False
                    break
                if i + 1 >= pages:
                    truncated = True
                    break
                time.sleep(sleep_s)
            else:
                truncated = total is None or len(seen) < total
        finally:
            ctx.close()

    return {
        "ok": True,
        "query": query,
        "days": days,
        "pagesFetched": pages_fetched,
        "truncated": truncated,
        "totalCount": total,
        "count": len(hits),
        "hits": hits,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", type=int, default=50)
    ap.add_argument("--days", type=int, default=2)
    ap.add_argument("--query", default="software engineer")
    ap.add_argument("--sleep", type=float, default=1.5)
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--profile", default=str(DEFAULT_PROFILE))
    args = ap.parse_args()
    pages = max(1, min(80, args.pages))
    days = max(1, min(7, args.days))
    try:
        payload = scrape(pages, days, args.query, max(0.4, args.sleep), Path(args.profile))
    except Exception as err:
        print(f"HC scrape failed: {err}", file=sys.stderr)
        return 1
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload), encoding="utf-8")
    print(json.dumps({
        "ok": True,
        "count": payload["count"],
        "pagesFetched": payload["pagesFetched"],
        "truncated": payload["truncated"],
        "totalCount": payload["totalCount"],
        "out": str(out),
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
