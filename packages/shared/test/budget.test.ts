import { describe, expect, it } from "vitest";
import { cardInputSchema, expenseInputSchema, monthlyEquivalent, summarizeBudget, type Expense, type UpcomingItem } from "../src";

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
const due = (amount: number, status: UpcomingItem["status"], currency = "INR") => ({ amount, status, currency }) as UpcomingItem;

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
      { currency: "INR", income: 1_00_000_00, emis: 15_000_00, emisPaid: 10_000_00, expenses: 2_124_17, outgo: 17_124_17, left: 82_875_83 },
      { currency: "USD", income: null, emis: 50_00, emisPaid: 0, expenses: 20_00, outgo: 70_00, left: null },
    ]);
  });

  it("shows the income row even with nothing else", () => {
    expect(summarizeBudget({ income: { amount: 500_00, currency: "EUR" }, dues: [], expenses: [] })).toEqual([
      { currency: "EUR", income: 500_00, emis: 0, emisPaid: 0, expenses: 0, outgo: 0, left: 500_00 },
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
