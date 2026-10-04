Build a production-ready Progressive Web App called "EMI Tracker" that lets users
schedule, track and calculate loan EMIs. Work in phases, and at the end of each phase
run the tests and show me what was built before continuing.

## Tech stack (all on Cloudflare free tier)
- Frontend: React + TypeScript + Vite + Tailwind CSS, deployed on Cloudflare Pages
- Backend: Cloudflare Workers (Hono, TypeScript) exposing a REST API
- Database: Cloudflare D1 (SQLite) with SQL migrations
- File storage: Cloudflare R2 (loan documents and statements), accessed only via the Worker
- Scheduling: Workers Cron Triggers for reminder jobs
- Validation: Zod schemas shared between frontend and Worker
- Tests: Vitest
Check the current Cloudflare docs for wrangler config and free-tier limits before
scaffolding, and keep usage inside the free limits.

## Auth
- Google sign-in only (Google Identity Services / OAuth 2.0).
- The Worker verifies the Google ID token, creates the user on first login, and issues
  an HttpOnly, Secure, SameSite session cookie.
- Every table row is scoped by user_id; every API route enforces ownership.
- All secrets go in wrangler secrets, never in the repo.

## Worldwide audience
- Per-user settings: country, currency, locale, time zone, date format.
- Each loan has its own currency (ISO 4217). Format with Intl.NumberFormat, including
  Indian lakh/crore grouping for en-IN.
- Tax is configurable, not hardcoded: tax label (GST, VAT, Sales Tax, None) and rate,
  with a default by country (India: GST 18%) that can be overridden per loan.
- All UI strings go through i18n (react-i18next), English first, structured so more
  languages can be added.
- Store money as integers in minor units and dates as ISO strings. No floating-point
  money.

## Lenders
- Seeded list by country, e.g. India: ICICI, HDFC, Axis, SBI, Kotak, IDFC First, Citi,
  HSBC, Standard Chartered, plus major international banks.
- Users can add custom lenders (name, country, colour/logo initial).

## Loan types
Personal, Credit Card EMI, Home, Car/Vehicle, Education, Gold, Consumer Durable,
Goal loan, Buy Now Pay Later, Other (custom label).

## Loan inputs
Lender, loan type, nickname, currency, principal, annual interest rate, tenure
(months), booking/disbursal date, first EMI date, EMI day of month, repayment type,
processing fee (flat or % of principal), tax on processing fee, tax on interest
(yes/no and rate), whether the fee is paid upfront or added to the first instalment,
notes, attached documents.

## Calculation engine (pure TypeScript module in /packages/core, no UI dependencies)
1. Reducing balance: EMI = P*r*(1+r)^n / ((1+r)^n - 1), with r = monthly rate.
   Each row shows opening balance, interest, principal, closing balance.
2. Fixed / flat rate: total interest = P * annual rate * years, spread evenly.
   Also show the equivalent reducing-balance rate so the user sees the true cost.
3. Tax on interest: for each instalment, tax = interest portion * tax rate, shown as a
   separate column and included in the amount payable (typical for Indian credit card
   EMIs).
4. Processing fee + tax on processing fee, shown as a separate charge on the schedule.
5. EMI shift / broken-period interest: if the lender moves the first EMI to its billing
   date, calculate the extra interest for the days between the booking date and the
   shifted EMI date (daily interest on principal, configurable day-count 365 or 360),
   plus tax on it. Show this as a clearly labelled "EMI shift cost" line and include it
   in total cost. Let the user enter both the original and shifted dates, or just toggle
   "lender aligned EMI to billing date".
6. Zero-interest / no-cost EMI: support 0% rate and an upfront interest discount, while
   still charging tax on the interest component where applicable.
7. Rounding: round each instalment to the currency's minor unit and absorb the
   difference in the final instalment so the balance closes at exactly zero.
8. Outputs per loan: full amortisation schedule, total interest, total tax, total fees,
   EMI shift cost, total cost of borrowing, effective annual rate (APR/IRR including
   all charges).
9. Allow manual override of any instalment amount so the schedule can match the bank's
   actual statement, with the rest of the schedule recalculated.
Write thorough unit tests for every case above, including edge cases: 0% interest,
1-month tenure, EMI day 29/30/31 in short months, leap years, and rounding.

## Billing date vs payable date (important)
An instalment has two separate dates:
- billed_date: when the EMI is posted (e.g. the 15th, or the card statement date)
- payable_date: when the user actually has to pay
For normal loans these are the same. For Credit Card EMIs the EMI is billed on the
card's statement date but payable on the card's payment due date. So:
- Users can create a Credit Card with statement day and payment due day (or grace days).
- Credit Card EMI loans link to a card, and payable_date is derived from the card's
  due date for the statement in which the EMI was billed.
- Dashboards, calendar and reminders use payable_date, while still showing billed_date.
- Several EMIs on one card are grouped into a single "pay by" amount for that due date.
- Optional rule per loan for due dates falling on weekends/holidays (previous or next
  working day).

## Tracking
- Each instalment has a status: upcoming, due, paid, overdue, skipped.
- Mark as paid with paid date, amount paid, and optional late fee or note.
- Per loan: progress bar, principal outstanding, interest paid so far, instalments left.
- Dashboard: total payable this month, next 7/30 days, total outstanding across loans,
  split by lender and by loan type, grouped by currency (never sum across currencies).
- Calendar view and list view of all upcoming payable dates.

## Notifications
- Web Push (VAPID) sent from a Worker Cron Trigger that runs hourly and respects each
  user's time zone and preferred reminder hour.
- Reminders: configurable days before payable_date (default 3 days and 1 day), on the
  day, and when overdue. Per-loan mute.
- In-app notification centre as a fallback when push permission is denied.
- Note that iOS only supports web push for an installed PWA; show an install hint.
## Email (Resend)
- Use Resend for all transactional email, called from the Worker via its REST API
  with fetch. Store RESEND_API_KEY and the from-address as wrangler secrets.
- Emails to send: welcome on first login, EMI reminders (same schedule as push:
  days before payable_date, on the day, overdue), and an optional weekly summary
  of upcoming dues.
- The same hourly Cron Trigger sends push and email; record each send in the
  notifications table so a reminder is never sent twice for the same instalment.
- Per-user settings: email reminders on/off, weekly summary on/off, and per-loan
  mute. Every email has an unsubscribe link that works without logging in
  (signed token).
- Templates: responsive HTML plus plain-text fallback, in the ocean blue and
  orange theme, with amounts and dates formatted in the user's currency, locale
  and time zone. Strings go through i18n.
- Group multiple dues on the same day into one email, and batch sends to stay
  within Resend's free-tier limits. Handle API failures with retry on the next
  cron run and log errors.
- Add a Resend webhook endpoint for bounces and complaints, and stop emailing
  addresses that bounce.
- README: steps for creating the Resend API key and verifying the sending domain
  (DNS records in Cloudflare).

## PWA and responsive design
- Installable on Android, iOS, Windows, macOS: web app manifest, icons (including
  maskable), service worker, offline shell, cached read access to schedules offline.
- Mobile-first layout with bottom navigation on phones and a sidebar on desktop.
- Custom "Install app" prompt.
- Accessible: keyboard navigation, WCAG AA contrast, respects reduced motion.

## Theme
Ocean blue primary (around #0077B6, with #023E8A dark and #CAF0F8 light tints) and
orange accent (around #FF7A00) for primary actions, due and overdue highlights.
Light and dark mode. Clean, card-based finance UI. Define colours as design tokens.

## Phase 2 features
- Prepayment / part-payment simulator: choose "reduce tenure" or "reduce EMI", see
  interest saved; foreclosure charge and tax on it.
- Floating rate changes: record a rate change from a given date and recalculate.
- Standalone EMI calculator and loan comparison (compare 2-3 offers by true cost).
- Export schedule to CSV and PDF; export due dates as .ics calendar file.
- Document uploads to R2 (sanction letter, statements), with size and type limits.
- Full data export (JSON) and account deletion.

## Phase 3 features
- Payoff strategy planner (avalanche vs snowball) across all loans.
- Monthly income field with debt-to-income indicator.
- Email reminders as a second channel.
- Shared loans (invite a family member with view or edit access).
- Charts: principal vs interest over time, outstanding balance trend.

## Project structure and quality
- Monorepo: /apps/web, /apps/api, /packages/core (calculation engine), /packages/shared.
- D1 schema: users, settings, lenders, cards, loans, instalments, payments,
  rate_changes, push_subscriptions, documents, notifications. Add indexes on
  user_id and payable_date.
- Input validation on every endpoint, rate limiting, CORS locked to the app origin.
- README with local setup, Google OAuth client setup, wrangler commands for D1/R2,
  VAPID key generation and deployment steps.
- Seed script with sample loans for demo.

## Build order
Phase 1: scaffolding, calculation engine with tests, auth, loan CRUD, schedule
generation, billed vs payable dates, tracking, dashboard, PWA, notifications, theme.
Then Phase 2, then Phase 3. Ask me before making any assumption that changes the
financial calculations.