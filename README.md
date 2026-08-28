# Yad2 Apartment Alerts

Checks Yad2 every hour for rental apartments near **Kfar HaRif** (≤ ₪5500/month,
within ~20km) and sends an **email** for anything new. Deploys on Vercel; the
hourly trigger runs via a free GitHub Actions schedule (Vercel's own Cron Jobs
only fire once/day on the free Hobby plan).

## How it works

1. A GitHub Actions workflow (`.github/workflows/hourly-check.yml`) hits
   `GET /api/check` on your deployed Vercel app, once an hour, with a secret
   bearer token.
2. `/api/check` fetches the Yad2 rental search page, pulls listing data out of
   the page's embedded JSON, filters by price and distance from Kfar HaRif,
   and diffs against what it's already alerted on (stored in Upstash Redis).
3. Anything new gets emailed to you via your Gmail account (SMTP, using an
   app password).

## Important caveat: Yad2 has anti-bot protection

Yad2 doesn't publish a public API, and actively guards against scraping. This
app fetches the page directly with browser-like headers and parses its
`__NEXT_DATA__` JSON, which is what most lightweight Yad2 scrapers do — but
if Yad2 starts blocking these requests (or changes their page structure), the
`/api/check` endpoint will start failing. When that happens:

- You'll get **one** email alert about it (throttled to at most once every
  12 hours, so it won't spam you).
- Check the Vercel function logs (Project → Deployments → your deployment →
  Functions → `/api/check`) for the actual error.
- If it's consistently blocked, the usual fix is swapping the plain `fetch()`
  in `lib/yad2.ts` for a headless-browser fetch (e.g. `puppeteer-core` +
  `@sparticuz/chromium`), which better mimics a real browser. That's a bigger
  change (bigger function, slower cold starts) so it's not included by
  default — ask if you want it added.

## Setup

### 1. Gmail app password (email sending)

1. Turn on 2-Step Verification on the Google account you want to send from:
   https://myaccount.google.com/security
2. Create an app password: https://myaccount.google.com/apppasswords
   (app: "Mail", device: "Other" → name it e.g. `yad2-alerts`)
3. Google shows you a 16-character password once — copy it. That's
   `GMAIL_APP_PASSWORD` (not your normal Gmail password).

### 2. Upstash Redis (dedup storage)

Easiest path: in your Vercel project, go to **Storage → Marketplace Database
Providers → Upstash**, create a free Redis database, and connect it to this
project — it'll auto-populate `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` as project env vars.

(Alternatively create one directly at [console.upstash.com](https://console.upstash.com)
and copy the REST URL/token in yourself.)

### 3. Deploy to Vercel

1. Push this repo to GitHub (already done if you're reading this from the repo).
2. In Vercel, "Add New Project" → import this repo.
3. Set environment variables (see `.env.example`):
   - `CRON_SECRET` — any random string, e.g. `openssl rand -hex 32`
   - `GMAIL_USER`, `GMAIL_APP_PASSWORD` (and optionally `ALERT_EMAIL_TO` if
     you want alerts sent somewhere other than `GMAIL_USER` itself)
   - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (skip if using the
     Marketplace integration above, it sets these for you)
   - Optionally `YAD2_SEARCH_URL`, `MAX_RENT`, `RADIUS_KM`, `MAX_PAGES`
4. Deploy. Note your deployment URL, e.g. `https://your-app.vercel.app`.

### 4. Wire up the hourly trigger (GitHub Actions)

In this GitHub repo's **Settings → Secrets and variables → Actions**, add:

- `CRON_SECRET` — the same value you set in Vercel
- `YAD2_CHECK_URL` — `https://your-app.vercel.app/api/check`

The workflow in `.github/workflows/hourly-check.yml` will now call your
endpoint every hour. You can also trigger it manually from the Actions tab
("Run workflow") to test immediately rather than waiting an hour.

### 5. Test it

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://your-app.vercel.app/api/check
```

You should get back JSON like `{"checked": 12, "new": 3, "newIds": [...]}`,
and (if `new > 0`) an email. Run it twice in a row — the second run's `new`
should drop to 0 for anything already reported, since it's now stored in
Redis.

## Tuning the search

- `MAX_RENT` (default 5500) and `RADIUS_KM` (default 20, measured from Kfar
  HaRif) are applied on top of whatever `YAD2_SEARCH_URL` returns.
- To narrow or widen the underlying Yad2 query itself (e.g. add more nearby
  cities, restrict to specific room counts), go build the search on
  [yad2.co.il](https://www.yad2.co.il/realestate/rent) yourself, copy the
  resulting URL, and set it as `YAD2_SEARCH_URL`. The app will still apply
  its own price/distance filtering on top, so it's safe to point it at a
  broader search than you actually want.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in values
npm run dev
# then in another terminal:
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/check
```
