import { beforeEach, describe, expect, it } from "vitest";
import { DOCUMENT_MAX_BYTES } from "@emi/shared";
import { sniffType } from "../src/routes/documents";
import { client, createUser, makeEnv } from "./helpers";

const loan = (over: Record<string, unknown> = {}) => ({
  lenderId: "seed-in-sbi",
  type: "home",
  nickname: "Home",
  currency: "INR",
  principal: 20_00_000_00,
  annualRate: 8.5,
  tenureMonths: 120,
  repaymentType: "reducing",
  bookingDate: "2025-01-05",
  firstEmiDate: "2025-02-05",
  emiDay: 5,
  ...over,
});

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0x25, 0x45, 0x4f, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

let env: ReturnType<typeof makeEnv>;
let c: ReturnType<typeof client>;
beforeEach(async () => {
  env = makeEnv();
  c = client(env);
  c.setCookie(await createUser(env, "u1"));
});

const create = async (over: Record<string, unknown> = {}) => {
  const res = await c.post("/loans", loan({ lenderId: "seed-in-state-bank-of-india", ...over }));
  expect(res.status).toBe(201);
  return res.json;
};

describe("rate changes", () => {
  it("keep EMI extends the schedule and the stored instalments follow it", async () => {
    const l = await create();
    expect(l.instalments).toHaveLength(120);
    const res = await c.post(`/loans/${l.id}/rate-changes`, { effectiveDate: "2026-01-01", annualRate: 9.5 });
    expect(res.status).toBe(201);
    expect(res.json.rateChanges).toEqual([expect.objectContaining({ effectiveDate: "2026-01-01", annualRate: 9.5, mode: "keep_emi" })]);
    expect(res.json.instalments.length).toBeGreaterThan(120);
    expect(res.json.instalments.at(-1).closing).toBe(0);
    expect(res.json.summary.instalments).toBe(res.json.instalments.length);
    const emis = new Set(res.json.instalments.slice(0, -1).map((i: { emi: number }) => i.emi));
    expect(emis.size).toBe(1);

    // Removing the change restores the original schedule and trims the extra rows
    const del = await c.del(`/loans/${l.id}/rate-changes/${res.json.rateChanges[0].id}`);
    expect(del.json.instalments).toHaveLength(120);
    const count = env.DB.db.prepare("SELECT COUNT(*) AS n FROM instalments WHERE loan_id = ?").get(l.id) as { n: number };
    expect(count.n).toBe(120);
  });

  it("keep tenure recomputes the EMI", async () => {
    const l = await create();
    const res = await c.post(`/loans/${l.id}/rate-changes`, { effectiveDate: "2026-01-01", annualRate: 9.5, mode: "keep_tenure" });
    expect(res.json.instalments).toHaveLength(120);
    expect(res.json.instalments[12].emi).toBeGreaterThan(res.json.instalments[0].emi);
  });

  it("validates rate changes", async () => {
    const l = await create();
    expect((await c.post(`/loans/${l.id}/rate-changes`, { effectiveDate: "2024-12-01", annualRate: 9 })).status).toBe(422);
    expect((await c.post(`/loans/${l.id}/rate-changes`, { effectiveDate: "2026-01-01", annualRate: 101 })).status).toBe(400);
    const flat = await create({ repaymentType: "flat", nickname: "Flat" });
    expect((await c.post(`/loans/${flat.id}/rate-changes`, { effectiveDate: "2026-01-01", annualRate: 9 })).status).toBe(422);
  });

  it("is owner-only", async () => {
    const l = await create();
    const other = client(env);
    other.setCookie(await createUser(env, "u2"));
    expect((await other.post(`/loans/${l.id}/rate-changes`, { effectiveDate: "2026-01-01", annualRate: 9 })).status).toBe(404);
  });
});

describe("documents (R2)", () => {
  it("sniffs real file types", () => {
    expect(sniffType(PDF)).toBe("application/pdf");
    expect(sniffType(PNG)).toBe("image/png");
    expect(sniffType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffType(new TextEncoder().encode("<html><script>"))).toBeNull();
  });

  it("uploads, lists, downloads and deletes a document via the Worker only", async () => {
    const l = await create();
    const up = await c.raw("POST", `/loans/${l.id}/documents?filename=${encodeURIComponent("Sanction letter.pdf")}`, PDF, { "Content-Type": "application/octet-stream" });
    expect(up.status).toBe(201);
    expect(up.json.documents).toEqual([expect.objectContaining({ filename: "Sanction letter.pdf", contentType: "application/pdf", size: PDF.byteLength })]);
    const docId = up.json.documents[0].id;
    expect([...env.DOCS.objects.keys()][0]).toMatch(new RegExp(`^u/u1/${l.id}/`));

    const dl = await c.get(`/documents/${docId}`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toBe("application/pdf");
    expect(dl.headers.get("content-disposition")).toContain("attachment");

    const other = client(env);
    other.setCookie(await createUser(env, "u2"));
    expect((await other.get(`/documents/${docId}`)).status).toBe(404);
    expect((await other.del(`/documents/${docId}`)).status).toBe(404);

    const del = await c.del(`/documents/${docId}`);
    expect(del.json.documents).toHaveLength(0);
    expect(env.DOCS.objects.size).toBe(0);
  });

  it("rejects disguised, empty and oversized files", async () => {
    const l = await create();
    const html = new TextEncoder().encode("<html><script>alert(1)</script>");
    expect((await c.raw("POST", `/loans/${l.id}/documents?filename=x.pdf`, html, { "Content-Type": "application/pdf" })).status).toBe(415);
    expect((await c.raw("POST", `/loans/${l.id}/documents?filename=x.pdf`, new Uint8Array(0))).status).toBe(400);
    const big = new Uint8Array(DOCUMENT_MAX_BYTES + 1);
    big.set(PDF);
    expect((await c.raw("POST", `/loans/${l.id}/documents?filename=x.pdf`, big)).status).toBe(413);
    expect(env.DOCS.objects.size).toBe(0);
  });

  it("sanitises filenames", async () => {
    const l = await create();
    const up = await c.raw("POST", `/loans/${l.id}/documents?filename=${encodeURIComponent("../../etc/pa:ss<wd>.png")}`, PNG);
    expect(up.json.documents[0].filename).toBe("_.._etc_pa_ss_wd_.png");
  });
});

describe("data export and account deletion", () => {
  it("exports all of the user's data as JSON, without storage keys", async () => {
    const l = await create();
    await c.raw("POST", `/loans/${l.id}/documents?filename=a.pdf`, PDF);
    const res = await c.get("/account/export");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/emi-tracker-export-.*\.json/);
    expect(res.json.user.email).toBe("u1@example.com");
    expect(res.json.loans).toHaveLength(1);
    expect(res.json.instalments).toHaveLength(120);
    expect(res.json.documents[0].filename).toBe("a.pdf");
    expect(res.json.documents[0].r2_key).toBeUndefined();
  });

  it("deletes everything after the email is confirmed", async () => {
    const l = await create();
    await c.raw("POST", `/loans/${l.id}/documents?filename=a.pdf`, PDF);
    await c.post("/cards", { nickname: "Card", statementDay: 5, dueDay: 25 });
    await c.post("/lenders", { name: "My lender", country: "IN", color: "#123456" });
    // another user's data must survive
    const other = client(env);
    other.setCookie(await createUser(env, "u2"));
    await other.post("/loans", loan({ lenderId: "seed-in-state-bank-of-india" }));

    expect((await c.raw("DELETE", "/account", { confirmEmail: "wrong@example.com" })).status).toBe(422);
    const res = await c.raw("DELETE", "/account", { confirmEmail: "U1@example.com" });
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toMatch(/emi_session=;/);
    for (const t of ["users", "settings", "loans", "instalments", "cards", "documents"]) {
      const col = t === "users" ? "id" : "user_id";
      const n = env.DB.db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${col} = 'u1'`).get() as { n: number };
      expect(n.n, t).toBe(0);
    }
    expect((env.DB.db.prepare("SELECT COUNT(*) AS n FROM lenders WHERE user_id = 'u1'").get() as { n: number }).n).toBe(0);
    expect((env.DB.db.prepare("SELECT COUNT(*) AS n FROM lenders WHERE user_id IS NULL").get() as { n: number }).n).toBeGreaterThan(30);
    expect(env.DOCS.objects.size).toBe(0);
    expect((await other.get("/loans")).json).toHaveLength(1);
    expect((await c.get("/me")).status).toBe(401);
  });
});
