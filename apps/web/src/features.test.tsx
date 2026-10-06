import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { en, type Me } from "@emi/shared";
import { AppRoutes } from "./App";

const me: Me = {
  user: { id: "u", email: "a@b.c", name: "Asha Rao", picture: null },
  settings: {
    country: "IN", currency: "INR", locale: "en-IN", timeZone: "Asia/Kolkata", dateFormat: "DD/MM/YYYY", taxLabel: "GST", taxRate: 18,
    theme: "light", reminderHour: 9, dueWindowDays: 7, reminderDaysBefore: [3, 1], remindOnDay: true, remindOverdue: true, pushEnabled: true,
    emailReminders: true, weeklySummary: false, monthlyIncome: 2_00_000_00, incomeCurrency: "INR",
  },
  features: { email: false, push: true },
};

/** Just the list-item fields these screens read. */
const loan = (id: string, nickname: string, balance: number, rate: number, emi: number, extra: Record<string, unknown> = {}) => ({
  id, nickname, lenderId: "l1", cardId: null, type: "personal", currency: "INR", annualRate: rate, repaymentType: "reducing",
  interestTaxEnabled: false, interestTaxRate: 0, muted: false, createdAt: "2025-01-01", access: "owner", ownerName: null,
  lender: { name: "HDFC Bank", color: "#004C8F", initial: "H" }, card: null, nextInstalment: null,
  summary: { emi }, progress: { principalOutstanding: balance, progress: 0.2, instalmentsLeft: 6 },
  ...extra,
});
const cardEmi = loan("L2", "Phone EMI", 30_000_00, 16, 5_000_00, {
  type: "credit_card_emi", cardId: "c1", interestTaxEnabled: true, interestTaxRate: 18,
  card: { nickname: "Regalia", last4: "4321", holderName: "Ravi Rao" },
});
const personal = loan("L3", "Personal", 2_00_000_00, 12, 10_000_00);

const due = (id: string, amount: number, status: string) => ({
  instalmentId: id, loanId: "L2", loanNickname: "Phone EMI", lenderId: "l1", cardId: "c1", currency: "INR", n: 1,
  billedDate: "2025-06-12", payableDate: "2025-07-02", amount, status,
});
const expense = (id: string, name: string, amount: number, frequency: string, category = "fitness") => ({
  id, name, category, amount, currency: "INR", frequency, active: true, createdAt: "", updatedAt: "",
});

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

const base = { "/me": me, "/lenders": [], "/cards": [], "/notifications": [], "/loans/shared": [] };
afterEach(() => vi.unstubAllGlobals());

describe("loans tab", () => {
  it("shows the card and whose name is on it", async () => {
    mockApi({ ...base, "/loans": [cardEmi, personal] });
    renderAt("/loans");
    expect(await screen.findByText(/Regalia ••4321/)).toBeInTheDocument();
    expect(screen.getByText("Name on card: Ravi Rao")).toBeInTheDocument();
    expect(screen.getAllByText(/Regalia/)).toHaveLength(1); // only the card EMI has a card line
  });
});

describe("budget", () => {
  it("adds this month's EMIs and fixed expenses and shows what's left", async () => {
    mockApi({
      ...base,
      "/instalments": [due("a", 10_000_00, "due"), due("b", 20_000_00, "paid"), due("c", 99_000_00, "skipped")],
      "/expenses": [expense("e1", "Gym", 2_000_00, "monthly"), expense("e2", "YouTube Premium", 1_490_00, "yearly", "subscriptions")],
    });
    renderAt("/budget");
    expect(await screen.findByText("₹2,00,000.00")).toBeInTheDocument(); // income
    expect(screen.getByText("₹30,000.00")).toBeInTheDocument(); // EMIs (skipped excluded)
    expect(screen.getByText("₹20,000.00 already paid")).toBeInTheDocument();
    expect(screen.getByText("₹2,124.17")).toBeInTheDocument(); // 2,000 + 1,490 ÷ 12
    expect(screen.getByText("₹1,67,875.83")).toBeInTheDocument(); // left over
    expect(screen.getByText("₹124.17 / month")).toBeInTheDocument();
    // Presets already added are hidden from quick add.
    expect(screen.queryByRole("button", { name: "YouTube Premium" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claude subscription" })).toBeInTheDocument();
  });
});

describe("extra cash planner", () => {
  it("recommends closing the costliest loan first", async () => {
    mockApi({ ...base, "/loans": [personal, cardEmi] });
    renderAt("/tools");
    fireEvent.click(await screen.findByRole("tab", { name: en.tools.extraCash }));
    fireEvent.change(await screen.findByLabelText(/Amount to use/), { target: { value: "50000" } });
    const steps = await screen.findAllByRole("listitem");
    const plan = steps.map((s) => s.textContent).filter((t) => /^\d(Close|Prepay)/.test(t ?? ""));
    expect(plan[0]).toMatch(/^1Close Phone EMI\s*— Pay ₹30,000\.00/);
    expect(plan[1]).toMatch(/^2Prepay Personal\s*— Pay ₹20,000\.00/);
  });
});

describe("mobile navigation", () => {
  it("has Budget in the bottom bar and Settings in the top bar", async () => {
    mockApi({ ...base, "/loans": [], "/expenses": [], "/instalments": [] });
    renderAt("/budget");
    await screen.findByText(en.budget.intro);
    const [, bottom] = screen.getAllByRole("navigation", { name: en.nav.mainNavigation });
    expect(bottom!.textContent).toContain(en.nav.budget);
    expect(bottom!.textContent).not.toContain(en.nav.settings);
    expect(screen.getAllByRole("link", { name: en.nav.settings }).length).toBeGreaterThanOrEqual(2); // sidebar + top-bar gear
  });
});
