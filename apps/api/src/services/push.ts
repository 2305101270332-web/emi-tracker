/**
 * Web Push (RFC 8030) with VAPID (RFC 8292) and aes128gcm payload encryption
 * (RFC 8291), implemented on WebCrypto so it runs natively in Workers.
 */
import { b64urlDecode, b64urlEncode, concatBytes, utf8, type Bytes } from "../lib/util";

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface VapidKeys {
  /** Uncompressed P-256 public key, base64url (65 bytes). */
  publicKey: string;
  /** Private scalar d, base64url (32 bytes). */
  privateKey: string;
  subject: string;
}

export interface PushResult {
  ok: boolean;
  status: number;
  /** Subscription is gone and should be deleted (404/410). */
  expired: boolean;
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

/** Encrypt a payload for a subscription. Exposed for tests. */
export async function encryptPayload(
  target: Pick<PushTarget, "p256dh" | "auth">,
  plaintext: Uint8Array,
  opts: { salt?: Bytes; serverKeys?: CryptoKeyPair } = {},
): Promise<Bytes> {
  const uaPublic = b64urlDecode(target.p256dh);
  const authSecret = b64urlDecode(target.auth);
  const serverKeys =
    opts.serverKeys ??
    ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", serverKeys.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey } as EcdhKeyDeriveParams, serverKeys.privateKey, 256),
  );

  const keyInfo = concatBytes(utf8("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const padded = concatBytes(plaintext, new Uint8Array([0x02])); // last-record delimiter
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concatBytes(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

const signingKeyCache = new Map<string, CryptoKey>();

async function vapidSigningKey(keys: VapidKeys): Promise<CryptoKey> {
  const cached = signingKeyCache.get(keys.privateKey);
  if (cached) return cached;
  const pub = b64urlDecode(keys.publicKey);
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: b64urlEncode(pub.slice(1, 33)),
    y: b64urlEncode(pub.slice(33, 65)),
    d: keys.privateKey,
    ext: true,
  };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  signingKeyCache.set(keys.privateKey, key);
  return key;
}

export async function vapidAuthHeader(endpoint: string, keys: VapidKeys, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64urlEncode(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(utf8(JSON.stringify({ aud, exp: nowSec + 12 * 3600, sub: keys.subject })));
  const input = `${header}.${claims}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await vapidSigningKey(keys), utf8(input));
  return `vapid t=${input}.${b64urlEncode(sig)}, k=${keys.publicKey}`;
}

export async function sendPush(target: PushTarget, payload: unknown, keys: VapidKeys, ttlSeconds = 86400): Promise<PushResult> {
  const body = await encryptPayload(target, utf8(JSON.stringify(payload)));
  const res = await fetch(target.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthHeader(target.endpoint, keys),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttlSeconds),
      Urgency: "normal",
    },
    body,
  });
  return { ok: res.ok, status: res.status, expired: res.status === 404 || res.status === 410 };
}
