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

## Other engine conventions (not product decisions, but worth knowing)

- Money is integer minor units (ISO 4217 digits via `Intl`); rounding is half away from zero.
- Reducing balance uses the monthly rate `annual / 12` per instalment regardless of days in the month (standard EMI practice); only the EMI-shift period uses day count.
- Flat-rate interest = `P × rate × months/12`, split evenly; the last row absorbs rounding. The equivalent reducing rate solves the annuity for the same EMI.
- Instalment *n* is billed on `emiDay` of month *n*, clamped to the month end (29/30/31 → Feb 28/29).
- Floating-rate changes (Phase 2 engine support already in place) apply from the first instalment billed on/after the effective date and keep tenure.
- Status: `due` = unpaid and payable within the next 7 days; `overdue` = unpaid and payable before today (user's time zone).
