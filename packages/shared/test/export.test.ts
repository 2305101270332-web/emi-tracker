import { describe, expect, it } from "vitest";
import { duesToIcs, scheduleToCsv, type Instalment, type UpcomingItem } from "../src";

const inst = (n: number, over: Partial<Instalment> = {}): Instalment => ({
  id: `L:${n}`, loanId: "L", n, billedDate: "2025-02-05", payableDate: "2025-02-25", opening: 100_000_00, interest: 1_000_00,
  principal: 7_884_88, emi: 8_884_88, interestTax: 180_00, fees: 0, shiftCost: 0, totalPayable: 9_064_88, closing: 92_115_12,
  overridden: false, skipped: false, status: "upcoming", payment: null, ...over,
});

describe("CSV export", () => {
  it("writes plain decimal amounts with a BOM and quoted fields", () => {
    const csv = scheduleToCsv({ currency: "INR", nickname: "x", taxLabel: "GST" }, [inst(1, { status: "paid", payment: { id: "p", paidDate: "2025-02-20", amountPaid: 9_064_88, lateFee: 0, note: null } })]);
    expect(csv.startsWith("\uFEFF#,Billed,Pay by,Opening (INR)")).toBe(true);
    expect(csv).toContain("GST (INR)");
    const row = csv.split("\r\n")[1]!;
    expect(row).toBe("1,2025-02-05,2025-02-25,100000.00,1000.00,7884.88,180.00,0.00,0.00,9064.88,92115.12,Paid,2025-02-20,9064.88");
  });
  it("handles zero-decimal currencies", () => {
    const csv = scheduleToCsv({ currency: "JPY", nickname: "x", taxLabel: "None" }, [inst(1, { opening: 100000 })]);
    expect(csv.split("\r\n")[1]!.split(",")[3]).toBe("100000");
  });
});

describe("ICS export", () => {
  const item = (id: string, over: Partial<UpcomingItem> = {}): UpcomingItem => ({
    instalmentId: id, loanId: "L", loanNickname: "Car, loan; test", lenderId: "x", cardId: null, currency: "INR", n: 3,
    billedDate: "2025-03-12", payableDate: "2025-04-02", amount: 1_23_456_78, status: "upcoming", ...over,
  });
  it("creates valid all-day events with escaped text and CRLF", () => {
    const ics = duesToIcs([item("L:3"), item("L:4", { status: "paid" })], { locale: "en-IN", alarmDaysBefore: 1, now: new Date("2025-01-01T00:00:00Z") });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics).toContain("DTSTART;VALUE=DATE:20250402\r\nDTEND;VALUE=DATE:20250403");
    expect(ics).toContain("UID:L:3@emi-tracker");
    expect(ics).toContain(String.raw`SUMMARY:Car\, loan\; test #3: ₹1\,23\,456.78`);
    expect(ics).toContain("TRIGGER:-P1D");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1); // paid instalment skipped
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
