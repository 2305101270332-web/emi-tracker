/// <reference types="@cloudflare/workers-types" />
// Same-origin proxy: /api/* on the Pages domain -> API Worker (service binding, no public hop).
interface Env {
  API: Fetcher;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => env.API.fetch(request);
