/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { NetworkFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

// App shell: precached build assets; SPA navigations fall back to index.html offline.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html"), { denylist: [/^\/api\//] }));

// Cached read access offline: GET API reads are network-first with a 4s timeout,
// falling back to the last good response (schedules, dashboard, calendar).
registerRoute(
  ({ url, request }) =>
    request.method === "GET" &&
    url.pathname.startsWith("/api/") &&
    !url.pathname.startsWith("/api/auth") &&
    !url.pathname.startsWith("/api/email"),
  new NetworkFirst({
    cacheName: "api-reads",
    networkTimeoutSeconds: 4,
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 24 * 3600 })],
  }),
);

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
  // Clear cached API data on sign-out so the next user never sees it.
  if (event.data?.type === "CLEAR_API_CACHE") event.waitUntil(caches.delete("api-reads"));
});

interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
}

self.addEventListener("push", (event) => {
  let data: PushPayload = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? "EMI Tracker", {
      body: data.body ?? "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag,
      data: { url: data.url ?? "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data as { url?: string })?.url ?? "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of windows) {
        if ("focus" in w) {
          await w.navigate(url).catch(() => undefined);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
