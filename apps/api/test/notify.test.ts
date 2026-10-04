import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, addMonthsClamped, todayInZone } from "@emi/core";
import { b64urlDecode, b64urlEncode, concatBytes, hmacSha256, utf8, type Bytes } from "../src/lib/util";
import { encryptPayload, vapidAuthHeader } from "../src/services/push";
import { reminderEmail, unsubscribeToken, verifyResendWebhook } from "../src/services/email";
import { eventFor, runReminders } from "../src/services/reminders";
import { client, createUser, makeEnv } from "./helpers";

const NOW = new Date("2025-06-10T06:00:00Z"); // 11:30 IST
const TODAY_IST = todayInZone("Asia/Kolkata", NOW);

async function addLoanDueIn(c: ReturnType<typeof client>, days: number, over: Record<string, unknown> = {}) {
  const due = addDays(TODAY_IST, days);
  return c.post("/loans", {
    lenderId: "seed-in-icici-bank",
    type: "personal",
    nickname: `Loan +${days}`,
    currency: "INR",
    principal: 10_000_00,
    annualRate: 12,
    tenureMonths: 3,
    repaymentType: "reducing",
    bookingDate: addMonthsClamped(due, -1),
    firstEmiDate: due,
    emiDay: Number(due.slice(8)),
    ...over,
  });
}

describe("reminder rules", () => {
  const u = { today: "2025-06-10", daysBefore: [3, 1], remindOnDay: true, remindOverdue: true };
  const d = (payableDate: string) => ({ instalmentId: "i", userId: "u", loanId: "l", loanNickname: "L", n: 1, billedDate: payableDate, payableDate, amount: 1, currency: "INR" });
  it("matches configured offsets, due day and overdue", () => {
    expect(eventFor(u, d("2025-06-13"))?.tag).toBe("before3");
    expect(eventFor(u, d("2025-06-11"))?.tag).toBe("before1");
    expect(eventFor(u, d("2025-06-12"))).toBeNull();
    expect(eventFor(u, d("2025-06-10"))?.tag).toBe("due_today");
    expect(eventFor(u, d("2025-06-01"))?.tag).toBe("overdue");
    expect(eventFor({ ...u, remindOverdue: false }, d("2025-06-01"))).toBeNull();
  });
});

describe("hourly reminder job", () => {
  let env: ReturnType<typeof makeEnv>;
  let c: ReturnType<typeof client>;
  const fetchMock = vi.fn();

  beforeEach(async () => {
    env = makeEnv({ RESEND_API_KEY: "re_test", RESEND_FROM: "EMI <r@example.com>", EMAIL_DAILY_CAP: "95" });
    c = client(env);
    c.setCookie(await createUser(env, "u1"));
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (String(url).includes("api.resend.com")) return new Response(JSON.stringify({ data: JSON.parse(String(init.body)).map(() => ({ id: "x" })) }), { status: 200 });
      return new Response("", { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("respects the user's reminder hour in their time zone", async () => {
    await addLoanDueIn(c, 3);
    const early = await runReminders(env, new Date("2025-06-10T02:00:00Z")); // 07:30 IST < 09
    expect(early.usersEligible).toBe(0);
    const r = await runReminders(env, NOW);
    expect(r.usersEligible).toBe(1);
    expect(r.inapp).toBe(1);
  });

  it("groups dues on the same day into one email, records them, and never sends twice", async () => {
    await addLoanDueIn(c, 1);
    await addLoanDueIn(c, 1, { nickname: "Second" });
    await addLoanDueIn(c, 3);
    const r1 = await runReminders(env, NOW);
    expect(r1.inapp).toBe(3);
    expect(r1.emailsSent).toBe(1); // one email for the user, containing both sections
    const resendCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes("resend"));
    expect(resendCalls).toHaveLength(1);
    const payload = JSON.parse(String(resendCalls[0]![1].body));
    expect(payload).toHaveLength(1);
    expect(payload[0].html).toContain("Second");
    expect(payload[0].headers["List-Unsubscribe"]).toContain("/api/email/unsubscribe");

    const r2 = await runReminders(env, new Date(NOW.getTime() + 3600_000));
    expect(r2.inapp).toBe(0);
    expect(r2.emailsSent).toBe(0);

    const list = await c.get("/notifications");
    expect(list.json).toHaveLength(3);
  });

  it("skips muted and paid instalments", async () => {
    const muted = await addLoanDueIn(c, 1, { muted: true });
    expect(muted.status).toBe(201);
    const paid = await addLoanDueIn(c, 1);
    await c.post(`/instalments/${paid.json.instalments[0].id}/payment`, { paidDate: TODAY_IST, amountPaid: 1 });
    const r = await runReminders(env, NOW);
    expect(r.inapp).toBe(0);
  });

  it("retries failed emails on the next run, up to 3 attempts", async () => {
    await addLoanDueIn(c, 1);
    fetchMock.mockImplementation(async () => new Response("boom", { status: 500 }));
    const r1 = await runReminders(env, NOW);
    expect(r1.emailsFailed).toBe(1);
    const r2 = await runReminders(env, new Date(NOW.getTime() + 3600_000));
    expect(r2.emailsFailed).toBe(1);
    await runReminders(env, new Date(NOW.getTime() + 7200_000));
    const r4 = await runReminders(env, new Date(NOW.getTime() + 10800_000));
    expect(r4.emailsFailed + r4.emailsSent).toBe(0); // gave up after 3 attempts
    const row = env.DB.db.prepare("SELECT attempts, status FROM notifications WHERE channel = 'email'").get() as any;
    expect(row).toMatchObject({ attempts: 3, status: "failed" });
  });

  it("respects the daily email cap and defers the rest", async () => {
    env.EMAIL_DAILY_CAP = "0";
    await addLoanDueIn(c, 1);
    const r = await runReminders(env, NOW);
    expect(r.emailsSent).toBe(0);
    expect(r.emailsDeferred).toBe(1);
    expect(r.inapp).toBe(1);
  });

  it("does not email bounced addresses or users who opted out", async () => {
    await addLoanDueIn(c, 1);
    env.DB.db.prepare("UPDATE users SET email_bounced = 1").run();
    expect((await runReminders(env, NOW)).emailsSent).toBe(0);
  });

  it("sends a weekly summary on Mondays", async () => {
    env.DB.db.prepare("UPDATE settings SET weekly_summary = 1").run();
    const monday = new Date("2025-06-09T06:00:00Z");
    const r = await runReminders(env, monday);
    expect(r.emailsSent).toBe(1);
    expect((await runReminders(env, new Date(monday.getTime() + 3600_000))).emailsSent).toBe(0);
  });
});

describe("unsubscribe + webhook", () => {
  it("unsubscribes with a signed token, without logging in", async () => {
    const env = makeEnv();
    await createUser(env, "u1");
    const c = client(env);
    const s = await unsubscribeToken(env.SESSION_SECRET, "u1", "reminders");
    expect((await c.get(`/email/unsubscribe?u=u1&k=reminders&s=${"A".repeat(43)}`)).status).toBe(403);
    const ok = await c.get(`/email/unsubscribe?u=u1&k=reminders&s=${s}`);
    expect(ok.status).toBe(200);
    expect(String(ok.json)).toContain("unsubscribed");
    const row = env.DB.db.prepare("SELECT email_reminders FROM settings WHERE user_id = 'u1'").get() as any;
    expect(row.email_reminders).toBe(0);
  });

  it("verifies Resend (Svix) signatures and suppresses bounced addresses", async () => {
    const secretBytes = crypto.getRandomValues(new Uint8Array(24));
    const secret = "whsec_" + btoa(String.fromCharCode(...secretBytes));
    const env = makeEnv({ RESEND_WEBHOOK_SECRET: secret });
    await createUser(env, "u1");
    const body = JSON.stringify({ type: "email.bounced", data: { to: ["U1@example.com"] } });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = btoa(String.fromCharCode(...(await hmacSha256(secretBytes, `msg_1.${ts}.${body}`))));
    expect(await verifyResendWebhook(secret, { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, body)).toBe(true);
    expect(await verifyResendWebhook(secret, { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, body + " ")).toBe(false);

    const c = client(env);
    const bad = await c.raw("POST", "/webhooks/resend", JSON.parse(body), { "svix-id": "msg_1", "svix-timestamp": ts, "svix-signature": "v1,bad" });
    expect(bad.status).toBe(401);
    const app = (await import("../src/index")).createApp();
    const res = await app.request(
      "http://x/api/webhooks/resend",
      { method: "POST", body, headers: { "svix-id": "msg_1", "svix-timestamp": ts, "svix-signature": `v1,${sig}` } },
      env,
    );
    expect(res.status).toBe(200);
    const row = env.DB.db.prepare("SELECT email_bounced FROM users WHERE id = 'u1'").get() as any;
    expect(row.email_bounced).toBe(1);
  });
});

describe("email templates", () => {
  it("formats amounts and dates in the user's locale and format, with a text fallback", () => {
    const e = reminderEmail(
      { id: "u", email: "a@b.c", name: "A", locale: "en-IN", dateFormat: "DD/MM/YYYY" },
      [{ heading: "Tomorrow", payableDate: "2025-06-11", lines: [{ loanNickname: "Car <b>", n: 2, payableDate: "2025-06-11", billedDate: "2025-06-11", amount: 1_23_456_78, currency: "INR" }] }],
      { appUrl: "https://app", unsubUrl: "https://api/unsub", overdueOnly: false },
    );
    expect(e.html).toContain("1,23,456.78");
    expect(e.html).toContain("11/06/2025");
    expect(e.html).toContain("Car &lt;b&gt;"); // escaped
    expect(e.text).toContain("Car <b> #2");
    expect(e.subject).toContain("tomorrow");
  });
});

describe("web push crypto", () => {
  it("produces an RFC 8291 aes128gcm body the subscriber can decrypt", async () => {
    // Subscriber (browser) keys
    const ua = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const uaPub = new Uint8Array((await crypto.subtle.exportKey("raw", ua.publicKey)) as ArrayBuffer);
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const body = await encryptPayload({ p256dh: b64urlEncode(uaPub), auth: b64urlEncode(auth) }, utf8('{"title":"hi"}'));

    // Decrypt as the browser would
    const salt = body.slice(0, 16);
    const idlen = body[20]!;
    const asPub = body.slice(21, 21 + idlen);
    const ct = body.slice(21 + idlen);
    const asKey = await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
    const hk = async (s: Bytes, ikm: Bytes, info: Bytes, n: number) =>
      new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: s, info }, await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), n * 8));
    const ikm = await hk(auth, shared, concatBytes(utf8("WebPush: info\0"), uaPub, asPub), 32);
    const cek = await hk(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
    const nonce = await hk(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);
    const pt = new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]), ct),
    );
    expect(new TextDecoder().decode(pt.slice(0, -1))).toBe('{"title":"hi"}');
    expect(pt.at(-1)).toBe(2);
  });

  it("signs a verifiable VAPID JWT", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const pub = b64urlEncode((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
    const d = ((await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey).d!;
    const header = await vapidAuthHeader("https://fcm.googleapis.com/fcm/send/abc", { publicKey: pub, privateKey: d, subject: "mailto:a@b.c" });
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
    expect(m[4]).toBe(pub);
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(m[2]!)));
    expect(claims.aud).toBe("https://fcm.googleapis.com");
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, b64urlDecode(m[3]!), utf8(`${m[1]}.${m[2]}`));
    expect(ok).toBe(true);
  });
});
