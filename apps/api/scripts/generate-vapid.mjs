// Generates a VAPID key pair for Web Push.
//   VAPID_PUBLIC_KEY  -> wrangler.jsonc "vars" and the web app (fetched from /api/push/vapid-public-key)
//   VAPID_PRIVATE_KEY -> `npx wrangler secret put VAPID_PRIVATE_KEY` (never commit it)
const { subtle } = globalThis.crypto;
const b64url = (buf) => Buffer.from(buf).toString("base64url");
const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pub = await subtle.exportKey("raw", pair.publicKey);
const jwk = await subtle.exportKey("jwk", pair.privateKey);
console.log(`VAPID_PUBLIC_KEY=${b64url(pub)}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
