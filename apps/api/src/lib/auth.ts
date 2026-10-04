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

export async function issueSession(c: Context<AppEnv>, userId: string): Promise<void> {
  const token = await new SignJWT({})
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

export async function readSession(c: Context<AppEnv>): Promise<string | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionKey(c.env), { audience: "emi-session", algorithms: ["HS256"] });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

/** Require a valid session; sets c.var.userId. Every data route sits behind this. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const userId = await readSession(c);
  if (!userId) throw new ApiError(401, "unauthenticated");
  c.set("userId", userId);
  await next();
};
