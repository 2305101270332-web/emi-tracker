import { beforeEach, describe, expect, it } from "vitest";
import { addDays, addMonthsClamped, todayInZone } from "@emi/core";
import { APP_ORIGIN, client, createUser, makeEnv } from "./helpers";

const loan = (over: Record<string, unknown> = {}) => ({
  lenderId: "seed-in-icici-bank",
  type: "personal",
  nickname: "Test loan",
  currency: "INR",
  principal: 100_000_00,
  annualRate: 12,
  tenureMonths: 12,
  repaymentType: "reducing",
  bookingDate: "2025-01-05",
  firstEmiDate: "2025-02-05",
  emiDay: 5,
  ...over,
});

describe("auth & ownership", () => {
  let env: ReturnType<typeof makeEnv>;
  beforeEach(() => {
    env = makeEnv();
  });

  it("rejects unauthenticated requests", async () => {
    const c = client(env);
    expect((await c.get("/loans")).status).toBe(401);
    expect((await c.get("/me")).status).toBe(401);
  });

  it("dev login creates the user with country defaults and an HttpOnly Secure SameSite cookie", async () => {
    const c = client(env);
    const res = await c.post("/auth/dev");
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const me = await c.get("/me");
    expect(me.json.user.email).toBe("demo@example.com");
    expect(me.json.settings).toMatchObject({ country: "IN", currency: "INR", taxLabel: "GST", taxRate: 18 });
  });

  it("dev login is disabled in production", async () => {
    const prod = makeEnv({ ENVIRONMENT: "production" });
    expect((await client(prod).post("/auth/dev")).status).toBe(404);
  });

  it("rejects a tampered session", async () => {
    const c = client(env);
    c.setCookie("emi_session=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.bad");
    expect((await c.get("/me")).status).toBe(401);
  });

  it("isolates every resource by user", async () => {
    const a = client(env);
    a.setCookie(await createUser(env, "alice"));
    const b = client(env);
    b.setCookie(await createUser(env, "bob"));

    const created = await a.post("/loans", loan());
    expect(created.status).toBe(201);
    const loanId = created.json.id;
    const instId = created.json.instalments[0].id;

    expect((await b.get(`/loans/${loanId}`)).status).toBe(404);
    expect((await b.put(`/loans/${loanId}`, loan())).status).toBe(404);
    expect((await b.del(`/loans/${loanId}`)).status).toBe(404);
    expect((await b.post(`/instalments/${instId}/payment`, { paidDate: "2025-02-05", amountPaid: 1 })).status).toBe(404);
    expect((await b.get("/loans")).json).toHaveLength(0);

    const card = await a.post("/cards", { nickname: "A card", statementDay: 5, dueDay: 25 });
    expect((await b.del(`/cards/${card.json.id}`)).status).toBe(404);
    // Bob cannot attach Alice's card to his loan
    const stolen = await b.post("/loans", loan({ type: "credit_card_emi", cardId: card.json.id }));
    expect(stolen.status).toBe(422);
  });
});

describe("loans", () => {
  let env: ReturnType<typeof makeEnv>;
  let c: ReturnType<typeof client>;
  beforeEach(async () => {
    env = makeEnv();
    c = client(env);
    c.setCookie(await createUser(env, "u1"));
  });

  it("validates input and returns field issues", async () => {
    const res = await c.post("/loans", loan({ principal: 10.5, bookingDate: "2025-02-30" }));
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("validation_error");
    const paths = res.json.issues.map((i: any) => i.path.join("."));
    expect(paths).toContain("principal");
    expect(paths).toContain("bookingDate");
  });

  it("rejects unknown lenders", async () => {
    expect((await c.post("/loans", loan({ lenderId: "nope" }))).status).toBe(422);
  });

  it("creates a loan with a full schedule and summary", async () => {
    const res = await c.post("/loans", loan({ interestTaxEnabled: true, interestTaxRate: 18, taxLabel: "GST" }));
    expect(res.status).toBe(201);
    expect(res.json.instalments).toHaveLength(12);
    expect(res.json.summary.emi).toBe(8_884_88);
    expect(res.json.instalments[0]).toMatchObject({ id: `${res.json.id}:1`, billedDate: "2025-02-05", payableDate: "2025-02-05", interestTax: 180_00 });
    expect(res.json.instalments.at(-1).closing).toBe(0);
  });

  it("derives card EMI payable dates from the statement cycle", async () => {
    const card = await c.post("/cards", { nickname: "Card", statementDay: 12, dueDay: 2 });
    expect(card.status).toBe(201);
    const res = await c.post(
      "/loans",
      loan({ type: "credit_card_emi", cardId: card.json.id, firstEmiDate: "2025-02-10", emiDay: 10 }),
    );
    expect(res.status).toBe(201);
    // Billed Feb 10 -> statement Feb 12 -> due Mar 2
    expect(res.json.instalments[0]).toMatchObject({ billedDate: "2025-02-10", payableDate: "2025-03-02" });

    // Changing the card's cycle re-derives payable dates
    await c.put(`/cards/${card.json.id}`, { nickname: "Card", statementDay: 15, graceDays: 20 });
    const after = await c.get(`/loans/${res.json.id}`);
    expect(after.json.instalments[0].payableDate).toBe("2025-03-07"); // Feb 15 + 20
    expect((await c.del(`/cards/${card.json.id}`)).status).toBe(409);
  });

  it("applies a manual override and keeps tenure", async () => {
    const created = await c.post("/loans", loan());
    const res = await c.put(`/loans/${created.json.id}/instalments/3/override`, { amount: 10_000_00 });
    expect(res.status).toBe(200);
    expect(res.json.instalments).toHaveLength(12);
    expect(res.json.instalments[2]).toMatchObject({ emi: 10_000_00, overridden: true });
    expect(res.json.instalments.at(-1).closing).toBe(0);
    // Overriding the last instalment is refused, and the schedule is unchanged
    expect((await c.put(`/loans/${created.json.id}/instalments/12/override`, { amount: 1 })).status).toBe(422);
    // Clearing restores the calculated EMI
    const cleared = await c.put(`/loans/${created.json.id}/instalments/3/override`, { amount: null });
    expect(cleared.json.instalments[2]).toMatchObject({ emi: 8_884_88, overridden: false });
  });

  it("rolls back a loan edit that makes the schedule invalid", async () => {
    const created = await c.post("/loans", loan());
    await c.put(`/loans/${created.json.id}/instalments/3/override`, { amount: 50_000_00 });
    // Shrinking principal makes the existing override overpay -> 422 and terms unchanged
    const res = await c.put(`/loans/${created.json.id}`, loan({ principal: 20_000_00 }));
    expect(res.status).toBe(422);
    expect((await c.get(`/loans/${created.json.id}`)).json.principal).toBe(100_000_00);
  });

  it("tracks payments, skip and progress, preserving payments across edits", async () => {
    const created = await c.post("/loans", loan());
    const i1 = created.json.instalments[0];
    const paid = await c.post(`/instalments/${i1.id}/payment`, { paidDate: "2025-02-05", amountPaid: i1.totalPayable, lateFee: 0 });
    expect(paid.json.instalments[0].status).toBe("paid");
    expect(paid.json.progress.instalmentsPaid).toBe(1);
    expect(paid.json.progress.principalOutstanding).toBe(100_000_00 - i1.principal);
    expect(paid.json.progress.interestPaid).toBe(1_000_00);

    const skipped = await c.patch(`/instalments/${created.json.instalments[1].id}`, { skipped: true });
    expect(skipped.json.instalments[1].status).toBe("skipped");

    // Editing the nickname regenerates but keeps payment + skip
    const edited = await c.put(`/loans/${created.json.id}`, loan({ nickname: "Renamed" }));
    expect(edited.json.instalments[0].payment).not.toBeNull();
    expect(edited.json.instalments[1].skipped).toBe(true);

    const undone = await c.del(`/instalments/${i1.id}/payment`);
    expect(undone.json.instalments[0].payment).toBeNull();
  });

  it("dashboard groups by currency and never sums across currencies", async () => {
    const today = todayInZone("Asia/Kolkata");
    const soon = addDays(today, 3);
    await c.post("/loans", loan({ bookingDate: addMonthsClamped(soon, -1), firstEmiDate: soon, emiDay: Number(soon.slice(8)) }));
    await c.post(
      "/loans",
      loan({ lenderId: "seed-us-chase", currency: "USD", principal: 1_000_00, bookingDate: addMonthsClamped(soon, -1), firstEmiDate: soon, emiDay: Number(soon.slice(8)) }),
    );
    const d = await c.get("/dashboard");
    expect(d.status).toBe(200);
    expect(Object.keys(d.json.next7Days).sort()).toEqual(["INR", "USD"]);
    expect(d.json.next7Days.INR).toBe(8_884_88);
    expect(d.json.outstanding).toEqual({ INR: 100_000_00, USD: 1_000_00 });
    expect(d.json.byLender["seed-in-icici-bank"]).toEqual({ INR: 100_000_00 });
    expect(d.json.upcoming.length).toBe(2);
    expect(d.json.activeLoans).toBe(2);
  });

  it("calendar range lists instalments with billed and payable dates", async () => {
    await c.post("/loans", loan());
    const res = await c.get("/instalments?from=2025-02-01&to=2025-04-30");
    expect(res.json).toHaveLength(3);
    expect(res.json[0]).toMatchObject({ billedDate: "2025-02-05", payableDate: "2025-02-05", loanNickname: "Test loan" });
    expect((await c.get("/instalments?from=bad&to=2025-01-01")).status).toBe(400);
  });

  it("custom lenders are private and protected while in use", async () => {
    const l = await c.post("/lenders", { name: "Local Credit Union", country: "IN", color: "#123456" });
    expect(l.status).toBe(201);
    expect(l.json.initial).toBe("L");
    const created = await c.post("/loans", loan({ lenderId: l.json.id }));
    expect(created.status).toBe(201);
    expect((await c.del(`/lenders/${l.json.id}`)).status).toBe(409);
    const lenders = await c.get("/lenders");
    expect(lenders.json.some((x: any) => x.id === l.json.id && x.custom)).toBe(true);
    expect(lenders.json.filter((x: any) => x.country === "IN").length).toBeGreaterThan(9);
  });

  it("updates settings with validation", async () => {
    const ok = await c.patch("/settings", { timeZone: "Europe/London", reminderDaysBefore: [1, 3, 3], currency: "GBP" });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ timeZone: "Europe/London", reminderDaysBefore: [3, 1], currency: "GBP" });
    expect((await c.patch("/settings", { timeZone: "Nowhere/City" })).status).toBe(400);
  });

  it("deletes a loan and everything under it", async () => {
    const created = await c.post("/loans", loan());
    expect((await c.del(`/loans/${created.json.id}`)).status).toBe(204);
    const left = env.DB.db.prepare("SELECT COUNT(*) AS c FROM instalments").get() as { c: number };
    expect(left.c).toBe(0);
  });
});

describe("http hardening", () => {
  it("locks CORS to the app origin", async () => {
    const env = makeEnv();
    const c = client(env);
    const good = await c.raw("OPTIONS", "/health", undefined, { Origin: APP_ORIGIN, "Access-Control-Request-Method": "POST" });
    expect(good.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN);
    expect(good.headers.get("access-control-allow-credentials")).toBe("true");
    const bad = await c.raw("OPTIONS", "/health", undefined, { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" });
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("blocks cross-site state changes", async () => {
    const env = makeEnv();
    const c = client(env);
    c.setCookie(await createUser(env, "u1"));
    const res = await c.post("/loans", loan(), { Origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });

  it("rate limits", async () => {
    const env = makeEnv();
    const c = client(env);
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await c.post("/auth/google", { credential: "x".repeat(30) }, { "CF-Connecting-IP": "9.9.9.9" })).status;
    expect(last).toBe(429);
  });
});

describe("demo seed", () => {
  it("creates valid sample loans, including card EMIs and a USD loan", async () => {
    const env = makeEnv();
    const c = client(env);
    await c.post("/auth/dev");
    const res = await c.post("/auth/dev/seed");
    expect(res.json.created).toBe(6);
    const loans = await c.get("/loans");
    expect(loans.json).toHaveLength(6);
    const d = await c.get("/dashboard");
    expect(Object.keys(d.json.outstanding).sort()).toEqual(["INR", "USD"]);
    expect((await c.post("/auth/dev/seed")).json.created).toBe(0); // idempotent
  });
});
