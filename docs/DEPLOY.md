# First deploy — checklist

Everything runs on the Cloudflare free plan. Allow about an hour, most of it waiting for DNS.
Commands run from the repository root unless a step says `cd`.

You will end up with:

- **Web app** on Cloudflare Pages: `https://<project>.pages.dev` (or your custom domain)
- **API Worker** `emi-tracker-api`, reached through the Pages domain at `/api/*` (a Pages Function proxies to it over a service binding, so the session cookie is first-party)
- **D1** database `emi_tracker`, **R2** bucket `emi-tracker-docs`, an **hourly cron** for reminders

Throughout, `APP_URL` means your app origin, e.g. `https://emi-tracker.pages.dev`.

---

## 0. Prerequisites

- [ ] Node 22+ (24 recommended) and npm
- [ ] A Cloudflare account (free) — https://dash.cloudflare.com/sign-up
- [ ] A Google account for the OAuth client
- [ ] A domain you control on Cloudflare DNS, for sending email via Resend (e.g. `yourdomain.com`)

```bash
npm install
npm test            # everything should pass before you deploy
cd apps/api
npx wrangler login  # opens a browser to authorise Wrangler
```

## 1. Pick the Pages project name (decides APP_URL)

The app URL is `https://<project-name>.pages.dev`. The default name is `emi-tracker`; if it's taken,
pick another and use it everywhere below.

```bash
cd apps/web
npx wrangler pages project create emi-tracker --production-branch main
```

Note the URL it prints — that is `APP_URL`.

## 2. Google OAuth client

1. https://console.cloud.google.com/ → create (or pick) a project.
2. **APIs & Services → OAuth consent screen**: User type *External*; app name "EMI Tracker"; support
   email; scopes `openid`, `email`, `profile`; add yourself as a test user (or publish the app).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**.
   - **Authorized JavaScript origins:** `APP_URL` (and `http://localhost:5173` for local dev).
   - Redirect URIs: none needed (Google Identity Services popup).
4. Copy the **Client ID** (`…apps.googleusercontent.com`). It is public, not a secret.

## 3. D1 database

```bash
cd apps/api
npx wrangler d1 create emi_tracker
```

Copy the printed `database_id` into **both** `d1_databases` entries in `apps/api/wrangler.jsonc`
(top level and `env.dev`). Then create the tables (migrations 0001–0005, including seeded lenders):

```bash
npx wrangler d1 migrations apply emi_tracker --remote --env=""
```

## 4. R2 bucket

```bash
npx wrangler r2 bucket create emi-tracker-docs
```

The bucket stays private; files are only served through the Worker after an ownership check.

## 5. VAPID keys (Web Push)

```bash
npm run vapid -w @emi/api
```

It prints `VAPID_PUBLIC_KEY=…` and `VAPID_PRIVATE_KEY=…`. Keep the private key for step 8.

## 6. Resend (email) — API key, sending domain, webhook

1. Sign up at https://resend.com.
2. **Domains → Add Domain** → e.g. `mail.yourdomain.com` (a subdomain keeps your main domain's mail
   reputation separate). Choose a region.
3. Resend shows DNS records (MX + TXT for SPF on `send.mail…`, TXT `resend._domainkey…` for DKIM,
   and a recommended DMARC TXT). In **Cloudflare dashboard → your domain → DNS → Records → Add record**,
   create each exactly as shown, **Proxy status: DNS only** (grey cloud).
4. Back in Resend click **Verify DNS records**; wait until the domain shows *Verified* (minutes to an hour).
5. **API Keys → Create API Key** → permission *Sending access*, domain = the one above. Copy it (`re_…`).
6. **Webhooks → Add Endpoint** → URL `APP_URL/api/webhooks/resend`, events **email.bounced** and
   **email.complained**. Copy the **Signing Secret** (`whsec_…`).
7. Decide the from-address, e.g. `EMI Tracker <reminders@mail.yourdomain.com>`.

Free plan: 100 emails/day, 3,000/month. The app stops at 95/day (`EMAIL_DAILY_CAP`) and retries the
rest on later runs.

## 7. Worker configuration (non-secret)

Edit `apps/api/wrangler.jsonc` → top-level `vars`:

```jsonc
"ENVIRONMENT": "production",
"APP_ORIGIN": "https://emi-tracker.pages.dev",   // APP_URL
"API_ORIGIN": "https://emi-tracker.pages.dev",   // same: the API is served through the app domain
"GOOGLE_CLIENT_ID": "<client id from step 2>",
"VAPID_PUBLIC_KEY": "<public key from step 5>",
"VAPID_SUBJECT": "mailto:you@yourdomain.com",
"EMAIL_DAILY_CAP": "95"
```

## 8. Secrets (never committed)

```bash
cd apps/api
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"   # copy the output
npx wrangler secret put SESSION_SECRET --env=""          # paste the random value
npx wrangler secret put VAPID_PRIVATE_KEY --env=""       # from step 5
npx wrangler secret put RESEND_API_KEY --env=""          # re_… from step 6
npx wrangler secret put RESEND_FROM --env=""             # EMI Tracker <reminders@mail.yourdomain.com>
npx wrangler secret put RESEND_WEBHOOK_SECRET --env=""   # whsec_… from step 6
npx wrangler secret list --env=""                        # should list all five
```

Rotating `SESSION_SECRET` later signs everyone out and invalidates old unsubscribe links.

## 9. Deploy the API Worker (+ hourly cron)

```bash
cd apps/api
npx wrangler deploy --env=""
```

The output should list the bindings (DB, DOCS, RATE_LIMITER, vars) and the schedule `0 * * * *`.
If the deploy rejects the `ratelimits` block on your plan, delete that block from `wrangler.jsonc`
and redeploy — the API falls back to a built-in per-isolate limiter.

## 10. Build and deploy the web app

```bash
cd apps/web
printf 'VITE_GOOGLE_CLIENT_ID=<client id from step 2>\n' > .env.production.local
npm run build
npx wrangler pages deploy
```

`apps/web/wrangler.jsonc` binds the Pages Function to the Worker (`services: emi-tracker-api`), so
`APP_URL/api/*` reaches the API. If you renamed the Worker, update `service` there.

## 11. Smoke test

```bash
curl https://emi-tracker.pages.dev/api/health          # {"ok":true}
curl -X POST https://emi-tracker.pages.dev/api/auth/dev # 404 — dev login is off in production
```

Then in a browser:

- [ ] Open `APP_URL`, **Sign in with Google**, and check the welcome email arrives.
- [ ] Add a loan; open it; mark an instalment paid.
- [ ] Settings → enable push on this device → **Send test notification**.
- [ ] Install the app (Chrome/Edge: install prompt; iPhone: Share → Add to Home Screen — required for push on iOS).
- [ ] Share a loan with a second Google account (view only) and confirm it can't change anything.
- [ ] Cloudflare dashboard → Workers → emi-tracker-api → **Logs**: after the next full hour you should see
      a `reminders {...}` line from the cron run.

## 12. Optional: custom domain

Pages project → **Custom domains** → add `app.yourdomain.com`. Then update `APP_ORIGIN`/`API_ORIGIN`
(step 7), the Google **Authorized JavaScript origins** (step 2) and the Resend webhook URL (step 6),
and redeploy the Worker (step 9).

## Updating later

```bash
npm test
cd apps/api && npx wrangler d1 migrations apply emi_tracker --remote --env="" && npx wrangler deploy --env=""
cd ../web && npm run build && npx wrangler pages deploy
```

Always apply new migrations **before** deploying the Worker code that uses them.
