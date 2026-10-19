# intern-ops

An internship radar for **AI/ML** and **quant** roles. Scrapers run on free
GitHub Actions compute, every source feeds one classifier, and a dashboard on
Vercel shows the result: fresh-first, deduplicated across sources, with
applied/hidden tracking.

Built on [scoutgrid](https://github.com/manavmalavia18/scoutgrid) by Manav
Malavia (the Actions pipeline, HiringCafe/JobRight/NextPlay scrapers and the
dashboard design), which in turn builds on the MIT-licensed
[career-ops](https://github.com/career-ops-hq/career-ops) ATS scanner. This
fork retargets everything from full-time software roles to internships and
adds LinkedIn, Handshake and the community internship lists.

```
 GitHub Actions (public repo = free, unmetered, 24/7)
 ┌─────────────────────────────────────────────────────────────────────┐
 │ GHAL sweep · Workday sweep · tracked boards · YC/a16z · curated     │
 │ lists · Jane Street/SIG/D.E.Shaw · LinkedIn · Handshake (your       │
 │ session, real Chrome on a virtual display) · JobRight · liveness    │
 └──────────────────────────────┬──────────────────────────────────────┘
                                │ commit data/*  (login-gated feeds encrypted)
                                ▼
                  this repo's data/  — read live per request
                                ▼
   Vercel (free): password gate (middleware.js) · api/jobs → lib/classify
   · your applied/hidden marks + refreshed logins in a private Blob store
```

## Sources

| Source | How | Cadence | Needs |
|---|---|---|---|
| Greenhouse / Ashby / Lever | Reverse sweep of ~16k public boards (JSON APIs) | 10 min | — |
| Workday | Reverse sweep of ~13k tenants (CXS API) | 15 min | — |
| Tracked boards | `portals.yml`: quant firms, AI labs, + boards auto-promoted from aggregator leads | 15 min | — |
| YC + a16z portfolios | Seed companies' boards | 3 h | — |
| Simplify · CSCareers · SpeedyApply (AI) · NU FinTech (quant) · JobRight daily lists | Curated GitHub internship lists | 30 min | — |
| LinkedIn | Public (logged-out) job search, experience level = Internship | 2 h, rotating queries | — |
| JobRight | Your recommendations (session cookie) + their companies' boards | 2 h | `JOBRIGHT_COOKIE`, `FEED_KEY` |
| Handshake | Your own session (saved login) in a real Chrome under Xvfb | 6 h | `HANDSHAKE_SESSION` / login saved on the site |
| Jane Street · SIG · D. E. Shaw | Their own careers JSON / pages (internships invisible to title scans) | 30 min | — |
| Liveness | Re-checks scanned postings against their boards; hides filled ones | 6 h | — |

Not included: HiringCafe and NextPlay block GitHub's datacenter IPs outright
(Cloudflare challenge / HTTP 403), so they'd need a residential connection;
their scrapers are still in the repo for local use.

Postings from login-gated sources (Handshake, JobRight recommendations) are
committed only **encrypted** (`*.enc.json`, AES-256-GCM with `FEED_KEY`);
everything else is already-public job data.

## What counts

`lib/classify.mjs` is the single gate every source and the dashboard use:

- **Internship**: intern / internship / co-op / student researcher / summer
  analyst / AI residency…, or the source's own job-type flag.
- **AI/ML**: machine learning, AI, data science, applied/research scientist,
  CV, NLP, LLMs, RL, perception, recommender systems… — or a technical intern
  role at an AI-native company (OpenAI, Anthropic, Databricks, Scale…).
  Generic "Research Intern" titles count at AI firms and big-tech research orgs.
- **Quant**: quant research/trading/dev, trading, strats, market making,
  model risk… — or any non-business intern role at a quant firm (Jane Street,
  Citadel, HRT, Two Sigma, Optiver…).
- Never: recruiting, sales, marketing, PM, legal, design, and so on, even
  when the title says "AI".

Tests: `npm test` (the classifier cases live in `test/classify.test.mjs`).

## Dashboard

Same design as career-ops: Today / Yesterday / Older sections with "X of Y
applied" progress, fresh-first ordering, "new jobs" banner, grace period after
marking applied, hide-with-reason. Internship additions: AI/ML · Quant · All
tracks, season filter (Summer 2027…), "Hide PhD-only", co-op flag, source and
board filters, and a Sources panel showing each scraper's last run.

The site sits behind a username + password (`SITE_USERNAME` / `SITE_PASSWORD`, checked by
`middleware.js` on every page and API call; HttpOnly signed session cookie).
Applied / hidden / opened marks sync across your devices through a private
Vercel Blob (`api/state.js`), with this browser's copy as an offline cache.
Supabase + GitHub sign-in is still supported if you'd rather (SETUP.md).

## Running locally

```
npm install
python3 -m venv .venv && .venv/bin/pip install patchright   # JobRight / Handshake (+ HiringCafe locally)
npm run refresh             # run every scraper once (add -- --workday for the slow Workday sweep)
npm run feed:handshake -- --login   # Handshake, with your own sign-in
npm run dev                 # dashboard on http://localhost:3000
```

Individual sources: `npm run feed:lists`, `feed:quant-sites`, `feed:linkedin`,
`feed:hc`, `feed:nextplay`, `feed:jr`, `scan` (GHAL; `GHAL_SINCE=45` to
backfill), `scan:tracked`, `scan:workday`, `liveness`.

Setup for the full pipeline (repo, secrets, Vercel, logins) is in
[SETUP.md](SETUP.md).

## Layout

- `run*.mjs`, `fetch-*.mjs`, `scrape-*.py`: one entrypoint per source, each
  with its own output, heartbeat and checkpoint files, so concurrent workflow
  runs never fight over a file.
- `lib/`: shared, dependency-free logic (classifier, feed I/O, encryption,
  location/clearance helpers) — the dashboard imports from here too.
- `providers/`, `plugins/`, `seeds/`: career-ops' ATS fetchers.
- `api/`, `public/`: the Vercel dashboard. `dev-server.mjs` runs it locally.
- `.github/workflows/`: one workflow per source on offset schedules.
