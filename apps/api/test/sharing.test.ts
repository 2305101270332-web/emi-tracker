import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "../src/lib/security";
import { client, createUser, makeEnv } from "./helpers";

/**
 * Sharing rules (docs/DECISIONS.md "Sharing"), one test per rule, in the style of the
 * cross-user isolation tests: owner = alice, invitee = bob, outsider = eve.
 */

const loan = (over: Record<string, unknown> = {}) => ({
  lenderId: "seed-in-icici-bank",
  type: "personal",
  nickname: "Alice personal",
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
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x0a]);

let env: ReturnType<typeof makeEnv>;
let alice: ReturnType<typeof client>;
let bob: ReturnType<typeof client>;
let eve: ReturnType<typeof client>;
let shared: { id: string; instalments: { id: string; n: number }[] };
let other: { id: string };
const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ id: "x" }), { status: 200 }));

async function share(access: "view" | "edit", email = "bob@example.com") {
  const res = await alice.post(`/loans/${shared.id}/shares`, { email, access });
  expect([200, 201]).toContain(res.status);
  return res.json as { id: string; email: string; access: string; status: string }[];
}

beforeEach(async () => {
  resetRateLimits();
  env = makeEnv({ RESEND_API_KEY: "re_test", RESEND_FROM: "EMI <r@example.com>" });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  alice = client(env);
  alice.setCookie(await createUser(env, "alice"));
  bob = client(env);
  bob.setCookie(await createUser(env, "bob"));
  eve = client(env);
  eve.setCookie(await createUser(env, "eve"));
  const card = await alice.post("/cards", { nickname: "Alice card", statementDay: 12, dueDay: 2 });
  shared = (await alice.post("/loans", loan({ type: "credit_card_emi", cardId: card.json.id, nickname: "Shared phone EMI" }))).json;
  other = (await alice.post("/loans", loan({ nickname: "Alice private loan" }))).json;
  await alice.raw("POST", `/loans/${shared.id}/documents?filename=private.pdf`, PDF);
  await alice.patch("/settings", { monthlyIncome: 1_50_000_00, incomeCurrency: "INR" });
});
afterEach(() => vi.unstubAllGlobals());

describe("inviting", () => {
  it("sends the invite by Resend email to the invited address, once", async () => {
    await share("view");
    await new Promise((r) => setTimeout(r, 0));
    const calls = fetchMock.mock.calls.filter(([u]) => String(u).includes("api.resend.com"));
    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0]![1]!.body));
    expect(body.to).toEqual(["bob@example.com"]);
    expect(body.subject).toContain("shared a loan");
    await share("edit"); // access change: no second email
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("api.resend.com"))).toHaveLength(1);
  });

  it("links an existing account immediately, and a new one when they sign in with Google using that email", async () => {
    expect((await share("view"))[0]).toMatchObject({ email: "bob@example.com", status: "active" });
    // demo@example.com has no account yet -> pending until they sign in
    const list = await share("view", "demo@example.com");
    expect(list.find((s) => s.email === "demo@example.com")!.status).toBe("pending");
    const demo = client(env);
    await demo.post("/auth/dev"); // signs in as demo@example.com (verified email)
    expect((await demo.get(`/loans/${shared.id}`)).status).toBe(200);
  });

  it("emails are case-insensitive and you can't share with yourself", async () => {
    await alice.post(`/loans/${shared.id}/shares`, { email: "BOB@Example.com", access: "view" });
    expect((await bob.get(`/loans/${shared.id}`)).status).toBe(200);
    expect((await alice.post(`/loans/${shared.id}/shares`, { email: "alice@example.com", access: "view" })).status).toBe(422);
  });

  it("an invite to one email never grants access to a different account", async () => {
    await share("edit", "someone.else@example.com");
    expect((await bob.get(`/loans/${shared.id}`)).status).toBe(404);
    expect((await eve.get(`/loans/${shared.id}`)).status).toBe(404);
  });
});

describe("view access is read-only everywhere", () => {
  beforeEach(async () => {
    await share("view");
  });

  it("can read the shared loan's schedule", async () => {
    const res = await bob.get(`/loans/${shared.id}`);
    expect(res.status).toBe(200);
    expect(res.json.access).toBe("view");
    expect(res.json.instalments).toHaveLength(12);
    expect(res.json.ownerName).toBe("alice");
    expect(res.json.lender).toMatchObject({ name: "ICICI Bank" });
  });

  it("cannot record or undo payments, skip, or override", async () => {
    const inst = shared.instalments[0]!;
    expect((await bob.post(`/instalments/${inst.id}/payment`, { paidDate: "2025-02-05", amountPaid: 1 })).status).toBe(403);
    expect((await bob.del(`/instalments/${inst.id}/payment`)).status).toBe(403);
    expect((await bob.patch(`/instalments/${inst.id}`, { skipped: true })).status).toBe(403);
    expect((await bob.put(`/loans/${shared.id}/instalments/2/override`, { amount: 1 })).status).toBe(403);
  });

  it("cannot edit terms, add rate changes, mute or delete", async () => {
    expect((await bob.put(`/loans/${shared.id}`, loan({ nickname: "hacked" }))).status).toBe(403);
    expect((await bob.post(`/loans/${shared.id}/rate-changes`, { effectiveDate: "2025-06-01", annualRate: 1 })).status).toBe(403);
    expect((await bob.patch(`/loans/${shared.id}/mute`, { muted: true })).status).toBe(403);
    expect((await bob.del(`/loans/${shared.id}`)).status).toBe(403);
    expect((await alice.get(`/loans/${shared.id}`)).json.nickname).toBe("Shared phone EMI");
  });

  it("cannot upload, see, download or delete documents", async () => {
    const detail = await bob.get(`/loans/${shared.id}`);
    expect(detail.json.documents).toEqual([]);
    const docId = (await alice.get(`/loans/${shared.id}`)).json.documents[0].id;
    expect((await bob.get(`/documents/${docId}`)).status).toBe(404);
    expect((await bob.del(`/documents/${docId}`)).status).toBe(404);
    expect((await bob.raw("POST", `/loans/${shared.id}/documents?filename=x.pdf`, PDF)).status).toBe(404);
    expect(env.DOCS.objects.size).toBe(1);
  });
});

describe("edit access", () => {
  beforeEach(async () => {
    await share("edit");
  });

  it("can record payments, skip, override and add rate changes", async () => {
    const inst = shared.instalments[0]!;
    const paid = await bob.post(`/instalments/${inst.id}/payment`, { paidDate: "2025-02-05", amountPaid: 1 });
    expect(paid.status).toBe(200);
    expect(paid.json.instalments[0].status).toBe("paid");
    expect((await bob.patch(`/instalments/${shared.instalments[1]!.id}`, { skipped: true })).status).toBe(200);
    expect((await bob.put(`/loans/${shared.id}/instalments/3/override`, { amount: 9_000_00 })).status).toBe(200);
    expect((await bob.post(`/loans/${shared.id}/rate-changes`, { effectiveDate: "2025-06-01", annualRate: 13 })).status).toBe(201);
    // The owner sees the editor's changes (data stays under the owner)
    expect((await alice.get(`/loans/${shared.id}`)).json.instalments[0].payment).not.toBeNull();
  });

  it("can edit terms but never the lender, card, type or mute setting", async () => {
    // Bob can't see the card id, so a card EMI edit arrives without one; the owner's card is kept.
    const res = await bob.put(`/loans/${shared.id}`, loan({ nickname: "Renamed by Bob", annualRate: 13, lenderId: "seed-in-axis-bank", type: "credit_card_emi", cardId: null, muted: true }));
    expect(res.status).toBe(200);
    const mine = (await alice.get(`/loans/${shared.id}`)).json;
    expect(mine).toMatchObject({ nickname: "Renamed by Bob", annualRate: 13, lenderId: "seed-in-icici-bank", type: "credit_card_emi", muted: false });
    expect(mine.cardId).toBeTruthy();
  });

  it("cannot share, change access, revoke, delete the loan, or touch documents", async () => {
    expect((await bob.post(`/loans/${shared.id}/shares`, { email: "eve@example.com", access: "edit" })).status).toBe(403);
    expect((await bob.get(`/loans/${shared.id}/shares`)).status).toBe(403);
    const shareId = (await alice.get(`/loans/${shared.id}/shares`)).json[0].id;
    expect((await bob.patch(`/loans/${shared.id}/shares/${shareId}`, { access: "edit" })).status).toBe(403);
    expect((await bob.del(`/loans/${shared.id}/shares/${shareId}`)).status).toBe(403);
    expect((await bob.del(`/loans/${shared.id}`)).status).toBe(403);
    expect((await bob.patch(`/loans/${shared.id}/mute`, { muted: true })).status).toBe(403);
    expect((await bob.raw("POST", `/loans/${shared.id}/documents?filename=x.pdf`, PDF)).status).toBe(404);
    expect((await eve.get(`/loans/${shared.id}`)).status).toBe(404);
  });
});

describe("shared users see only the shared loan", () => {
  beforeEach(async () => {
    await share("edit");
  });

  it("never see the owner's other loans, cards or documents", async () => {
    expect((await bob.get("/loans")).json).toEqual([]); // own loans: none
    const sharedList = (await bob.get("/loans/shared")).json;
    expect(sharedList.map((l: { id: string }) => l.id)).toEqual([shared.id]);
    expect(sharedList[0]).toMatchObject({ access: "edit", ownerName: "alice", cardId: null });
    expect((await bob.get(`/loans/${other.id}`)).status).toBe(404);
    expect((await bob.get("/cards")).json).toEqual([]);
    expect((await bob.get(`/loans/${shared.id}`)).json.cardId).toBeNull();
    expect((await bob.get(`/loans/${shared.id}`)).json.shares).toEqual([]);
    expect((await bob.get("/instalments?from=2025-01-01&to=2026-12-31")).json).toEqual([]);
    const lenders = (await bob.get("/lenders")).json as { custom: boolean }[];
    expect(lenders.some((l) => l.custom)).toBe(false);
  });

  it("never see the owner's income, anywhere", async () => {
    const texts = [
      JSON.stringify((await bob.get("/me")).json),
      JSON.stringify((await bob.get("/loans/shared")).json),
      JSON.stringify((await bob.get(`/loans/${shared.id}`)).json),
      JSON.stringify((await bob.get("/dashboard")).json),
    ];
    for (const t of texts) expect(t).not.toContain("15000000");
    expect((await bob.get("/me")).json.settings.monthlyIncome).toBeNull();
    expect((await bob.get("/dashboard")).json.dti).toBeNull();
    // ...while the owner does get a debt-to-income figure from their own loans
    const dti = (await alice.get("/dashboard")).json.dti;
    expect(dti).toMatchObject({ currency: "INR", income: 1_50_000_00 });
    expect(dti.obligations).toBeGreaterThan(0);
  });

  it("shared loans are not counted in the shared user's dashboard totals", async () => {
    const d = (await bob.get("/dashboard")).json;
    expect(d.activeLoans).toBe(0);
    expect(d.outstanding).toEqual({});
  });
});

describe("owner controls", () => {
  it("can change access and revoke; revoked users lose access immediately", async () => {
    const [s] = await share("view");
    const upgraded = await alice.patch(`/loans/${shared.id}/shares/${s!.id}`, { access: "edit" });
    expect(upgraded.json[0].access).toBe("edit");
    expect((await bob.post(`/instalments/${shared.instalments[0]!.id}/payment`, { paidDate: "2025-02-05", amountPaid: 1 })).status).toBe(200);
    const revoked = await alice.del(`/loans/${shared.id}/shares/${s!.id}`);
    expect(revoked.json).toEqual([]);
    expect((await bob.get(`/loans/${shared.id}`)).status).toBe(404);
    expect((await bob.get("/loans/shared")).json).toEqual([]);
  });

  it("deleting the loan revokes all its shares", async () => {
    await share("edit");
    expect((await alice.del(`/loans/${shared.id}`)).status).toBe(204);
    expect((await bob.get(`/loans/${shared.id}`)).status).toBe(404);
    const n = env.DB.db.prepare("SELECT COUNT(*) AS n FROM loan_shares").get() as { n: number };
    expect(n.n).toBe(0);
  });

  it("outsiders can't see or manage shares", async () => {
    const [s] = await share("view");
    expect((await eve.get(`/loans/${shared.id}/shares`)).status).toBe(404);
    expect((await eve.del(`/loans/${shared.id}/shares/${s!.id}`)).status).toBe(404);
    expect((await eve.post(`/loans/${shared.id}/shares`, { email: "eve@example.com", access: "edit" })).status).toBe(404);
  });
});

describe("account deletion with sharing", () => {
  it("shows the impact before deleting", async () => {
    await share("view");
    await share("edit", "carol@example.com");
    const bobsLoan = (await bob.post("/loans", loan({ nickname: "Bob loan" }))).json;
    await bob.post(`/loans/${bobsLoan.id}/shares`, { email: "alice@example.com", access: "view" });
    const impact = (await alice.get("/account/deletion-impact")).json;
    expect(impact).toEqual({ ownedLoans: 2, ownedSharedLoans: 1, shareRecipients: 2, sharedWithMe: 1 });
  });

  it("owner deletion deletes their loans and revokes every share on them", async () => {
    await share("edit");
    expect((await alice.raw("DELETE", "/account", { confirmEmail: "alice@example.com" })).status).toBe(204);
    expect((await bob.get(`/loans/${shared.id}`)).status).toBe(404);
    expect((await bob.get("/loans/shared")).json).toEqual([]);
    for (const t of ["loans", "instalments", "documents", "settings"]) {
      expect((env.DB.db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = 'alice'`).get() as { n: number }).n, t).toBe(0);
    }
    expect((env.DB.db.prepare("SELECT COUNT(*) AS n FROM loan_shares").get() as { n: number }).n).toBe(0);
    // Bob's own account is untouched
    expect((await bob.get("/me")).status).toBe(200);
  });

  it("a shared user's deletion only removes them from the share; the owner's loan is untouched", async () => {
    await share("edit");
    expect((await bob.raw("DELETE", "/account", { confirmEmail: "bob@example.com" })).status).toBe(204);
    const mine = (await alice.get(`/loans/${shared.id}`)).json;
    expect(mine.instalments).toHaveLength(12);
    expect(mine.shares).toEqual([]);
  });

  it("income is in the JSON export and removed with the account", async () => {
    await share("view");
    const exp = (await alice.get("/account/export")).json;
    expect(exp.settings[0].monthly_income).toBe(1_50_000_00);
    expect(exp.sharesGiven).toEqual([expect.objectContaining({ email: "bob@example.com", access: "view" })]);
    expect(JSON.stringify((await bob.get("/account/export")).json)).not.toContain("15000000");
    await alice.raw("DELETE", "/account", { confirmEmail: "alice@example.com" });
    expect((env.DB.db.prepare("SELECT COUNT(*) AS n FROM settings WHERE user_id = 'alice'").get() as { n: number }).n).toBe(0);
  });
});
