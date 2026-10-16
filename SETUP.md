# Setup

Everything below is one-time. Steps 1–3 get you a working site; 4–7 add the
sources that need your network or your logins.

## 1. GitHub repo (scrapers)

The repo must be **public**: GitHub Actions minutes are unlimited for public
repos, and the sweeps run every 5–15 minutes. Nothing sensitive is committed —
scraped postings are public, and login-gated ones (Handshake, JobRight) are
committed encrypted.

```bash
gh repo create intern-ops --public --source . --push
```

Generate the feed-encryption key and store it as a secret (keep a copy —
Vercel needs the same value, and a local `.env.local` lets your Handshake runs
encrypt):

```bash
FEED_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
gh secret set FEED_KEY --body "$FEED_KEY"
echo "FEED_KEY=$FEED_KEY" > .env.local        # git-ignored
```

Workflows start on their own schedules. To backfill the current recruiting
cycle right away:

```bash
gh workflow run lists.yml
gh workflow run scan.yml -f since=45
gh workflow run tracked.yml -f since=45
gh workflow run workday.yml -f since=45 -f search_text=intern
```

## 2. Vercel (dashboard)

```bash
vercel link --yes --project intern-ops
vercel env add DATA_REPO production      # e.g. tanaymihani/intern-ops
vercel env add FEED_KEY production       # same value as the GitHub secret
vercel --prod
```

The dashboard reads `data/` straight from GitHub on each request, so it never
needs redeploying when scrapers run. (`vercel.json` turns off git-triggered
deploys; without that, every scraper commit would redeploy the site.)

## 3. Check it

Open the site → **Sources** (top bar) shows each scraper's last run. Locally:
`npm run dev` serves the same dashboard from your `./data`.

## 4. Tailscale exit node (LinkedIn, HiringCafe, NextPlay, JobRight)

These sites block or rate-limit GitHub's datacenter IPs. Same fix as
scoutgrid: route those workflows through your Mac's home connection.

1. Tailscale app on your Mac → **Run as Exit Node**. In the
   [admin console](https://login.tailscale.com/admin/machines), approve it
   (machine ⋯ → Edit route settings → Use as exit node).
2. Note the Mac's Tailscale IP (`100.x.y.z`) in the admin console.
3. Create an auth key: Settings → Keys → **Reusable** + **Ephemeral**.
4. Save both:
   ```bash
   gh secret set TAILSCALE_AUTHKEY        # paste tskey-auth-…
   gh variable set TAILSCALE_EXIT_NODE --body 100.x.y.z
   ```

Those workflows only connect when the secret exists; without it they still
run, and the Sources panel shows "blocked" if a site refuses the runner. Your
Mac needs to be awake and online for exit-node runs to work.

## 5. JobRight (your recommendations)

1. On [jobright.ai](https://jobright.ai), set your job preferences to
   **Internship** with ML / data science / quant roles.
2. DevTools → Network → filter `swan` → refresh → right-click a
   `swan-api.jobright.ai` request → **Copy as cURL**.
3. `node scripts/set-cookie.mjs jobright` (reads the clipboard) — or use the
   site's **Refresh login** page (step 7).

Re-do this when the Sources panel says JobRight needs sign-in.

## 6. Handshake (runs on your Mac)

Handshake sits behind Cloudflare and Northeastern SSO, and its sessions expire
after a couple of idle hours, so it runs on your machine in a real Chrome
window, not on Actions.

```bash
python3 -m venv .venv && .venv/bin/pip install patchright
npm run feed:handshake -- --login     # sign in once; the session is kept in data/handshake-profile/
npm run feed:handshake -- --push      # later: fetch + commit the encrypted feed
```

Set `HANDSHAKE_HOST=northeastern.joinhandshake.com` if your school's host
behaves differently from `app.joinhandshake.com`.

**Heads-up:** Handshake's Terms of Service restrict automated access, and this
uses your own student account. The script is deliberately light (about 18
requests per run, a few seconds apart) and only runs when you run it — keep it
that way rather than putting it on a tight schedule.

## 7. Optional extras

**Refresh-login page** (paste a new JobRight cookie from your phone):
create a fine-grained GitHub token for this repo with *Secrets: read/write*
and *Actions: read/write*, then
```bash
vercel env add GH_TOKEN production
vercel env add DASHBOARD_PASSWORD production
vercel --prod
```

**Cross-device applied/hidden sync** (like career-ops' GitHub sign-in): by
default your applied/hidden marks live in this browser. To sync them:

1. Create a [Supabase](https://supabase.com) project. In the SQL editor run:
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
2. Authentication → Providers → **GitHub**: create a GitHub OAuth app whose
   callback URL is `https://<project>.supabase.co/auth/v1/callback`, and paste
   its client ID/secret. Add your site URL under Authentication → URL
   Configuration.
3. `vercel env add SUPABASE_URL production` and `vercel env add SUPABASE_ANON_KEY production`, then `vercel --prod`.

The site then asks for GitHub sign-in and stores marks per user.

**Custom domain:** `vercel domains add jobs.example.com`.

## Tuning

- What counts as AI/ML or quant: `lib/classify.mjs` (+ `npm test`).
- Extra boards to watch: `tracked_companies` in `portals.yml`
  (`category: quant | ai` makes every technical intern role there count).
- LinkedIn queries: `QUERIES` in `fetch-linkedin-feed.mjs`; HiringCafe:
  `lib/hiringcafe-query.mjs`; Handshake: `DEFAULT_QUERIES` in `scrape-handshake.py`.
