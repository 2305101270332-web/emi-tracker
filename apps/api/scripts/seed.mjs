// Seeds the demo account with sample loans through a running local API
// (`npm run dev:api`). Uses the dev-only login, so it never works in production.
const base = process.env.API_URL ?? "http://localhost:8787";
const login = await fetch(`${base}/api/auth/dev`, { method: "POST" });
if (!login.ok) throw new Error(`dev login failed: ${login.status} (is ENVIRONMENT=development?)`);
const cookie = login.headers.get("set-cookie").split(";")[0];
const res = await fetch(`${base}/api/auth/dev/seed`, { method: "POST", headers: { cookie } });
console.log(res.status, await res.text());
