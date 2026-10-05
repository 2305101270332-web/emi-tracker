import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HttpError } from "./lib/api";
import "./lib/i18n";
// Royal display face for headings (bundled, so the CSP needs no external font hosts).
import "@fontsource/cinzel/600.css";
import "@fontsource/cinzel/700.css";
import "./index.css";
import { App } from "./App";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // offlineFirst: always try the request so the service worker can answer from cache offline.
      networkMode: "offlineFirst",
      staleTime: 30_000,
      retry: (count, err) => !(err instanceof HttpError && err.status < 500) && count < 2,
      refetchOnWindowFocus: true,
    },
    mutations: { networkMode: "offlineFirst" },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
