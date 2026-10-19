#!/usr/bin/env python3
"""Scrape JobRight jobs via patchright (session cookie required).

Defaults to the UI's "Most Recent" sort (API: sortCondition=FRESHNESS), not
Recommended/Relevance. The /jobs/recommend page is auth-gated (not in SSR HTML);
this loads it with your browser cookies, pulls the list XHR, then resolves each
job's employer apply URL (Ashby/Greenhouse/…).

Setup (one-time): pip install patchright  (uses your installed Google Chrome;
otherwise run `python -m patchright install chromium` and set JR_BROWSER_CHANNEL=chromium)

Auth (pick one):
  A) --login  → opens a visible browser; sign in once; session saved under
     data/jobright-profile/. Later `npm run feed:jr` reuses that profile headless.
  B) Cookie file → data/jobright-cookies.txt or JOBRIGHT_COOKIE=…

Usage:
  .venv/bin/python scrape-jobright.py --login
  .venv/bin/python scrape-jobright.py --login --max 80
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
DEFAULT_COOKIE_FILE = ROOT / "data" / "jobright-cookies.txt"
DEFAULT_PROFILE = ROOT / "data" / "jobright-profile"
DEFAULT_OUT = ROOT / "data" / "jobright-hits.json"
# Keep Chrome's sandbox on (Playwright launches with --no-sandbox by default,
# which weakens isolation and shows a warning bar). Linux CI runners can't
# start the sandbox, so it stays off there unless CHROME_SANDBOX=1.
CHROME_SANDBOX = sys.platform != "linux" or os.environ.get("CHROME_SANDBOX") == "1"

API = "https://swan-api.jobright.ai"
RECOMMEND_URL = "https://jobright.ai/jobs/recommend"

ATS_HOST_RE = re.compile(
    r"(ashbyhq\.com|greenhouse\.io|grnh\.se|myworkdayjobs\.com|lever\.co|"
    r"smartrecruiters\.com|bamboohr\.com|icims\.com|oraclecloud\.com|"
    r"workforcenow\.adp\.com|myjobs\.adp\.com|dayforcehcm\.com|"
    r"applytojob\.com|zohorecruit\.com|comeet\.com|comeet\.co|"
    r"rippling\.com|workable\.com|pinpointhq\.com|jobvite\.com|"
    r"teamtailor\.com|recruitee\.com|csod\.com|successfactors\.com|"
    r"sapsf\.|avature\.net)",
    re.I,
)


def load_cookie_header() -> str:
    env = (os.environ.get("JOBRIGHT_COOKIE") or "").strip()
    if env:
        return env
    path = Path(os.environ.get("JOBRIGHT_COOKIE_FILE") or DEFAULT_COOKIE_FILE)
    if path.is_file():
        text = path.read_text(encoding="utf-8").strip()
        # allow "# comment" lines
        lines = [ln.strip() for ln in text.splitlines() if ln.strip() and not ln.strip().startswith("#")]
        if not lines:
            return ""
        # single Cookie header line, or name=value per line
        if len(lines) == 1 and "=" in lines[0]:
            return lines[0]
        if all("=" in ln and ";" not in ln for ln in lines):
            return "; ".join(lines)
        return lines[0]
    return ""


def cookie_header_to_playwright(cookie_header: str) -> list[dict]:
    cookies: list[dict] = []
    for part in cookie_header.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        name, value = part.split("=", 1)
        name, value = name.strip(), value.strip()
        if not name:
            continue
        for domain in (".jobright.ai",):
            cookies.append(
                {
                    "name": name,
                    "value": value,
                    "domain": domain,
                    "path": "/",
                }
            )
    return cookies


def is_external_apply(url: str | None) -> bool:
    if not url or not isinstance(url, str):
        return False
    try:
        u = urlparse(url.strip())
    except Exception:
        return False
    if u.scheme not in ("http", "https"):
        return False
    host = (u.hostname or "").lower()
    if not host or "jobright.ai" in host:
        return False
    return True


def prefer_apply(job_result: dict) -> str:
    for key in ("originalUrl", "applyLink", "url", "jdUrl", "jobUrl"):
        val = job_result.get(key)
        if is_external_apply(val):
            return val.strip()
    for key in ("originalUrl", "applyLink", "url"):
        val = job_result.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""


def _str_list(val) -> list[str]:
    if not val:
        return []
    if isinstance(val, str):
        return [p.strip() for p in re.split(r"[,;/|]", val) if p.strip()]
    if not isinstance(val, list):
        return []
    out: list[str] = []
    for item in val:
        if isinstance(item, str) and item.strip():
            out.append(item.strip())
        elif isinstance(item, dict):
            name = item.get("skillName") or item.get("name") or item.get("skill") or item.get("title")
            if name and str(name).strip():
                out.append(str(name).strip())
    return out


_SKIP_SKILL = re.compile(
    r"\b(year|degree|bachelor|master|phd|experience|authorized|clearance|benefit|salary|sponsor)\b",
    re.I,
)

_TECH_TOKEN = re.compile(
    r"\b(Python|Java(?:Script)?|TypeScript|React|Node\.js|Next\.js|Go|Golang|Rust|"
    r"Kotlin|Swift|Ruby|Scala|C\+\+|C#|SQL|AWS|GCP|Azure|Kubernetes|Docker|Spark|"
    r"Kafka|Redis|Postgres(?:ql)?|MongoDB|GraphQL|PyTorch|TensorFlow|LangChain|"
    r"LLM|GenAI|Terraform|Airflow|Snowflake|Databricks|Linux|GitHub)\b",
    re.I,
)


def _tools_from_text(*parts: str) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for part in parts:
        if not part:
            continue
        for m in _TECH_TOKEN.finditer(part):
            token = m.group(0)
            key = token.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(token)
    return out[:12]


def _compact_tools(items, *text_parts) -> list[str]:
    short: list[str] = []
    seen: set[str] = set()
    for t in items:
        s = str(t).strip()
        if 2 <= len(s) <= 32 and not _SKIP_SKILL.search(s):
            key = s.lower()
            if key in seen:
                continue
            seen.add(key)
            short.append(s)
    if len(short) >= 2:
        return short[:12]
    return _tools_from_text(*text_parts, *[str(x) for x in items if x])


def _tools_from_jr(jr: dict) -> list[str]:
    collected: list[str] = []
    for key in (
        "skillSummaries",
        "skills",
        "skillList",
        "mustHaveSkills",
        "jdSkills",
        "techStack",
        "highlightSkills",
        "jobSkills",
    ):
        collected.extend(_str_list(jr.get(key)))
    reqs = jr.get("requirements") or []
    if isinstance(reqs, list):
        collected.extend(str(r).strip() for r in reqs if str(r).strip())
    return _compact_tools(
        collected,
        str(jr.get("jobSummary") or ""),
        str(jr.get("jobDescription") or ""),
    )


def _workplace_from_jr(jr: dict) -> str:
    raw = str(jr.get("workModel") or jr.get("workType") or jr.get("workplaceType") or "").strip()
    low = raw.lower().replace("_", " ").replace("-", " ")
    if "remote" in low:
        return "Remote"
    if "hybrid" in low:
        return "Hybrid"
    if "onsite" in low or "on site" in low or "in office" in low or "office" in low:
        return "Onsite"
    return raw[:40]


def _yoe_from_jr(jr: dict) -> str:
    for key in ("yearsOfExperience", "minYearsExperience", "experienceYears", "minYoE"):
        val = jr.get(key)
        if val is None or val == "":
            continue
        m = re.search(r"(\d+(?:\.\d+)?)", str(val))
        if m:
            return f"{m.group(1)}+ YOE"
    sen = str(jr.get("jobSeniority") or "").replace("_", " ").strip()
    if not sen:
        return ""
    return sen.title() if sen.isupper() else sen


def _summary_from_jr(jr: dict) -> str:
    text = str(jr.get("jobSummary") or jr.get("jobDescription") or "").strip()
    if text:
        return text[:320]
    reqs = jr.get("requirements") or jr.get("coreResponsibilities") or []
    if isinstance(reqs, list) and reqs:
        bits = [str(x).strip() for x in reqs if str(x).strip()]
        return "; ".join(bits[:3])[:320]
    if isinstance(reqs, str) and reqs.strip():
        return reqs.strip()[:320]
    return ""


def fields_from_jr(jr: dict, cr: dict | None = None) -> dict:
    cr = cr if isinstance(cr, dict) else {}
    job_id = jr.get("jobId") or ""
    tag = (
        cr.get("companyOneLiner")
        or cr.get("companyTagline")
        or cr.get("companyDesc")
        or cr.get("industry")
        or ""
    )
    return {
        "jobId": str(job_id) if job_id else "",
        "title": jr.get("jobTitle") or "",
        "company": cr.get("companyName") or jr.get("companyName") or "",
        "location": jr.get("jobLocation") or "",
        "postedAt": jr.get("publishTime") or "",
        "postedAtDesc": jr.get("publishTimeDesc") or "",
        "applyUrl": prefer_apply(jr),
        "jobrightUrl": f"https://jobright.ai/jobs/info/{job_id}" if job_id else "",
        "salary": str(jr.get("salaryDesc") or jr.get("salary") or "").strip()[:80],
        "workplace": _workplace_from_jr(jr),
        "yoe": _yoe_from_jr(jr),
        "summary": _summary_from_jr(jr),
        "tools": _tools_from_jr(jr),
        "company_tagline": str(tag).strip()[:120],
    }


def extract_jobs_from_payload(payload: dict) -> list[dict]:
    result = payload.get("result") if isinstance(payload, dict) else None
    if not isinstance(result, dict):
        return []
    job_list = result.get("jobList") or result.get("jobs") or []
    if not isinstance(job_list, list):
        return []
    out = []
    for hit in job_list:
        if not isinstance(hit, dict):
            continue
        jr = hit.get("jobResult") or hit
        cr = hit.get("companyResult") or {}
        if not isinstance(jr, dict):
            continue
        job_id = jr.get("jobId") or hit.get("jobId")
        if not job_id:
            continue
        row = fields_from_jr(jr, cr if isinstance(cr, dict) else {})
        row["jobId"] = str(job_id)
        if not row.get("jobrightUrl"):
            row["jobrightUrl"] = f"https://jobright.ai/jobs/info/{job_id}"
        out.append(row)
    return out


def merge_job(dst: dict, src: dict) -> dict:
    for k, v in src.items():
        if k == "tools":
            if v and not dst.get("tools"):
                dst[k] = v
            continue
        if v and (not dst.get(k) or (k == "applyUrl" and is_external_apply(v) and not is_external_apply(dst.get("applyUrl")))):
            dst[k] = v
    return dst


def _jr_from_detail_payload(payload: dict) -> tuple[dict, dict]:
    detail = payload.get("result") or {}
    if isinstance(detail, dict) and "jobDetail" in detail:
        detail = detail["jobDetail"]
    if not isinstance(detail, dict):
        return {}, {}
    jr = detail.get("jobResult") or detail
    cr = detail.get("companyResult") or {}
    return (jr if isinstance(jr, dict) else {}, cr if isinstance(cr, dict) else {})


# UI sort → list/jobs sortCondition (API wants int; strings like FRESHNESS 400).
# Probed against authenticated /swan/recommend/list/jobs: 1 = chronologically
# newest-first (Most Recent); 0 = relevance mix (Recommended).
SORTS = {
    "recent": 1,       # Most Recent (default)
    "recommended": 0,
    "match": 2,
}


def scrape(
    max_jobs: int,
    scroll_rounds: int,
    sort: str = "recent",
    login: bool = False,
    profile_dir: Path | None = None,
) -> dict:
    cookie_header = load_cookie_header()
    profile = Path(profile_dir or DEFAULT_PROFILE)
    if not login and not cookie_header and not profile.exists():
        print(
            "No JobRight session.\n"
            "  Easiest:  .venv/bin/python scrape-jobright.py --login\n"
            f"  Or save Cookie header to {DEFAULT_COOKIE_FILE}",
            file=sys.stderr,
        )
        sys.exit(2)

    try:
        from patchright.sync_api import sync_playwright
    except ImportError:
        print("patchright not installed. Run:  pip install patchright", file=sys.stderr)
        sys.exit(1)

    sort_key = (sort or "recent").lower().strip()
    sort_condition = SORTS.get(sort_key)
    if sort_condition is None:
        print(f"Unknown --sort {sort!r}. Use: {', '.join(SORTS)}", file=sys.stderr)
        sys.exit(2)

    cookies = cookie_header_to_playwright(cookie_header) if cookie_header else []
    if login:
        profile.mkdir(parents=True, exist_ok=True)
    collected: dict[str, dict] = {}
    api_errors: list[str] = []

    def wait_for_login(page) -> bool:
        print(
            "\n>>> Browser ready. Log into JobRight if needed, open Jobs → Recommended.\n"
            ">>> Waiting for session (up to 5 min)…\n",
            flush=True,
        )
        probes = [
            f"{API}/swan/recommend/list/jobs?refresh=true&sortCondition={sort_condition}&position=0&count=1",
            f"{API}/swan/recommend/list/jobs?refresh=true&sortCondition=0&position=0&count=1",
            f"{API}/swan/auth/newinfo",
        ]
        for i in range(150):
            # DOM signal: feed cards or profile, not marketing SIGN IN wall
            try:
                body = page.locator("body").inner_text(timeout=2_000)
            except Exception:
                body = ""
            body_u = body.upper()
            if ("GOOD MATCH" in body_u or "FAIR MATCH" in body_u or "ASK ORION" in body_u) and "SIGN IN" not in body_u[:800]:
                print(">>> Feed visible — scraping Most Recent…", flush=True)
                return True

            for probe in probes:
                try:
                    resp = page.request.get(
                        probe,
                        headers={
                            "accept": "application/json",
                            "referer": RECOMMEND_URL,
                            "origin": "https://jobright.ai",
                        },
                    )
                    if resp.status != 200:
                        continue
                    payload = resp.json()
                    if payload.get("success"):
                        print(">>> Logged in — scraping Most Recent…", flush=True)
                        return True
                except Exception:
                    continue

            if i % 15 == 0 and i:
                print(f"… still waiting for login ({i * 2}s)", flush=True)
            try:
                page.wait_for_timeout(2000)
            except Exception:
                break
        api_errors.append("login timeout — sign in inside the opened browser and re-run --login")
        return False

    def page_action(page):
        if login and not wait_for_login(page):
            return

        # Prefer the authenticated list API (same session as the page).
        position = 0
        page_size = 20
        while len(collected) < max_jobs:
            refresh = "true" if position == 0 else "false"
            url = (
                f"{API}/swan/recommend/list/jobs"
                f"?refresh={refresh}&sortCondition={sort_condition}"
                f"&position={position}&count={page_size}"
            )
            try:
                resp = page.request.get(
                    url,
                    headers={
                        "accept": "application/json",
                        "referer": RECOMMEND_URL,
                        "origin": "https://jobright.ai",
                    },
                )
            except Exception as exc:  # noqa: BLE001
                api_errors.append(f"list/jobs pos={position}: {exc}")
                break
            if resp.status == 401:
                api_errors.append("list/jobs → 401 Cookie not found / expired — refresh data/jobright-cookies.txt")
                break
            try:
                payload = resp.json()
            except Exception as exc:  # noqa: BLE001
                api_errors.append(f"list/jobs JSON: {exc}")
                break
            if not payload.get("success"):
                api_errors.append(payload.get("errorMsg") or f"list/jobs success=false ({resp.status})")
                break
            batch = extract_jobs_from_payload(payload)
            if not batch:
                break
            for job in batch:
                collected[job["jobId"]] = merge_job(collected.get(job["jobId"], {}), job)
            position += len(batch)
            if len(batch) < page_size:
                break

        # Resolve employer apply URLs (list payload often wraps jobright.ai links)
        # and fill summary when the list row was thin. Skills/salary come from the list.
        need = [
            j for j in collected.values()
            if not is_external_apply(j.get("applyUrl")) or not j.get("summary")
        ]
        for job in need[:max_jobs]:
            jid = job["jobId"]
            for path in (
                f"{API}/swan/job/detail?jobId={jid}",
                f"{API}/swan/share/job/{jid}",
            ):
                try:
                    resp = page.request.get(
                        path,
                        headers={
                            "accept": "application/json",
                            "referer": f"https://jobright.ai/jobs/info/{jid}",
                            "origin": "https://jobright.ai",
                        },
                    )
                except Exception:
                    continue
                if resp.status != 200:
                    continue
                try:
                    payload = resp.json()
                except Exception:
                    continue
                jr, cr = _jr_from_detail_payload(payload)
                if not jr:
                    continue
                merge_job(job, fields_from_jr(jr, cr))
                if is_external_apply(job.get("applyUrl")) and job.get("summary"):
                    break

        # Scroll UI as a backup signal / keep session warm
        for _ in range(max(0, scroll_rounds)):
            page.mouse.wheel(0, 2400)
            page.wait_for_timeout(400)

    channel = os.environ.get("JR_BROWSER_CHANNEL", "chrome")
    xhr_re = re.compile(r"swan-api\.jobright\.ai/swan/(recommend|job|share)")
    captured: list = []
    html = ""
    use_profile = login or profile.exists()
    with sync_playwright() as p:
        launch = {"headless": not login, "chromium_sandbox": CHROME_SANDBOX}
        if channel and channel != "chromium":
            launch["channel"] = channel
        if use_profile:
            # Reuse the signed-in profile. --login is headed; later runs headless.
            ctx = p.chromium.launch_persistent_context(user_data_dir=str(profile), no_viewport=True, **launch)
        else:
            browser = p.chromium.launch(**launch)
            ctx = browser.new_context()
        try:
            if cookies:
                ctx.add_cookies(cookies)
            ctx.set_extra_http_headers({"accept-language": "en-US,en;q=0.9"})
            page = ctx.pages[0] if ctx.pages else ctx.new_page()

            def on_response(resp):
                if xhr_re.search(resp.url):
                    try:
                        captured.append(resp.json())
                    except Exception:
                        pass

            page.on("response", on_response)
            # JobRight keeps sockets open, so never wait for network idle.
            page.goto(RECOMMEND_URL, wait_until="domcontentloaded", timeout=300_000 if login else 60_000)
            page.wait_for_timeout(2_000)
            page_action(page)
            try:
                html = page.content()
            except Exception:
                html = ""
        finally:
            ctx.close()

    # Fold any captured XHR job lists (in case list/jobs path differs).
    for body in captured:
        if isinstance(body, dict):
            for job in extract_jobs_from_payload(body):
                collected[job["jobId"]] = merge_job(collected.get(job["jobId"], {}), job)

    jobs = list(collected.values())[:max_jobs]
    external = sum(1 for j in jobs if is_external_apply(j.get("applyUrl")))
    atsish = sum(1 for j in jobs if j.get("applyUrl") and ATS_HOST_RE.search(j["applyUrl"]))

    return {
        "fetchedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "source": "jobright",
        "sort": sort_key,
        "sortCondition": sort_condition,
        "recommendUrl": RECOMMEND_URL,
        "jobCount": len(jobs),
        "externalApplyCount": external,
        "atsApplyCount": atsish,
        "apiErrors": api_errors,
        "loginWallLikely": "SIGN IN" in (html or "") and "GOOD MATCH" not in (html or "").upper(),
        "jobs": jobs,
    }


def _pause_path() -> Path:
    return ROOT / "data" / "jr-pause.json"


def jr_pause_active() -> str:
    path = _pause_path()
    if not path.is_file():
        return ""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        until = raw.get("until") or ""
        ts = None
        from datetime import datetime, timezone
        try:
            ts = datetime.fromisoformat(until.replace("Z", "+00:00"))
        except Exception:
            return ""
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        if ts.timestamp() * 1000 <= datetime.now(timezone.utc).timestamp() * 1000:
            return ""
        reason = raw.get("reason") or "JobRight account pause"
        return f"skip JobRight — paused until {until} ({reason})"
    except Exception:
        return ""


def main() -> None:
    paused = jr_pause_active()
    if paused:
        print(paused, file=sys.stderr)
        sys.exit(0)
    ap = argparse.ArgumentParser(description="Scrape JobRight Most Recent feed (Scrapling)")
    ap.add_argument("--max", type=int, default=60, help="Max jobs to collect (default 60)")
    ap.add_argument("--scroll", type=int, default=3, help="UI scroll rounds after API pull")
    ap.add_argument(
        "--sort",
        default="recent",
        choices=sorted(SORTS.keys()),
        help="Sort mode (default: recent = UI Most Recent / FRESHNESS)",
    )
    ap.add_argument(
        "--login",
        action="store_true",
        help="Open a visible browser; log in once (no DevTools cookie copy)",
    )
    ap.add_argument(
        "--profile",
        type=Path,
        default=DEFAULT_PROFILE,
        help="Browser profile dir for --login (default data/jobright-profile)",
    )
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT, help="Output JSON path")
    args = ap.parse_args()

    result = scrape(
        max_jobs=args.max,
        scroll_rounds=args.scroll,
        sort=args.sort,
        login=args.login,
        profile_dir=args.profile,
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2), encoding="utf-8")

    print(
        f"Wrote {args.out} (sort={result['sort']}/{result['sortCondition']}, "
        f"{result['jobCount']} jobs, {result['externalApplyCount']} external apply URLs, "
        f"{result['atsApplyCount']} known ATS)"
    )
    if result["apiErrors"]:
        print("API notes:", file=sys.stderr)
        for e in result["apiErrors"]:
            print(f"  · {e}", file=sys.stderr)
    if result["jobCount"] == 0:
        sys.exit(1)
    if result["externalApplyCount"] == 0:
        print(
            "Warning: no employer apply URLs resolved — cookie may lack access, or JobRight gated originalUrl.",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
