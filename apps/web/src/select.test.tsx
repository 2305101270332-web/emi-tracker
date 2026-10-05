import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SelectField } from "./components/ui";

function Harness({ onChange }: { onChange: (v: string) => void }) {
  const [v, setV] = useState("b");
  return (
    <SelectField
      label="Fruit"
      value={v}
      onChange={(e) => {
        setV(e.target.value);
        onChange(e.target.value);
      }}
    >
      <option value="a">Apple</option>
      <option value="b">Banana</option>
      <option value="c" disabled>
        Cherry
      </option>
      <option value="d">Date</option>
    </SelectField>
  );
}

describe("custom select (ARIA select-only combobox)", () => {
  it("is labelled, shows the current value and opens a listbox", () => {
    render(<Harness onChange={() => undefined} />);
    const combo = screen.getByRole("combobox", { name: "Fruit" });
    expect(combo).toHaveTextContent("Banana");
    expect(combo).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(combo);
    expect(combo).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Banana" })).toHaveAttribute("aria-selected", "true");
  });

  it("supports keyboard: arrows skip disabled options, Enter selects, Escape cancels", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const combo = screen.getByRole("combobox", { name: "Fruit" });
    fireEvent.keyDown(combo, { key: "ArrowDown" }); // opens on Banana
    fireEvent.keyDown(combo, { key: "ArrowDown" }); // Cherry is disabled -> Date
    expect(combo.getAttribute("aria-activedescendant")).toMatch(/opt-3$/);
    fireEvent.keyDown(combo, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("d");
    expect(combo).toHaveTextContent("Date");
    expect(screen.queryByRole("listbox")).toBeNull();

    fireEvent.keyDown(combo, { key: "Home" });
    fireEvent.keyDown(combo, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(combo).toHaveTextContent("Date"); // unchanged
  });

  it("supports type-ahead and mouse selection", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const combo = screen.getByRole("combobox", { name: "Fruit" });
    fireEvent.keyDown(combo, { key: "a" }); // jumps to Apple and opens
    fireEvent.keyDown(combo, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("a");
    fireEvent.click(combo);
    fireEvent.click(screen.getByRole("option", { name: "Date" }));
    expect(onChange).toHaveBeenLastCalledWith("d");
  });
});

describe("settings about panel", () => {
  it("shows the web build and the deployed API version with timestamps", async () => {
    const { AppRoutes } = await import("./App");
    const me = {
      user: { id: "u", email: "a@b.c", name: "Asha", picture: null },
      settings: {
        country: "IN", currency: "INR", locale: "en-IN", timeZone: "Asia/Kolkata", dateFormat: "DD/MM/YYYY", taxLabel: "GST", taxRate: 18,
        theme: "light", reminderHour: 9, dueWindowDays: 7, reminderDaysBefore: [3, 1], remindOnDay: true, remindOverdue: true, pushEnabled: true,
        emailReminders: true, weeklySummary: false, monthlyIncome: null, incomeCurrency: null,
      },
      features: { email: false, push: true },
    };
    const routes: Record<string, unknown> = {
      "/me": me, "/lenders": [], "/notifications": [],
      "/version": { environment: "production", commit: "fedcba9876543210fedcba9876543210fedcba98", versionId: "8f3c2a10-aaaa-bbbb", deployedAt: "2026-10-05T09:12:00.000Z" },
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = String(url).replace(/^.*\/api/, "").split("?")[0]!;
      return path in routes ? new Response(JSON.stringify(routes[path]), { status: 200 }) : new Response("{}", { status: 404 });
    }));
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/settings"]}>
          <AppRoutes />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("About this app")).toBeInTheDocument();
    const webLink = screen.getByRole("link", { name: /0123456/ });
    expect(webLink).toHaveAttribute("href", "https://github.com/example/emi-tracker/commit/0123456789abcdef0123456789abcdef01234567");
    expect(await screen.findByRole("link", { name: /fedcba9/ })).toBeInTheDocument();
    // 09:12 UTC shown in the user's zone (Asia/Kolkata = 14:42)
    expect(screen.getByText(/2:42/)).toBeInTheDocument();
    expect(screen.getByText("production")).toBeInTheDocument();
    // Email is off on this server: toggles hidden, explanation shown
    expect(screen.getByText(/Email reminders aren't enabled/)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
