import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonthsClamped,
  daysBetween,
  daysInMonth,
  hourInZone,
  isLeapYear,
  isValidISODate,
  todayInZone,
} from "../src";

describe("dates", () => {
  it("validates ISO dates including leap days", () => {
    expect(isValidISODate("2024-02-29")).toBe(true);
    expect(isValidISODate("2025-02-29")).toBe(false);
    expect(isValidISODate("2025-13-01")).toBe(false);
    expect(isValidISODate("2025-1-01")).toBe(false);
  });
  it("leap year rules", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
  });
  it("adds months clamping to month end", () => {
    expect(addMonthsClamped("2025-01-31", 1)).toBe("2025-02-28");
    expect(addMonthsClamped("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonthsClamped("2025-01-30", 1)).toBe("2025-02-28");
    expect(addMonthsClamped("2025-03-31", 1)).toBe("2025-04-30");
    // day is re-applied after a short month, not stuck at 28
    expect(addMonthsClamped("2025-01-31", 2)).toBe("2025-03-31");
    expect(addMonthsClamped("2025-11-15", 3)).toBe("2026-02-15");
    expect(addMonthsClamped("2025-02-28", 1, 31)).toBe("2025-03-31");
  });
  it("counts days across leap years and DST", () => {
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2);
    expect(daysBetween("2025-02-28", "2025-03-01")).toBe(1);
    expect(daysBetween("2025-03-29", "2025-03-31")).toBe(2); // EU DST switch
    expect(addDays("2024-12-31", 1)).toBe("2025-01-01");
    expect(addDays("2025-03-01", -1)).toBe("2025-02-28");
  });
  it("computes today/hour in a time zone", () => {
    const now = new Date("2025-06-30T20:30:00Z");
    expect(todayInZone("Asia/Kolkata", now)).toBe("2025-07-01");
    expect(todayInZone("America/Los_Angeles", now)).toBe("2025-06-30");
    expect(hourInZone("Asia/Kolkata", now)).toBe(2);
    expect(hourInZone("UTC", now)).toBe(20);
  });
});
