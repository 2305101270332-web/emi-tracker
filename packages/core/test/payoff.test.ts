import { describe, expect, it } from "vitest";
import { buildSchedule, dtiBand, planPayoff, priorityOrder, type Debt } from "../src";

const debts: Debt[] = [
  { id: "card", label: "Card EMI", balance: 50_000_00, annualRate: 16, minPayment: 4_536_50 },
  { id: "personal", label: "Personal", balance: 3_00_000_00, annualRate: 11, minPayment: 9_822_00 },
  { id: "car", label: "Car", balance: 20_000_00, annualRate: 9, minPayment: 2_000_00 },
];

describe("payoff planner", () => {
  it("orders targets: avalanche by rate, snowball by balance", () => {
    expect(priorityOrder(debts, "avalanche").map((d) => d.id)).toEqual(["card", "personal", "car"]);
    expect(priorityOrder(debts, "snowball").map((d) => d.id)).toEqual(["car", "card", "personal"]);
  });

  it("minimum-only matches each loan's own amortisation", () => {
    // A single debt paying exactly its EMI clears in its tenure, like the schedule engine says.
    const s = buildSchedule({ currency: "INR", principal: 100_000_00, annualRate: 12, tenureMonths: 12, repaymentType: "reducing", bookingDate: "2025-01-05", firstEmiDate: "2025-02-05" });
    const r = planPayoff([{ id: "x", label: "x", balance: 100_000_00, annualRate: 12, minPayment: s.summary.emi }], 0, "minimum", "2025-02-05");
    expect(r.months).toBe(12);
    expect(Math.abs(r.totalInterest - s.summary.totalInterest)).toBeLessThanOrEqual(12);
  });

  it("extra money shortens payoff; avalanche never pays more interest than snowball", () => {
    const min = planPayoff(debts, 0, "minimum", "2026-01-01");
    const ava = planPayoff(debts, 5_000_00, "avalanche", "2026-01-01");
    const snow = planPayoff(debts, 5_000_00, "snowball", "2026-01-01");
    expect(ava.months).toBeLessThan(min.months);
    expect(snow.months).toBeLessThan(min.months);
    expect(ava.totalInterest).toBeLessThanOrEqual(snow.totalInterest);
    expect(snow.payoffOrder[0]!.id).toBe("car"); // quick win first
    expect(ava.payoffOrder.map((p) => p.id)).toContain("card");
    for (const r of [min, ava, snow]) {
      expect(r.balances[0]).toBe(3_70_000_00);
      expect(r.balances.at(-1)).toBe(0);
      expect(r.payoffOrder).toHaveLength(3);
      expect(r.capped).toBe(false);
    }
  });

  it("budget stays constant: total paid = principal + interest", () => {
    const r = planPayoff(debts, 3_000_00, "snowball", "2026-01-01");
    expect(r.totalPaid).toBe(3_70_000_00 + r.totalInterest);
  });

  it("reports tax on interest separately", () => {
    const r = planPayoff([{ ...debts[0]!, interestTaxRate: 18 }], 0, "avalanche", "2026-01-01");
    expect(r.totalInterestTax).toBeGreaterThan(0);
    expect(Math.abs(r.totalInterestTax - Math.round(r.totalInterest * 0.18))).toBeLessThanOrEqual(r.months);
  });

  it("caps at 600 months when payments never cover interest", () => {
    const r = planPayoff([{ id: "x", label: "x", balance: 1_000_000_00, annualRate: 24, minPayment: 100_00 }], 0, "minimum", "2026-01-01");
    expect(r.capped).toBe(true);
    expect(r.months).toBe(600);
  });

  it("ignores zero balances and handles 0% debts", () => {
    const r = planPayoff([{ id: "a", label: "a", balance: 0, annualRate: 10, minPayment: 100 }, { id: "b", label: "b", balance: 1_000, annualRate: 0, minPayment: 300 }], 0, "avalanche", "2026-01-01");
    expect(r.months).toBe(4);
    expect(r.totalInterest).toBe(0);
  });
});

describe("debt-to-income bands", () => {
  it("uses 30% / 40% thresholds", () => {
    expect(dtiBand(0.299)).toBe("healthy");
    expect(dtiBand(0.3)).toBe("caution");
    expect(dtiBand(0.4)).toBe("caution");
    expect(dtiBand(0.41)).toBe("high");
  });
});
