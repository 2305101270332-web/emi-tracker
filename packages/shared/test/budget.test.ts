import { describe, expect, it } from "vitest";
import { cardInputSchema, expenseInputSchema, loanInputSchema, monthlyEquivalent, splitAmount, summarizeBudget, type Expense, type UpcomingItem } from "../src";

const exp = (over: Partial<Expense>): Expense => ({
  id: "e",
  name: "Gym",
  category: "fitness",
  amount: 2_000_00,
  currency: "INR",
  frequency: "monthly",
  active: true,
  createdAt: "",
  updatedAt: "",
  ...over,
});
const due = (amount: number, status: UpcomingItem["status"], currency = "INR", loanId = "L") => ({ amount, status, currency, loanId }) as UpcomingItem;

describe("monthlyEquivalent", () => {
  it("spreads quarterly and yearly costs", () => {
    expect(monthlyEquivalent(1_500_00, "monthly")).toBe(1_500_00);
    expect(monthlyEquivalent(3_000_00, "quarterly")).toBe(1_000_00);
    expect(monthlyEquivalent(1_499_00, "yearly")).toBe(124_92); // 124.9166… rounded
  });
});

describe("summarizeBudget", () => {
  it("adds EMIs and active expenses per currency, never across currencies", () => {
    const rows = summarizeBudget({
      income: { amount: 1_00_000_00, currency: "INR" },
      dues: [due(10_000_00, "paid"), due(5_000_00, "upcoming"), due(9_999_00, "skipped"), due(50_00, "due", "USD")],
      expenses: [
        exp({}),
        exp({ name: "Claude", category: "subscriptions", amount: 20_00, currency: "USD" }),
        exp({ name: "YouTube", category: "subscriptions", amount: 1_490_00, frequency: "yearly" }),
        exp({ name: "Paused", amount: 9_000_00, active: false }),
      ],
    });
    expect(rows).toEqual([
      { currency: "INR", income: 1_00_000_00, emis: 15_000_00, emisPaid: 10_000_00, emisOthers: 0, expenses: 2_124_17, outgo: 17_124_17, left: 82_875_83 },
      { currency: "USD", income: null, emis: 50_00, emisPaid: 0, emisOthers: 0, expenses: 20_00, outgo: 70_00, left: null },
    ]);
  });

  it("counts only the user's share of a split loan", () => {
    const [row] = summarizeBudget({
      income: null,
      dues: [due(3_000_00, "paid", "INR", "shared"), due(5_000_00, "due", "INR", "solo")],
      expenses: [],
      splits: { shared: [{ name: "Rahul", kind: "flat", amount: 1_000_00 }] },
    });
    expect(row).toMatchObject({ emis: 7_000_00, emisPaid: 2_000_00, emisOthers: 1_000_00 });
  });

  it("shows the income row even with nothing else", () => {
    expect(summarizeBudget({ income: { amount: 500_00, currency: "EUR" }, dues: [], expenses: [] })).toEqual([
      { currency: "EUR", income: 500_00, emis: 0, emisPaid: 0, emisOthers: 0, expenses: 0, outgo: 0, left: 500_00 },
    ]);
  });
});

describe("expense and card schemas", () => {
  it("validates expenses", () => {
    expect(expenseInputSchema.parse({ name: " Protein ", category: "health", amount: 3_200_00, currency: "INR" })).toMatchObject({
      name: "Protein",
      frequency: "monthly",
      active: true,
    });
    expect(expenseInputSchema.safeParse({ name: "x", category: "health", amount: 0, currency: "INR" }).success).toBe(false);
    expect(expenseInputSchema.safeParse({ name: "x", category: "nope", amount: 1, currency: "INR" }).success).toBe(false);
  });

  it("treats a blank name on card as the user's own card", () => {
    const base = { nickname: "Dad's Amex", statementDay: 5, dueDay: 25 };
    expect(cardInputSchema.parse({ ...base, holderName: "  " }).holderName).toBeNull();
    expect(cardInputSchema.parse({ ...base, holderName: " R. Sharma " }).holderName).toBe("R. Sharma");
    expect(cardInputSchema.parse(base).holderName).toBeNull();
  });
});

describe("splitAmount", () => {
  it("splits by fixed amount and by percent; the user pays the rest", () => {
    expect(splitAmount(3_000_00, [{ name: "Rahul", kind: "flat", amount: 1_000_00 }])).toEqual({
      others: [{ name: "Rahul", amount: 1_000_00 }],
      othersTotal: 1_000_00,
      mine: 2_000_00,
    });
    expect(splitAmount(1_000_01, [{ name: "A", kind: "percent", percent: 50 }]).mine).toBe(500_00); // A: 500.01 (rounded half up)
    expect(splitAmount(3_000_00, undefined)).toEqual({ others: [], othersTotal: 0, mine: 3_000_00 });
  });

  it("never lets the parts exceed the instalment", () => {
    // Smaller final instalment: the fixed share is capped, the user pays nothing.
    const r = splitAmount(800_00, [
      { name: "A", kind: "flat", amount: 1_000_00 },
      { name: "B", kind: "percent", percent: 10 },
    ]);
    expect(r).toEqual({ others: [{ name: "A", amount: 800_00 }, { name: "B", amount: 0 }], othersTotal: 800_00, mine: 0 });
  });
});

describe("loan schema: splits and pre-closure charge", () => {
  const loan = {
    lenderId: "x", type: "personal", nickname: "Trip", currency: "INR", principal: 1_00_000_00, annualRate: 12,
    tenureMonths: 12, repaymentType: "reducing", bookingDate: "2025-01-05", firstEmiDate: "2025-02-05", emiDay: 5,
  };
  it("defaults to no splits and no charge", () => {
    expect(loanInputSchema.parse(loan)).toMatchObject({ splits: [], prepaymentCharge: { kind: "none" }, prepaymentChargeTaxRate: 0 });
  });
  it("rejects percent splits above 100% in total", () => {
    const r = loanInputSchema.safeParse({ ...loan, splits: [{ name: "A", kind: "percent", percent: 60 }, { name: "B", kind: "percent", percent: 50 }] });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("splits_over_100");
  });
  it("accepts a flat or percent pre-closure charge", () => {
    expect(loanInputSchema.parse({ ...loan, prepaymentCharge: { kind: "flat", amount: 500_00 }, prepaymentChargeTaxRate: 18 }).prepaymentCharge).toEqual({ kind: "flat", amount: 500_00 });
    expect(loanInputSchema.safeParse({ ...loan, prepaymentCharge: { kind: "percent", percent: 120 } }).success).toBe(false);
  });
});
