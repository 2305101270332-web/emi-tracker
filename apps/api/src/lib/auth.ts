import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload } from "jose";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv, Env } from "../env";
import { ApiError } from "./errors";
import { utf8 } from "./util";

export const SESSION_COOKIE = "emi_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
}

const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

/** Verify a Google Identity Services ID token (signature, issuer, audience, expiry, verified email). */
export async function verifyGoogleIdToken(credential: string, clientId: string): Promise<GoogleIdentity> {
  let payload: JWTPayload & Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(credential, GOOGLE_JWKS, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: clientId,
    }));
  } catch {
    throw new ApiError(401, "invalid_google_token");
  }
  if (!payload.sub || typeof payload.email !== "string" || payload.email_verified !== true) {
    throw new ApiError(401, "email_not_verified");
  }
  return {
    sub: payload.sub,
    email: payload.email,
    name: typeof payload.name === "string" ? payload.name : payload.email.split("@")[0]!,
    picture: typeof payload.picture === "string" ? payload.picture : null,
  };
}

function sessionKey(env: Env): Uint8Array {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    throw new ApiError(500, "misconfigured", "SESSION_SECRET must be set (32+ chars)");
  }
  return utf8(env.SESSION_SECRET);
}

/** Issue a session cookie stamped with the user's current session_version. */
export async function issueSession(c: Context<AppEnv>, userId: string): Promise<void> {
  const row = await c.env.DB.prepare("SELECT session_version FROM users WHERE id = ?").bind(userId).first<{ session_version: number }>();
  const token = await new SignJWT({ sv: Number(row?.session_version ?? 0) })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setAudience("emi-session")
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(sessionKey(c.env));
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSession(c: Context<AppEnv>): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true, httpOnly: true, sameSite: "Lax" });
}

export async function readSession(c: Context<AppEnv>): Promise<{ userId: string; version: number } | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionKey(c.env), { audience: "emi-session", algorithms: ["HS256"] });
    if (!payload.sub) return null;
    return { userId: payload.sub, version: typeof payload.sv === "number" ? payload.sv : 0 };
  } catch {
    return null;
  }
}

/**
 * Require a valid session; sets c.var.userId. Every data route sits behind this.
 * One indexed primary-key read per request checks the cookie's version against
 * users.session_version, so "sign out of all devices" takes effect immediately.
 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await readSession(c);
  if (!session) throw new ApiError(401, "unauthenticated");
  const row = await c.env.DB.prepare("SELECT session_version FROM users WHERE id = ?").bind(session.userId).first<{ session_version: number }>();
  if (!row || Number(row.session_version) !== session.version) {
    clearSession(c);
    throw new ApiError(401, "session_revoked");
  }
  c.set("userId", session.userId);
  await next();
};

/** Invalidate every session for the user (all devices), including the current one. */
export async function revokeAllSessions(c: Context<AppEnv>, userId: string): Promise<void> {
  await c.env.DB.prepare("UPDATE users SET session_version = session_version + 1 WHERE id = ?").bind(userId).run();
  clearSession(c);
}
