import { describe, expect, it } from "vitest";
import type { LoanListItem } from "@emi/shared";
import { activeFilters, filterLoans, filterOptions, OWN_CARD, readFilters } from "./lib/filter-loans";

const TODAY = "2026-10-06";
const loan = (id: string, o: Record<string, unknown>) =>
  ({
    id,
    nickname: id,
    type: "personal",
    currency: "INR",
    cardId: null,
    card: null,
    splits: [],
    lender: { name: "HDFC Bank", color: "#000", initial: "H" },
    progress: { principalOutstanding: 1_000_00 },
    nextInstalment: { payableDate: "2026-10-20", status: "upcoming" },
    ...o,
  }) as unknown as LoanListItem;

const loans = [
  loan("Phone", { type: "credit_card_emi", cardId: "c1", card: { nickname: "Regalia", last4: "4321", holderName: null }, nextInstalment: { payableDate: "2026-10-09", status: "due" } }),
  loan("Laptop", { type: "credit_card_emi", cardId: "c2", card: { nickname: "Dad Amex", last4: "1005", holderName: "Ravi Rao" }, lender: { name: "Amex", color: "#000", initial: "A" } }),
  loan("Car", { type: "vehicle", lender: { name: "SBI", color: "#000", initial: "S" }, nextInstalment: { payableDate: "2026-09-30", status: "overdue" }, splits: [{ name: "Priya", kind: "flat", amount: 1 }] }),
  loan("Trip", { currency: "USD", nextInstalment: { payableDate: "2026-11-05", status: "upcoming" } }),
  loan("Old TV", { progress: { principalOutstanding: 0 }, nextInstalment: null }),
];
const ids = (q: string) => filterLoans(loans, readFilters(new URLSearchParams(q)), TODAY).map((l) => l.id);

describe("filterLoans", () => {
  it("returns everything with no filters", () => {
    expect(ids("")).toHaveLength(5);
  });
  it("filters by bank, card, name on card, type and currency", () => {
    expect(ids("bank=HDFC Bank")).toEqual(["Phone", "Trip", "Old TV"]);
    expect(ids("card=c2")).toEqual(["Laptop"]);
    expect(ids("card=none")).toEqual(["Car", "Trip", "Old TV"]);
    expect(ids("holder=Ravi Rao")).toEqual(["Laptop"]);
    expect(ids(`holder=${OWN_CARD}`)).toEqual(["Phone"]);
    expect(ids("type=vehicle")).toEqual(["Car"]);
    expect(ids("currency=USD")).toEqual(["Trip"]);
  });
  it("filters by next due date", () => {
    expect(ids("due=overdue")).toEqual(["Car"]);
    expect(ids("due=week")).toEqual(["Phone"]);
    expect(ids("due=month")).toEqual(["Phone", "Laptop"]);
    expect(ids("due=nextMonth")).toEqual(["Trip"]);
    expect(ids("due=range&from=2026-10-10&to=2026-11-30")).toEqual(["Laptop", "Trip"]);
  });
  it("filters by status, split and text, and combines filters", () => {
    expect(ids("status=closed")).toEqual(["Old TV"]);
    expect(ids("status=active")).toHaveLength(4);
    expect(ids("split=yes")).toEqual(["Car"]);
    expect(ids("q=amex")).toEqual(["Laptop"]); // matches the card name
    expect(ids("q=ravi")).toEqual(["Laptop"]); // and the name on card
    expect(ids("bank=HDFC Bank&status=active&due=month")).toEqual(["Phone"]);
  });
  it("ignores unknown values and counts active filters", () => {
    const f = readFilters(new URLSearchParams("due=someday&status=x&split=maybe&bank=SBI&q=%20&from=2026-01-01"));
    expect(f).toMatchObject({ due: "", status: "", split: "" });
    expect(activeFilters(f)).toEqual(["bank"]);
  });
});

describe("filterOptions", () => {
  it("offers only values present in the loans", () => {
    expect(filterOptions(loans)).toEqual({
      banks: ["Amex", "HDFC Bank", "SBI"],
      cards: [
        { id: "c2", label: "Dad Amex ••1005" },
        { id: "c1", label: "Regalia ••4321" },
      ],
      holders: ["Ravi Rao"],
      ownCards: true,
      types: ["credit_card_emi", "vehicle", "personal"],
      currencies: ["INR", "USD"],
      anySplit: true,
    });
  });
});
