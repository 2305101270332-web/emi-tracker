import { describe, expect, it } from "vitest";
import {
  derivePayableDate,
  groupPayables,
  instalmentStatus,
  loanProgress,
  statementDateFor,
  totalsByCurrency,
  xirr,
} from "../src";

describe("billed vs payable dates", () => {
  it("normal loans: payable = billed", () => {
    expect(derivePayableDate("2025-03-15")).toBe("2025-03-15");
  });
  it("card EMI billed before statement day lands on this month's statement", () => {
    expect(statementDateFor("2025-03-10", 15)).toBe("2025-03-15");
    expect(statementDateFor("2025-03-15", 15)).toBe("2025-03-15");
    expect(statementDateFor("2025-03-16", 15)).toBe("2025-04-15");
  });
  it("card due day after statement day: same month", () => {
    const card = { statementDay: 5, dueDay: 25 };
    expect(derivePayableDate("2025-03-05", { card })).toBe("2025-03-25");
  });
  it("card due day before statement day: next month", () => {
    const card = { statementDay: 20, dueDay: 8 };
    expect(derivePayableDate("2025-03-18", { card })).toBe("2025-04-08");
  });
  it("card grace days", () => {
    const card = { statementDay: 31, graceDays: 18 };
    expect(derivePayableDate("2025-02-10", { card })).toBe("2025-03-18"); // stmt Feb 28 + 18
  });
  it("weekend rule moves to previous/next working day", () => {
    // 2025-03-15 is a Saturday
    expect(derivePayableDate("2025-03-15", { holidayRule: "previous_working_day" })).toBe("2025-03-14");
    expect(derivePayableDate("2025-03-15", { holidayRule: "next_working_day" })).toBe("2025-03-17");
    expect(
      derivePayableDate("2025-03-14", { holidayRule: "previous_working_day", holidays: ["2025-03-14"] }),
    ).toBe("2025-03-13");
  });
  it("groups EMIs on one card into a single pay-by amount", () => {
    const groups = groupPayables([
      { id: "a", loanId: "L1", cardId: "C1", currency: "INR", payableDate: "2025-04-05", billedDate: "2025-03-15", amount: 100 },
      { id: "b", loanId: "L2", cardId: "C1", currency: "INR", payableDate: "2025-04-05", billedDate: "2025-03-12", amount: 250 },
      { id: "c", loanId: "L3", cardId: null, currency: "INR", payableDate: "2025-04-05", billedDate: "2025-04-05", amount: 40 },
      { id: "d", loanId: "L4", cardId: "C1", currency: "USD", payableDate: "2025-04-05", billedDate: "2025-03-12", amount: 9 },
    ]);
    expect(groups).toHaveLength(3);
    const card = groups.find((g) => g.cardId === "C1" && g.currency === "INR")!;
    expect(card.total).toBe(350);
    expect(card.items).toHaveLength(2);
  });
});

describe("tracking", () => {
  it("derives status from payable date", () => {
    const today = "2025-03-10";
    expect(instalmentStatus({ payableDate: "2025-03-01", paidAt: "2025-03-01" }, today)).toBe("paid");
    expect(instalmentStatus({ payableDate: "2025-03-01", skipped: true }, today)).toBe("skipped");
    expect(instalmentStatus({ payableDate: "2025-03-09" }, today)).toBe("overdue");
    expect(instalmentStatus({ payableDate: "2025-03-10" }, today)).toBe("due");
    expect(instalmentStatus({ payableDate: "2025-03-17" }, today)).toBe("due");
    expect(instalmentStatus({ payableDate: "2025-03-18" }, today)).toBe("upcoming");
  });
  it("computes loan progress", () => {
    const p = loanProgress([
      { opening: 1000, principal: 400, interest: 10, closing: 600, paid: true },
      { opening: 600, principal: 600, interest: 6, closing: 0, paid: false },
    ]);
    expect(p).toMatchObject({ instalmentsPaid: 1, instalmentsLeft: 1, principalOutstanding: 600, interestPaid: 10 });
    expect(p.progress).toBeCloseTo(0.4);
  });
  it("never sums across currencies", () => {
    const t = totalsByCurrency(
      [
        { c: "INR", a: 100 },
        { c: "USD", a: 5 },
        { c: "INR", a: 50 },
      ],
      (x) => x.c,
      (x) => x.a,
    );
    expect(t).toEqual({ INR: 150, USD: 5 });
  });
});

describe("xirr", () => {
  it("returns ~10% for a one-year 10% investment", () => {
    const r = xirr([
      { date: "2025-01-01", amount: 1000 },
      { date: "2026-01-01", amount: -1100 },
    ]);
    expect(r!).toBeCloseTo(0.1, 6);
  });
  it("returns null without a sign change", () => {
    expect(xirr([{ date: "2025-01-01", amount: 1 }, { date: "2025-02-01", amount: 1 }])).toBeNull();
  });
});
