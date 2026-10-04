# Calculation decisions

These were confirmed with the product owner before implementation (CLAUDE.md: "Ask me
before making any assumption that changes the financial calculations"). Any change here
changes numbers users see — update the tests in `packages/core/test` alongside.

| Topic | Decision |
|---|---|
| **EMI shift / broken-period interest** | Extra interest is charged only for the days between the *natural* first EMI date (booking + 1 month, or the user-entered original date) and the *shifted* first EMI date: `financed principal × annual rate × days / day-count (365 or 360)`. The first instalment still carries one normal month of interest. Tax on interest applies to it. Collected with the first instalment by default, or upfront. A shift to an *earlier* date is rejected. |
| **No-cost EMI** | The upfront discount equals the total interest. Financed principal = present value of `price / n` at the loan rate; the instalments' principal + interest sum exactly to the price (last instalment absorbs rounding, so discount == total interest exactly). Tax on each interest component is still charged, so the cost of borrowing equals the tax (+ any fees). With 0% rate it is a plain interest-free split. |
| **Manual override** | Overrides set an instalment's EMI (principal + interest, excluding tax/fees). Tenure is kept: the remaining instalments get a recomputed EMI on the new balance. The last instalment cannot be overridden (it always closes the loan). Overrides above balance + interest are rejected (use a prepayment instead). Overrides below the interest are allowed (negative amortisation). |
| **APR / IRR** | Both are shown. XIRR is solved on actual dates (borrower receives principal minus upfront charges at booking, pays each instalment's total on its billed date). *Effective annual rate* = XIRR; *nominal APR* = `((1 + XIRR)^(1/12) − 1) × 12`. |

### Phase 2 decisions (confirmed 2026-10-04)

| Topic | Decision |
|---|---|
| **Prepayment timing** | A part-payment is applied immediately after the next EMI on/after its date (a payment on an EMI date applies right after that EMI). No broken-period interest split. |
| **Prepayment / foreclosure charge** | Charge % × the amount prepaid (for foreclosure that is the whole outstanding principal), plus tax on the charge (e.g. GST 18%). Charges are part of total cost of borrowing. |
| **Floating rate change** | Each rate change carries its own mode: *keep EMI, change tenure* (default) or *keep tenure, change EMI*. If the current EMI no longer covers the new month's interest (or tenure would exceed 600 months), that change falls back to *keep tenure*. Applies from the first instalment billed on/after the effective date. |
| **Comparing offers** | Offers are ranked by effective annual rate (XIRR incl. all charges); total cost of borrowing is shown alongside. |

### Phase 3 decisions (made autonomously 2026-10-04, per instruction; change freely)

**Payoff planner** (`packages/core/src/payoff.ts`; the same list is shown on screen)
| Topic | Decision |
|---|---|
| Inputs | Each own, active, reducing-balance loan's outstanding principal, its *current* rate (from the next unpaid instalment, so rate changes are respected) and current EMI (principal + interest). |
| Budget | Sum of all current EMIs + the extra amount, held constant: a paid-off loan's EMI rolls over to the next target (classic avalanche/snowball). |
| Order | Avalanche: highest rate first (tie: smaller balance). Snowball: smallest balance first (tie: higher rate). Fixed at the start. |
| Interest | Monthly, balance × rate / 12, rounded to minor units; extra money reduces principal the same month. |
| Not modelled | Prepayment charges, fees, future rate changes, missed payments. Tax on interest is reported separately and paid on top of the budget. |
| Scope | One currency at a time (never converted or combined). Flat-rate loans excluded with an on-screen note (interest fixed upfront). Loans shared *with* you excluded. Cap 600 months ("never paid off" warning). |

**Debt-to-income**
| Topic | Decision |
|---|---|
| Income | One monthly take-home income + its currency, stored in `settings` (private). |
| Obligations | For each own active loan in the income currency: its next unpaid instalment's amount payable minus one-off fees / EMI-shift cost. Loans in other currencies are excluded and counted in a note. |
| Bands | < 30 % healthy, 30–40 % caution, > 40 % high (common lender affordability norms). |

**Sharing**
| Topic | Decision |
|---|---|
| Identity | Invites are addressed to an email (stored lower-cased). Access is granted to whoever signs in with Google using that *verified* email — immediately if they already have an account, otherwise on first sign-in. No invite tokens. |
| Roles | **view**: read-only everywhere (schedule, charts, client-side exports and simulator only). **edit**: record/undo payments, skip, overrides, edit terms, rate changes. **owner only**: share, change access, revoke, delete the loan, mute reminders, documents. Editors cannot change lender, card or loan type (they can't see the owner's lenders/cards; the server keeps the owner's values). |
| Privacy | Shared users see only the shared loan: never the owner's other loans, cards (card id is hidden), documents (hidden even on the shared loan), shares list or income. Unknown/unshared loans return 404; forbidden actions on a visible loan return 403. |
| Where shared loans appear | A "Shared with me" section on Loans and the loan page. Not in the shared user's dashboard totals, calendar, debt-to-income or payoff planner (those describe your own debt). |
| Reminders | Go to the owner only. |
| Leaving | Recipients cannot remove themselves (only the owner revokes); deleting their account removes them. |
| Invite email | Sent once per new share via Resend (counted toward the daily email cap); access changes don't re-send. |
| Account deletion | Deletes the user's own loans (and every share on them) and removes them from loans shared with them, including pending invites to their email. Others' loans are untouched. The confirmation step lists these counts. |

**Charts**: principal vs interest aggregated per calendar year (stacked bars; prepayments count as principal); outstanding balance per month end (line), projected from the schedule assuming instalments are paid as scheduled. Dashboard trend: own loans, one chart per currency, each ending at its debt-free month. Series colours validated for colour-blind separation in light and dark mode.

**Flat-rate loans**: prepayment simulation and rate changes stay unavailable, with an explanation shown in the UI.

Bank-statement fixtures live in `packages/core/test/statements/`; each must match to the paisa.
The two current fixtures are **illustrative** (independently computed with Python `Decimal`),
not real bank documents — add real statements with `_template.statement.ts`.

## Other engine conventions (not product decisions, but worth knowing)

- Money is integer minor units (ISO 4217 digits via `Intl`); rounding is half away from zero.
- Reducing balance uses the monthly rate `annual / 12` per instalment regardless of days in the month (standard EMI practice); only the EMI-shift period uses day count.
- Flat-rate interest = `P × rate × months/12`, split evenly; the last row absorbs rounding. The equivalent reducing rate solves the annuity for the same EMI.
- Instalment *n* is billed on `emiDay` of month *n*, clamped to the month end (29/30/31 → Feb 28/29).
- Floating-rate changes (Phase 2 engine support already in place) apply from the first instalment billed on/after the effective date and keep tenure.
- Status: `due` = unpaid and payable within the next 7 days; `overdue` = unpaid and payable before today (user's time zone).
