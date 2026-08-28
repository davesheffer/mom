# Yad2 Apartment Alerts

> ## ⚠️ The scraper does not work, and the hourly schedule is disabled
>
> **Use Yad2's own built-in alerts instead** — save a search on
> [yad2.co.il](https://www.yad2.co.il/realestate/rent) or in the Yad2 app and
> turn on alerts. It's free, official, and fires up to every 15 minutes, which
> is better than the hourly check this repo was built to do.
>
> ### Why
>
> Yad2 is protected by **Radware Bot Manager**. A probe run from GitHub Actions
> on 2026-08-28 (`scripts/probe.ts`, still runnable via the "Probe Yad2"
> workflow) tried seven different access strategies:
>
> | Strategy | Result |
> |---|---|
> | HTML page, browser headers | redirected to `validate.perfdrive.com` — CAPTCHA |
> | HTML page, no headers | redirected to `validate.perfdrive.com` — CAPTCHA |
> | `gw.yad2.co.il/realestate-feed/rent` | CAPTCHA |
> | `gw.yad2.co.il/realestate-feed/rent/map` | CAPTCHA |
> | `gw.yad2.co.il/feed-search-legacy/...` | CAPTCHA |
> | `www.yad2.co.il/api/pre-load/getFeedIndex/...` | "Radware Bot Manager Block" |
> | `www.yad2.co.il/api/feed/get` | Radware loader page |
>
> Seven for seven. This isn't a parsing bug or a wrong URL — every route is
> behind the same commercial bot-protection product, which fingerprints the
> browser and the network. Requests from CI/cloud IP ranges are exactly what it
> exists to stop, so a headless browser here would very likely be blocked too.
>
> Getting past it would mean deliberately defeating an access control the site
> owner deployed on purpose — browser-fingerprint spoofing, residential proxy
> rotation, or a paid third-party service whose whole business is doing that.
> That's not worth building for a personal apartment search when the site
> already offers the exact feature for free.
>
> ### What still works here
>
> The email delivery, deduplication, scheduling and diagnostics are all built
> and verified — only the Yad2 fetch fails. If you point `lib/yad2.ts` at a
> data source that actually answers, everything downstream works as-is.


Checks Yad2 every hour for rental apartments near **Kfar HaRif** (≤ ₪5500/month,
within ~20km) and emails you anything new.

There are two ways to run it. **Pick one:**

| | Option A — GitHub only | Option B — Vercel |
|---|---|---|
| Accounts needed | GitHub (you have it) | GitHub + Vercel + Upstash |
| Setup steps | Add 2 secrets | Sign up ×2, import repo, set 6 env vars |
| Cost | Free | Free |
| Gives you a web URL | No | Yes |

**Option A is the recommended path** unless you specifically want the app
reachable at a URL. It does exactly the same thing, and the hourly schedule
runs on GitHub Actions either way — Vercel's own Cron Jobs only fire once a
day on the free Hobby plan, so Vercel can't do the hourly part by itself
regardless.

---

## Option A — GitHub only (no Vercel, no Upstash)

Everything runs inside GitHub Actions. Listings already alerted on are
remembered in `.state/seen.json`, which the workflow commits back to the repo
after each run.

### Setup

1. **Get a Gmail app password** (this is what lets the job send you email):
   - Turn on 2-Step Verification: https://myaccount.google.com/security
   - Create an app password: https://myaccount.google.com/apppasswords
     (app: "Mail", device: "Other" → name it e.g. `yad2-alerts`)
   - Google shows a 16-character password once — copy it.

2. **Add two repo secrets.** In this repo on GitHub go to
   **Settings → Secrets and variables → Actions → New repository secret**:
   - `GMAIL_USER` → your Gmail address
   - `GMAIL_APP_PASSWORD` → the 16-character app password (not your normal
     Gmail password)

   Optionally also add `ALERT_EMAIL_TO` if you want the alerts delivered
   somewhere other than that same Gmail address.

3. **Run it once by hand to check it works.** Go to the **Actions** tab →
   "Yad2 hourly check" → **Run workflow**. Open the run and read the log — it
   prints how many listings it found and how many were new.

That's it. From then on it runs every hour on its own.

> Leave the `YAD2_CHECK_URL` secret unset. Its presence is what switches the
> workflow into "ping Vercel" mode; empty means "do the work here."

---

## Option B — Deploy to Vercel

Same app, exposed as a web endpoint at `/api/check`. Because Vercel functions
have no persistent disk, this path needs Upstash Redis to remember which
listings it already sent.

1. **Gmail app password** — same as step 1 above.

2. **Vercel account** — sign up at https://vercel.com/signup and choose
   **Continue with GitHub**, using the account that owns this repo. Then
   **Add New Project** → import this repo.

3. **Upstash Redis** — in your Vercel project: **Storage → Marketplace
   Database Providers → Upstash** → create a free Redis database and connect
   it. That auto-fills `UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN`.

4. **Environment variables** — in the Vercel project settings (see
   `.env.example`):
   - `CRON_SECRET` — any random string, e.g. from `openssl rand -hex 32`
   - `GMAIL_USER`, `GMAIL_APP_PASSWORD`, optionally `ALERT_EMAIL_TO`
   - Optionally `YAD2_SEARCH_URL`, `MAX_RENT`, `RADIUS_KM`, `MAX_PAGES`

5. **Point the hourly workflow at it.** In this repo's
   **Settings → Secrets and variables → Actions**, add:
   - `YAD2_CHECK_URL` → `https://your-app.vercel.app/api/check`
   - `CRON_SECRET` → the same value you set in Vercel

6. **Test:**
   ```bash
   curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://your-app.vercel.app/api/check
   ```
   You should get `{"checked": 12, "new": 3, "newIds": [...]}` and, if
   `new > 0`, an email. Run it twice — the second run's `new` should drop to
   0, since those listings are now recorded in Redis.

---

## Important caveat: Yad2 has anti-bot protection

Yad2 doesn't publish a public API and actively guards against scraping. This
app fetches the search page with browser-like headers and parses the
`__NEXT_DATA__` JSON embedded in it, which is what most lightweight Yad2
scrapers do. But if Yad2 starts blocking these requests or changes its page
structure, the check will start failing. When that happens:

- You'll get **one** email about it, throttled to at most once every 12 hours
  so a persistent failure doesn't flood your inbox.
- Look at the logs — the GitHub Actions run log (Option A), or Vercel's
  function logs under Deployments → your deployment → Functions (Option B).
- The usual fix is swapping the plain `fetch()` in `lib/yad2.ts` for a
  headless browser (`puppeteer-core` + `@sparticuz/chromium`), which mimics a
  real browser much more closely. That's a heavier change, so it isn't
  included by default — ask if you want it added.

Note also that the scraper's parsing was written against Yad2's documented
URL structure but **could not be tested against the live site** from the
environment it was built in, so treat the first real run as the actual test.

## Tuning the search

- `MAX_RENT` (default 5500) and `RADIUS_KM` (default 20, measured from Kfar
  HaRif at 31.7442°N, 34.7956°E) are applied on top of whatever
  `YAD2_SEARCH_URL` returns.
- To change the underlying Yad2 query itself (more nearby cities, specific
  room counts, etc.), build the search you want on
  [yad2.co.il](https://www.yad2.co.il/realestate/rent), copy the resulting
  URL, and set it as `YAD2_SEARCH_URL`. The app still applies its own
  price/distance filter on top, so pointing it at a broader search than you
  actually want is safe.
- In Option A these go under **Settings → Secrets and variables → Actions →
  Variables** (not Secrets); in Option B they're Vercel environment variables.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in values

# run one check from the terminal:
node --env-file=.env.local node_modules/.bin/tsx scripts/check.ts

# or run the web app:
npm run dev
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/check
```

Locally (and in Option A) the "already seen" set lives in `.state/seen.json`.
Delete that file to make everything look new again.
