# Setup

How this deployment is wired, and how to redo any piece of it. Everything is
free and runs without your computer: GitHub Actions (public repo) does the
scraping, Vercel Hobby serves the site and stores your marks and logins.

## Where each secret lives

| Secret | GitHub Actions | Vercel env | Local `.secrets.env` (git- and vercel-ignored) |
|---|---|---|---|
| `FEED_KEY` — encrypts login-gated feeds + saved logins; signs the runners' session requests | ✓ | ✓ | ✓ |
| `SITE_USERNAME` — the site username (`admin`) | | ✓ | ✓ |
| `SITE_PASSWORD` — the site password | | ✓ | ✓ |
| `SITE_SECRET` — signs login cookies | | ✓ | ✓ |
| `BLOB_READ_WRITE_TOKEN` — private storage (marks, saved logins) | | ✓ (added by the Blob store) | |
| `DATA_REPO` — `tanaymihani/intern-ops` | | ✓ | |
| `HUNTER_API_KEY` — optional, email lookups in the People panel | | ✓ | |
| `HANDSHAKE_SESSION` — your Handshake login (initial copy) | ✓ | | |
| `JOBRIGHT_COOKIE` — optional | ✓ | | |
| `SITE_URL` (variable, not secret) | ✓ | | |

Nothing secret is in the repo: browser profiles, cookies, `.secrets.env`
(not `.env.local` — the Vercel CLI rewrites that one) and plaintext copies
of login-gated feeds are all in `.gitignore` / `.vercelignore`.

## 1. GitHub repo (scrapers)

Public, because Actions minutes are unlimited only for public repos.

```bash
gh repo create intern-ops --public --source . --push
grep ^FEED_KEY= .secrets.env | cut -d= -f2- | tr -d '\n' | gh secret set FEED_KEY
gh variable set SITE_URL --body https://<your-site>.vercel.app
```

One-time backfills (optional): `gh workflow run scan.yml -f since=45`,
`gh workflow run workday.yml -f since=45 -f search_text=intern`.

## 2. Vercel (the website)

```bash
vercel link --yes --project intern-ops
vercel blob create-store intern-ops-state --access private --yes   # adds BLOB_READ_WRITE_TOKEN
for k in FEED_KEY SITE_USERNAME SITE_PASSWORD SITE_SECRET; do
  grep "^$k=" .secrets.env | cut -d= -f2- | tr -d '\n' | vercel env add "$k" production
done
printf tanaymihani/intern-ops | vercel env add DATA_REPO production
vercel deploy --prod --yes
```

The site reads `data/` live from GitHub, so scraper runs never need a
redeploy (`vercel.json` also turns off git-triggered deploys).

**Change the username or password:** `vercel env rm SITE_PASSWORD production`
(or `SITE_USERNAME`), add the new value as above, update `.secrets.env`, then
`vercel deploy --prod --yes`. Changing either signs every device out.

## 3. Handshake

The `handshake` workflow searches Handshake as you every 6 hours: a real
Chrome on a virtual display (Handshake's Cloudflare turns away headless
browsers) with your saved login.

- **Renewing the login** (when the Sources panel says it expired): open the
  site's **Refresh logins** page from any computer and follow the three
  steps there (sign in to Handshake → DevTools → Copy as cURL → paste).
  The login is encrypted into the site's private storage; the next run
  fetches it from `/api/session` with an HMAC proof made from `FEED_KEY`.
- *First-time alternative:* sign in once with
  `npm run feed:handshake -- --login`, then
  `.venv/bin/python scripts/export-handshake-session.py | gh secret set HANDSHAKE_SESSION`.

**Heads-up:** Handshake's and LinkedIn's terms restrict automated access.
The jobs are deliberately light (≈18 Handshake searches every 6 h, 6
LinkedIn searches every 2 h, seconds apart) — keep them that way.

## 4. JobRight (optional)

On jobright.ai set your preferences to **Internship** + ML / data science /
quant, then save your login on the site's **Refresh logins** page (choose
JobRight). The `jobright` workflow uses it from the next run.

## 5. People panel + email lookups

Every card has a **People** button: the posting's hiring team from
Handshake (and recruiters seen on the company's other Handshake postings),
one-click LinkedIn searches (recruiters, the team, Northeastern alumni at
the company), and email help.

Emails work without anything extra as *unverified guesses* in the usual
formats. For real formats and recruiter emails, add a free Hunter.io key
(50 credits/month; a company lookup uses at most 3, and every result is
cached for 60 days so a company never costs twice):

```bash
# hunter.io → sign up (free) → API → copy your key, then:
vercel env add HUNTER_API_KEY production      # paste the key
vercel deploy --prod --yes
```

## 6. Not included: HiringCafe, NextPlay

Both block GitHub's datacenter IPs (Cloudflare challenge / HTTP 403). They
work from a home connection — `node fetch-hiringcafe-feed.mjs` (opens a
Chrome window) and `node fetch-nextplay-feed.mjs` — but aren't scheduled.

## 7. Optional: GitHub sign-in instead of a password

Supabase (free) can replace the password gate with per-user GitHub login:
create a project, run the SQL below, enable the GitHub provider, then set
`SUPABASE_URL` + `SUPABASE_ANON_KEY` in Vercel and remove `SITE_PASSWORD`.

```sql
create table public.job_state (
  user_id uuid not null references auth.users (id) on delete cascade,
  job_key text not null,
  url text, title text, company text,
  viewed_at timestamptz, applied_at timestamptz, hidden_at timestamptz,
  hide_reason text,
  updated_at timestamptz not null default now(),
  primary key (user_id, job_key)
);
alter table public.job_state enable row level security;
create policy "own rows" on public.job_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

## Tuning

- What counts as AI/ML or quant: `lib/classify.mjs` (+ `npm test`).
- Boards to watch: `tracked_companies` in `portals.yml` (`category: quant | ai`
  makes every technical intern role there count — only for quant firms /
  AI-native companies, not banks or big tech).
- Queries: LinkedIn `QUERIES` in `fetch-linkedin-feed.mjs`, Handshake
  `DEFAULT_QUERIES` in `scrape-handshake.py`.
