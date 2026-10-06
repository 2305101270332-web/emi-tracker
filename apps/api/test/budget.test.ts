import { beforeEach, describe, expect, it } from "vitest";
import { MAX_EXPENSES_PER_USER } from "@emi/shared";
import { resetRateLimits } from "../src/lib/security";
import { client, createUser, makeEnv } from "./helpers";

const gym = { name: "Gym", category: "fitness", amount: 2_000_00, currency: "INR" };
const cardLoan = (cardId: string) => ({
  lenderId: "seed-in-icici-bank",
  type: "credit_card_emi",
  cardId,
  nickname: "Phone on Dad's card",
  currency: "INR",
  principal: 60_000_00,
  annualRate: 15,
  tenureMonths: 6,
  repaymentType: "reducing",
  bookingDate: "2025-01-05",
  firstEmiDate: "2025-02-10",
  emiDay: 10,
});

let env: ReturnType<typeof makeEnv>;
let alice: ReturnType<typeof client>;
let bob: ReturnType<typeof client>;
beforeEach(async () => {
  resetRateLimits();
  env = makeEnv();
  alice = client(env);
  alice.setCookie(await createUser(env, "alice"));
  bob = client(env);
  bob.setCookie(await createUser(env, "bob"));
});

describe("fixed expenses", () => {
  it("creates, lists, updates and deletes", async () => {
    const created = await alice.post("/expenses", gym);
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ ...gym, frequency: "monthly", active: true });
    await alice.post("/expenses", { name: "YouTube", category: "subscriptions", amount: 1_490_00, currency: "INR", frequency: "yearly" });

    const list = await alice.get("/expenses");
    expect(list.json.map((e: { name: string }) => e.name)).toEqual(["Gym", "YouTube"]); // by category, then name

    const upd = await alice.put(`/expenses/${created.json.id}`, { ...gym, amount: 2_500_00, active: false });
    expect(upd.json).toMatchObject({ amount: 2_500_00, active: false });

    expect((await alice.del(`/expenses/${created.json.id}`)).status).toBe(204);
    expect((await alice.get("/expenses")).json).toHaveLength(1);
  });

  it("validates input", async () => {
    expect((await alice.post("/expenses", { ...gym, amount: -1 })).status).toBe(400);
    expect((await alice.post("/expenses", { ...gym, currency: "rupees" })).status).toBe(400);
    expect((await alice.post("/expenses", { ...gym, frequency: "weekly" })).status).toBe(400);
  });

  it("keeps each user's expenses private", async () => {
    const mine = await alice.post("/expenses", gym);
    expect((await bob.get("/expenses")).json).toEqual([]);
    expect((await bob.put(`/expenses/${mine.json.id}`, gym)).status).toBe(404);
    expect((await bob.del(`/expenses/${mine.json.id}`)).status).toBe(404);
    expect((await alice.get("/expenses")).json).toHaveLength(1);
  });

  it("caps the number of expenses per user", async () => {
    const stmt = env.DB.db.prepare("INSERT INTO expenses (id, user_id, name, category, amount, currency, frequency) VALUES (?, 'alice', 'x', 'other', 1, 'INR', 'monthly')");
    for (let i = 0; i < MAX_EXPENSES_PER_USER; i++) stmt.run(`e${i}`);
    expect((await alice.post("/expenses", gym)).status).toBe(422);
  });

  it("is included in the data export and removed with the account", async () => {
    await alice.post("/expenses", gym);
    expect((await alice.get("/account/export")).json.expenses).toHaveLength(1);
    expect((await alice.raw("DELETE", "/account", { confirmEmail: "alice@example.com" })).status).toBe(204);
    expect(env.DB.db.prepare("SELECT COUNT(*) AS n FROM expenses").get()).toEqual({ n: 0 });
  });
});

describe("name on card", () => {
  it("stores the holder and shows the card on the owner's loans only", async () => {
    const card = await alice.post("/cards", { nickname: "Dad's Amex", last4: "1005", holderName: "R. Sharma", statementDay: 12, dueDay: 2 });
    expect(card.json.holderName).toBe("R. Sharma");
    const loan = await alice.post("/loans", cardLoan(card.json.id));
    const snapshot = { nickname: "Dad's Amex", last4: "1005", holderName: "R. Sharma" };
    expect(loan.json.card).toEqual(snapshot);
    expect((await alice.get("/loans")).json[0].card).toEqual(snapshot);

    // Clearing the name makes it the user's own card again.
    await alice.put(`/cards/${card.json.id}`, { nickname: "Dad's Amex", last4: "1005", holderName: "", statementDay: 12, dueDay: 2 });
    expect((await alice.get("/loans")).json[0].card.holderName).toBeNull();

    // A shared user never sees the owner's card.
    await alice.post(`/loans/${loan.json.id}/shares`, { email: "bob@example.com", access: "view" });
    expect((await bob.get("/loans/shared")).json[0].card).toBeNull();
    expect((await bob.get(`/loans/${loan.json.id}`)).json.card).toBeNull();
  });

  it("is null for loans that aren't on a card", async () => {
    const res = await alice.post("/loans", { ...cardLoan("x"), type: "personal", cardId: null });
    expect(res.json.card).toBeNull();
  });
});

describe("loan splits and pre-closure charge", () => {
  it("are saved with the loan without changing its schedule", async () => {
    const terms = { ...cardLoan("x"), type: "personal", cardId: null };
    const plain = await alice.post("/loans", terms);
    const extras = {
      prepaymentCharge: { kind: "flat", amount: 500_00 },
      prepaymentChargeTaxRate: 18,
      splits: [{ name: "Rahul", kind: "flat", amount: 1_000_00 }, { name: "Priya", kind: "percent", percent: 25 }],
    };
    const split = await alice.post("/loans", { ...terms, ...extras });
    expect(split.status).toBe(201);
    expect(split.json).toMatchObject(extras);
    expect(split.json.summary).toEqual(plain.json.summary);
    expect((await alice.get(`/loans/${split.json.id}`)).json).toMatchObject(extras);

    // Editing keeps them; sending none clears them.
    const kept = await alice.put(`/loans/${split.json.id}`, { ...terms, ...extras, nickname: "Renamed" });
    expect(kept.json).toMatchObject({ nickname: "Renamed", ...extras });
    const cleared = await alice.put(`/loans/${split.json.id}`, terms);
    expect(cleared.json).toMatchObject({ splits: [], prepaymentCharge: { kind: "none" }, prepaymentChargeTaxRate: 0 });
  });

  it("rejects splits over 100%", async () => {
    const res = await alice.post("/loans", { ...cardLoan("x"), type: "personal", cardId: null, splits: [{ name: "A", kind: "percent", percent: 101 }] });
    expect(res.status).toBe(400);
  });
});
