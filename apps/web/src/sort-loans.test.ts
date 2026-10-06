import { describe, expect, it } from "vitest";
import type { LoanListItem } from "@emi/shared";
import { readLoanSort, saveLoanSort, sortLoans } from "./lib/sort-loans";

const loan = (id: string, o: { created: string; name: string; currency?: string; outstanding: number; emi: number; progress: number; rate: number; next: string | null }) =>
  ({
    id,
    nickname: o.name,
    createdAt: o.created,
    currency: o.currency ?? "INR",
    annualRate: o.rate,
    summary: { emi: o.emi },
    progress: { principalOutstanding: o.outstanding, progress: o.progress },
    nextInstalment: o.next ? { payableDate: o.next } : null,
  }) as unknown as LoanListItem;

const loans = [
  loan("a", { created: "2026-03-01", name: "car", outstanding: 500, emi: 50, progress: 0.5, rate: 9, next: "2026-11-05" }),
  loan("b", { created: "2026-05-01", name: "Bike", outstanding: 900, emi: 20, progress: 0.1, rate: 14, next: "2026-10-20" }),
  loan("c", { created: "2026-01-01", name: "Phone 10", outstanding: 0, emi: 80, progress: 1, rate: 0, next: null }),
  loan("d", { created: "2026-02-01", name: "Phone 9", currency: "USD", outstanding: 9999, emi: 999, progress: 0.3, rate: 5, next: "2026-10-10" }),
];
const ids = (sort: Parameters<typeof sortLoans>[1]) => sortLoans(loans, sort).map((l) => l.id);

describe("sortLoans", () => {
  it("sorts by each key", () => {
    expect(ids("newest")).toEqual(["b", "a", "d", "c"]);
    expect(ids("nextDue")).toEqual(["d", "b", "a", "c"]);
    expect(ids("name")).toEqual(["b", "a", "d", "c"]); // case-insensitive, numeric-aware
    expect(ids("progress")).toEqual(["c", "a", "d", "b"]);
    expect(ids("rate")).toEqual(["b", "a", "d", "c"]);
  });

  it("never compares money across currencies", () => {
    expect(ids("outstanding")).toEqual(["b", "a", "c", "d"]);
    expect(ids("emi")).toEqual(["c", "a", "b", "d"]);
  });

  it("does not mutate the input", () => {
    sortLoans(loans, "name");
    expect(loans.map((l) => l.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("remembers the choice and ignores junk", () => {
    expect(readLoanSort()).toBe("newest");
    saveLoanSort("rate");
    expect(readLoanSort()).toBe("rate");
    localStorage.setItem("emi-loan-sort", "bogus");
    expect(readLoanSort()).toBe("newest");
  });
});
