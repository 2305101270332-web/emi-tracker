import { SignJWT } from "jose";
import { join } from "node:path";
import { createApp } from "../src/index";
import type { Env } from "../src/env";
import { D1Shim } from "./d1-shim";

/** In-memory R2 bucket with the subset of the API the Worker uses. */
export class R2Mock {
  objects = new Map<string, { body: Uint8Array<ArrayBuffer>; contentType?: string }>();
  async put(key: string, value: Uint8Array | ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) {
    this.objects.set(key, { body: new Uint8Array(value as ArrayBuffer), contentType: opts?.httpMetadata?.contentType });
    return { key };
  }
  async get(key: string) {
    const o = this.objects.get(key);
    return o ? { body: new Blob([o.body]).stream(), size: o.body.byteLength } : null;
  }
  async delete(keys: string | string[]) {
    for (const k of Array.isArray(keys) ? keys : [keys]) this.objects.delete(k);
  }
  async list(opts: { prefix?: string; limit?: number; cursor?: string }) {
    const all = [...this.objects.keys()].filter((k) => k.startsWith(opts.prefix ?? "")).sort();
    const start = opts.cursor ? Number(opts.cursor) : 0;
    const limit = opts.limit ?? 1000;
    const page = all.slice(start, start + limit);
    const truncated = start + limit < all.length;
    return { objects: page.map((key) => ({ key })), truncated, cursor: truncated ? String(start + limit) : undefined };
  }
}

export const SECRET = "test-secret-test-secret-test-secret-123456";
export const APP_ORIGIN = "http://localhost:5173";

export function makeEnv(overrides: Partial<Env> = {}): Env & { DB: D1Shim; DOCS: R2Mock } {
  const db = new D1Shim().migrate(join(__dirname, "..", "migrations"));
  const r2 = new R2Mock();
  return {
    DB: db as unknown as D1Database,
    DOCS: r2 as unknown as R2Bucket,
    ENVIRONMENT: "test",
    APP_ORIGIN,
    API_ORIGIN: "http://localhost:8787",
    GOOGLE_CLIENT_ID: "test-client",
    VAPID_PUBLIC_KEY: "",
    VAPID_SUBJECT: "mailto:test@example.com",
    SESSION_SECRET: SECRET,
    ...overrides,
  } as unknown as Env & { DB: D1Shim; DOCS: R2Mock };
}

const ctx = { waitUntil: (p: Promise<unknown>) => void p.catch(() => undefined), passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;

export function client(env: Env) {
  const app = createApp();
  let cookie = "";
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const raw = body instanceof Uint8Array;
    const res = await app.request(
      `http://localhost:8787/api${path}`,
      {
        method,
        headers: {
          ...(body !== undefined && !raw ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...headers,
        },
        body: raw ? (body as Uint8Array<ArrayBuffer>) : body !== undefined ? JSON.stringify(body) : undefined,
      },
      env,
      ctx,
    );
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0]!;
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json, headers: res.headers };
  };
  return {
    get: (p: string, h?: Record<string, string>) => call("GET", p, undefined, h),
    post: (p: string, b?: unknown, h?: Record<string, string>) => call("POST", p, b ?? {}, h),
    put: (p: string, b: unknown) => call("PUT", p, b),
    patch: (p: string, b: unknown) => call("PATCH", p, b),
    del: (p: string) => call("DELETE", p),
    raw: call,
    setCookie: (c: string) => (cookie = c),
    get cookie() {
      return cookie;
    },
  };
}

/** Create a user row + settings directly and return a session cookie for it. */
export async function createUser(env: Env & { DB: D1Shim }, id: string, tz = "Asia/Kolkata") {
  env.DB.db.prepare("INSERT INTO users (id, google_sub, email, name) VALUES (?, ?, ?, ?)").run(id, `sub-${id}`, `${id}@example.com`, id);
  env.DB.db.prepare("INSERT INTO settings (user_id, time_zone) VALUES (?, ?)").run(id, tz);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(id)
    .setAudience("emi-session")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
  return `emi_session=${token}`;
}
