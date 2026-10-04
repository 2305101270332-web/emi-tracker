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

## Features

**Phase 1** — Google sign-in; loans with lender, type, currency, fees, tax on interest, EMI shift,
no-cost EMI; full amortisation schedule with billed vs payable dates (credit-card statement
cycle, weekend rule); mark paid / skip / edit an instalment to match the bank statement;
dashboard per currency; calendar; push, email and in-app reminders; installable offline PWA.

**Phase 2** — prepayment / foreclosure simulator (reduce tenure or EMI, charge + tax, net
saving); floating-rate changes per loan (keep EMI or keep tenure); standalone EMI calculator
and 2–3 offer comparison ranked by effective annual rate; export schedule to CSV and PDF and
due dates to `.ics`; loan documents in R2 (PDF/PNG/JPEG/WebP, 10 MB each, 100 MB per user,
type checked by file signature); full JSON data export and account deletion.

**Phase 3** — payoff planner (avalanche vs snowball vs minimum payments, per currency, assumptions
on screen); private monthly income with a debt-to-income indicator; shared loans (invite by email,
view or edit access, owner-only sharing/deletion, Resend invite email); account deletion that also
cleans up sharing; charts for principal vs interest and outstanding balance (loan page, dashboard,
payoff plan).

Account: per-device sign-out and **sign out of all devices** (session version bump); the
"Due" window (days before the pay-by date) is a user setting, default 7.

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

### Bank-statement checks

`packages/core/test/statements/` holds fixtures that must reproduce a lender's printed
figures to the paisa (EMI, every listed row, GST, fees, EMI-shift cost). Copy
`_template.statement.ts`, fill it from your sanction letter / statement and run
`npm test -w @emi/core`. The two current fixtures are illustrative (computed independently
in Python `Decimal`), not real bank documents.

### Tests

```bash
npm test          # core engine, shared schemas, API (integration on real migrations), web
npm run typecheck
```

## Deploying

Follow **[docs/DEPLOY.md](docs/DEPLOY.md)** — a step-by-step first-deploy checklist with the exact
commands: Google OAuth client, D1, R2, VAPID keys, Resend domain + webhook, secrets, Worker and
Pages deploys, and a smoke test.

In short: the web app is a Cloudflare Pages project whose Pages Function forwards `/api/*` to the
API Worker over a service binding, so app and API share one origin and the session cookie is
first-party (`HttpOnly; Secure; SameSite=Lax`). CORS is additionally locked to `APP_ORIGIN`.

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
- Shared loans: one access check (`apps/api/src/lib/access.ts`) resolves owner / edit / view per
  request; unshared loans are 404, forbidden actions 403. Shared users never receive the owner's
  other loans, cards, documents, shares or income (rule-by-rule tests in `apps/api/test/sharing.test.ts`).
- Abuse limits: 20 new invites per owner per day; all email (reminders, invites) respects the
  daily Resend cap; uploads are type-checked by file signature with size and per-user quotas.
- Zod validation on every endpoint, Origin check on state-changing requests, rate limiting
  (Workers Rate Limiting binding with in-memory fallback), strict CORS.
- Web app headers (`apps/web/public/_headers`): strict Content-Security-Policy (no inline
  scripts), `frame-ancestors 'none'`, HSTS, nosniff, Referrer-Policy, Permissions-Policy.
- Secrets only via `wrangler secret`; `.dev.vars` and `.env*` are git-ignored.

## Adding a language

Copy `packages/shared/src/i18n/en.ts` to e.g. `hi.ts`, translate, and register it in
`packages/shared/src/i18n/index.ts`. The web app (react-i18next) and server emails share it.
A test fails if the web app or API uses a key that's missing from English. API errors are
returned as codes and translated in the app (`errors.*`), so no server English reaches the UI.
