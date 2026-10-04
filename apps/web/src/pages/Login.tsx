import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
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
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-primary-strong to-primary px-4 py-10">
      <div className="card w-full max-w-md p-8 text-center">
        <img src="/icons/icon.svg" alt="" width={64} height={64} className="mx-auto mb-4 rounded-2xl" />
        <h1 className="text-3xl font-bold text-primary-strong">{t("common.appName")}</h1>
        <p className="mt-2 text-muted">{t("auth.tagline")}</p>
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
