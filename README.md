# EMI Tracker

A Progressive Web App to schedule, track and calculate loan EMIs in any currency —
built entirely on the Cloudflare free tier.

- **Frontend:** React + TypeScript + Vite + Tailwind (PWA) on Cloudflare Pages
- **API:** Cloudflare Worker (Hono) · **DB:** D1 · **Files:** R2 · **Jobs:** Cron Trigger (hourly)
- **Email:** Resend · **Push:** Web Push (VAPID) · **Validation:** Zod shared by web and API · **Tests:** Vitest

```
apps/web         React PWA (+ functions/api proxy for Pages)
apps/api         Worker: REST API, cron reminders, D1 migrations
packages/core    Pure TS calculation engine (no UI deps) + tests
packages/shared  Zod schemas, constants, lenders, i18n strings, formatters
docs/DECISIONS.md  Financial calculation decisions
```

## Local development

Requirements: Node 22+ (Node 24 recommended; API tests use the built-in `node:sqlite`).

```bash
npm install
cp apps/api/.dev.vars.example apps/api/.dev.vars     # set SESSION_SECRET (32+ chars)
cp apps/web/.env.example apps/web/.env.local         # set VITE_GOOGLE_CLIENT_ID (optional for dev)

npm run db:migrate:local -w @emi/api                 # create local D1 + seed lenders
npm run dev:api                                      # Worker on http://localhost:8787
npm run dev:web                                      # App on http://localhost:5173 (proxies /api)
```

In dev the sign-in page shows **“Continue with demo account”**, which signs in a demo
user and seeds sample loans (INR personal/home/flat car loan, two credit-card EMIs on one
card incl. a no-cost EMI and an EMI shift, and a USD BNPL). The dev login only exists when
`ENVIRONMENT=development`; it returns 404 in production.
`npm run db:seed:local -w @emi/api` does the same against a running local API.

Trigger the hourly reminder job locally: `npm run cron:test -w @emi/api`.

### Tests

```bash
npm test          # core engine, shared schemas, API (integration on real migrations), web
npm run typecheck
```

## Google OAuth client

1. Google Cloud Console → APIs & Services → **Credentials** → *Create credentials* → **OAuth client ID** → *Web application*.
2. **Authorized JavaScript origins:** `http://localhost:5173` and your production origin (e.g. `https://emi-tracker.pages.dev` or your custom domain). No redirect URIs are needed (Google Identity Services popup/One Tap).
3. Configure the OAuth consent screen (scopes: `openid`, `email`, `profile`).
4. Put the client ID in `apps/web/.env.local` (`VITE_GOOGLE_CLIENT_ID`) and in `apps/api/wrangler.jsonc` → `vars.GOOGLE_CLIENT_ID` (the Worker verifies the ID token's audience).

## Cloudflare setup

```bash
cd apps/api
npx wrangler login
npx wrangler d1 create emi_tracker            # copy database_id into wrangler.jsonc (both envs)
npx wrangler r2 bucket create emi-tracker-docs
npm run db:migrate:remote

# Secrets — never commit these
npx wrangler secret put SESSION_SECRET        # 32+ random chars: openssl rand -base64 48
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put RESEND_FROM           # e.g. EMI Tracker <reminders@yourdomain.com>
npx wrangler secret put RESEND_WEBHOOK_SECRET
```

Edit `vars` in `apps/api/wrangler.jsonc`: `APP_ORIGIN` and `API_ORIGIN` (both your Pages
origin, since the API is served through it), `GOOGLE_CLIENT_ID`, `VAPID_PUBLIC_KEY`,
`VAPID_SUBJECT`.

### VAPID keys (Web Push)

```bash
npm run vapid -w @emi/api
```
Put `VAPID_PUBLIC_KEY` in `wrangler.jsonc` vars and the private key in the
`VAPID_PRIVATE_KEY` secret. The web app fetches the public key from the API.
iOS/iPadOS only deliver web push to an **installed** PWA (Add to Home Screen); the app shows
an install hint on iOS. When permission is denied, reminders still appear in the in-app
notification centre.

### Resend (email)

1. Create an account at resend.com → **API Keys** → *Create API key* (sending access) → store as `RESEND_API_KEY`.
2. **Domains → Add domain** (e.g. `mail.yourdomain.com`). Resend shows DNS records (SPF `TXT`/`MX` on `send.` subdomain, DKIM `TXT` `resend._domainkey`, optional DMARC).
3. In the **Cloudflare dashboard → your zone → DNS → Records**, add each record exactly as shown. Set proxy status to **DNS only** (grey cloud). Click *Verify* in Resend.
4. Set `RESEND_FROM` to an address on that verified domain.
5. **Webhooks → Add endpoint:** `https://<your-app-origin>/api/webhooks/resend`, events `email.bounced` and `email.complained`. Copy the signing secret (`whsec_…`) into `RESEND_WEBHOOK_SECRET`. Bounced/complained addresses are never emailed again.

Emails sent: welcome (first login), reminders (same schedule as push: N days before, on the
day, overdue — several dues in one email), and an optional Monday weekly summary. Every email
has a one-click unsubscribe link that works without logging in (HMAC-signed token).

### Deploy

```bash
npm run deploy -w @emi/api                    # Worker + hourly cron
npm run deploy -w @emi/web                    # builds and deploys Pages (apps/web/wrangler.jsonc)
```
The Pages Function `apps/web/functions/api/[[path]].ts` forwards `/api/*` to the Worker via a
service binding, so the app and API share one origin and the session cookie is first-party
(`HttpOnly; Secure; SameSite=Lax`). CORS is additionally locked to `APP_ORIGIN`.

## Free-tier budget (checked Oct 2026)

| Service | Free limit | How we stay inside |
|---|---|---|
| Workers | 100k req/day, 10 ms CPU, 50 subrequests, 5 crons | 1 cron; summaries cached on the loan row; push capped at 20 sends/run, emails via Resend **batch** endpoint (1 subrequest per 100 emails) |
| D1 | 5M rows read & 100k written/day, 50 queries/invocation, 100 bound params | Reminder job uses ~7 queries regardless of users (`json_each`); schedules upserted in multi-row statements; regenerated only when terms change |
| R2 | 10 GB, 1M class A / 10M class B ops/month | Documents (Phase 2) capped at 10 MB, PDF/images only |
| Resend | 100 emails/day, 3,000/month | `EMAIL_DAILY_CAP` (default 95); excess is deferred to the next run; one email per user per run |

Anything not delivered (budget cap or provider error) is retried on the next hourly run
(max 3 attempts); the `notifications.dedupe_key` unique index guarantees a reminder is never
sent twice for the same instalment.

## Security

- Google ID tokens verified (signature via Google JWKS, issuer, audience, expiry, verified email).
- Session: HS256 JWT in an `HttpOnly; Secure; SameSite=Lax` cookie (30 days).
- Every table carries `user_id`; every query filters by it (ownership tests in `apps/api/test/api.test.ts`).
- Zod validation on every endpoint, Origin check on state-changing requests, rate limiting
  (Workers Rate Limiting binding with in-memory fallback), strict CORS.
- Secrets only via `wrangler secret`; `.dev.vars` and `.env*` are git-ignored.

## Adding a language

Copy `packages/shared/src/i18n/en.ts` to e.g. `hi.ts`, translate, and register it in
`packages/shared/src/i18n/index.ts`. The web app (react-i18next) and server emails share it.
A test fails if the UI uses a key that's missing from English.
