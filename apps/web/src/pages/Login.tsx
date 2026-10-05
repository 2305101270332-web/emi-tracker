import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { DragonEmblem } from "../components/DragonEmblem";
import { api } from "../lib/api";
import { keys } from "../lib/queries";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(opts: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string; auto_select?: boolean }): void;
          renderButton(el: HTMLElement, opts: Record<string, unknown>): void;
        };
      };
    };
  }
}

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

function loadGis(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("gis_load_failed"));
    document.head.appendChild(s);
  });
}

export function Login() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const btnRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  const onSignedIn = async () => {
    await qc.invalidateQueries({ queryKey: keys.me });
  };

  useEffect(() => {
    if (!CLIENT_ID || CLIENT_ID.startsWith("your-")) return;
    let cancelled = false;
    loadGis()
      .then(() => {
        if (cancelled || !btnRef.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: async ({ credential }) => {
            try {
              setError(null);
              await api("/auth/google", { method: "POST", body: { credential } });
              await onSignedIn();
            } catch {
              setError(t("auth.signInFailed"));
            }
          },
        });
        window.google.accounts.id.renderButton(btnRef.current, { theme: "filled_blue", size: "large", shape: "pill", text: "signin_with", width: 280 });
      })
      .catch(() => setError(t("auth.signInFailed")));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const devLogin = async () => {
    await api("/auth/dev", { method: "POST" });
    await api("/auth/dev/seed", { method: "POST" }).catch(() => undefined);
    await onSignedIn();
  };

  return (
    <main className="lacquer relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      {/* Large faint dragon behind the card */}
      <DragonEmblem size={720} className="pointer-events-none absolute -right-40 -top-32 opacity-[0.08] animate-[coil_120s_linear_infinite]" />
      <div className="card animate-pop relative w-full max-w-md border-accent/70 p-8 text-center">
        <div className="mx-auto mb-4 w-fit rounded-full p-1.5 ring-2 ring-accent/60 ring-offset-4 ring-offset-surface">
          <DragonEmblem size={84} title={t("common.appName")} />
        </div>
        <h1 className="gilded-text text-3xl font-bold sm:text-4xl">{t("common.appName")}</h1>
        <div aria-hidden className="mx-auto mt-2 flex w-40 items-center gap-1.5">
          <span className="h-px flex-1 bg-gradient-to-r from-transparent to-accent" />
          <span className="h-1.5 w-1.5 rotate-45 bg-accent" />
          <span className="h-px flex-1 bg-gradient-to-l from-transparent to-accent" />
        </div>
        <p className="mt-3 text-muted">{t("auth.tagline")}</p>
        <div className="mt-8 flex min-h-[44px] justify-center" ref={btnRef} aria-label={t("auth.signInWithGoogle")} />
        {(!CLIENT_ID || CLIENT_ID.startsWith("your-")) && <p className="mt-2 text-sm text-accent-text">{t("auth.googleNotConfigured")}</p>}
        {error && (
          <p role="alert" className="mt-3 text-sm font-medium text-danger">
            {error}
          </p>
        )}
        {import.meta.env.DEV && (
          <button className="btn-secondary mt-6 w-full" onClick={() => void devLogin()}>
            {t("auth.devLogin")}
          </button>
        )}
        <p className="mt-8 text-xs text-muted">{t("auth.privacy")}</p>
      </div>
    </main>
  );
}
