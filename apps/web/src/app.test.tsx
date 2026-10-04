import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { en, type Dashboard, type Me } from "@emi/shared";
import { AppRoutes } from "./App";

const me: Me = {
  user: { id: "u", email: "a@b.c", name: "Asha Rao", picture: null },
  settings: {
    country: "IN", currency: "INR", locale: "en-IN", timeZone: "Asia/Kolkata", dateFormat: "DD/MM/YYYY", taxLabel: "GST", taxRate: 18,
    theme: "light", reminderHour: 9, dueWindowDays: 7, reminderDaysBefore: [3, 1], remindOnDay: true, remindOverdue: true, pushEnabled: true,
    emailReminders: true, weeklySummary: false,
  },
};

const item = (id: string, loan: string, amount: number, currency = "INR", cardId: string | null = null) => ({
  instalmentId: id, loanId: loan, loanNickname: loan, lenderId: "l1", cardId, currency, n: 1,
  billedDate: "2025-06-12", payableDate: "2025-07-02", amount, status: "due" as const,
});

const dashboard: Dashboard = {
  today: "2025-06-28",
  payableThisMonth: { INR: 1_23_456_78, USD: 100_00 },
  next7Days: { INR: 50_000_00 },
  next30Days: { INR: 75_000_00, USD: 100_00 },
  overdue: {},
  outstanding: { INR: 45_00_000_00, USD: 1_499_00 },
  byLender: { l1: { INR: 45_00_000_00 } },
  byType: { home: { INR: 45_00_000_00 }, bnpl: { USD: 1_499_00 } },
  upcoming: [
    { key: "card:c1:2025-07-02:INR", cardId: "c1", payableDate: "2025-07-02", currency: "INR", total: 30_000_00, items: [item("a", "iPhone", 10_000_00, "INR", "c1"), item("b", "Laptop", 20_000_00, "INR", "c1")] },
  ],
  activeLoans: 3,
};

function mockApi(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url).replace(/^.*\/api/, "").split("?")[0]!;
      if (!(path in routes)) return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
      return new Response(JSON.stringify(routes[path]), { status: 200 });
    }),
  );
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("app shell", () => {
  it("shows the sign-in screen when not authenticated", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401 })));
    renderAt("/");
    expect(await screen.findByText(en.auth.tagline)).toBeInTheDocument();
  });

  it("dashboard shows per-currency totals (lakh grouping) and groups card EMIs into one pay-by", async () => {
    mockApi({
      "/me": me,
      "/dashboard": dashboard,
      "/lenders": [{ id: "l1", name: "HDFC Bank", country: "IN", color: "#004C8F", initial: "H", custom: false }],
      "/cards": [{ id: "c1", nickname: "Regalia", lenderId: "l1", last4: "4321", statementDay: 12, dueDay: 2, graceDays: null }],
      "/notifications": [],
    });
    renderAt("/");
    expect(await screen.findByText("Hi Asha")).toBeInTheDocument();
    const tile = screen.getByText(en.dashboard.payableThisMonth).closest("div.card") as HTMLElement;
    expect(within(tile).getByText("₹1,23,456.78")).toBeInTheDocument();
    expect(within(tile).getByText("$100.00")).toBeInTheDocument();
    expect(screen.getByText("2 EMIs on Regalia")).toBeInTheDocument();
    expect(screen.getByText("₹30,000.00")).toBeInTheDocument();
    // Two navigation landmarks (sidebar + bottom bar) with accessible names
    expect(screen.getAllByRole("navigation", { name: en.nav.mainNavigation }).length).toBe(2);
  });
});

describe("i18n coverage", () => {
  it("every t('key') used in the web app exists in the English strings", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f) && !f.includes(".test.")) files.push(p);
      }
    };
    walk(join(__dirname));
    const missing: string[] = [];
    const has = (key: string) => {
      const v = key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], en);
      return v !== undefined;
    };
    for (const f of files) {
      for (const m of readFileSync(f, "utf8").matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"/g)) {
        if (!has(m[1]!) && !has(m[1]! + "_one")) missing.push(`${f}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
