import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bell, Calculator, CalendarDays, CreditCard, Download, LayoutDashboard, Landmark, Settings, Share, WalletCards, WifiOff, X } from "lucide-react";
import { useNotifications } from "../lib/queries";
import { useInstallPrompt, useOnline } from "../lib/pwa";
import { DragonEmblem } from "./DragonEmblem";
import { cx } from "./ui";

const NAV = [
  { to: "/", key: "nav.dashboard", icon: LayoutDashboard, end: true },
  { to: "/loans", key: "nav.loans", icon: Landmark },
  { to: "/budget", key: "nav.budget", icon: WalletCards },
  { to: "/calendar", key: "nav.calendar", icon: CalendarDays },
  { to: "/cards", key: "nav.cards", icon: CreditCard },
  { to: "/tools", key: "nav.tools", icon: Calculator },
  { to: "/settings", key: "nav.settings", icon: Settings },
] as const;

/**
 * Phone bottom bar has room for five: Cards is reachable from the Loans page and
 * Settings from the gear in the top bar.
 */
const MOBILE_NAV = NAV.filter((n) => n.to !== "/cards" && n.to !== "/settings");

function Logo({ size = 34 }: { size?: number }) {
  return <DragonEmblem size={size} className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.35)]" />;
}

function Brand({ size }: { size?: number }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2.5">
      <Logo size={size} />
      <span className="font-display text-lg font-bold tracking-wider text-frame-text">{t("common.appName")}</span>
    </div>
  );
}

function BellLink() {
  const { t } = useTranslation();
  const { data } = useNotifications();
  const unread = data?.filter((n) => !n.readAt).length ?? 0;
  return (
    <NavLink
      to="/notifications"
      className="relative inline-flex h-11 w-11 items-center justify-center rounded-xl text-frame-text transition-colors hover:bg-white/10"
      aria-label={`${t("nav.notifications")}${unread ? ` (${unread})` : ""}`}
    >
      <Bell size={22} aria-hidden />
      {unread > 0 && (
        <span className="animate-pop absolute right-1.5 top-1.5 min-w-[18px] rounded-full bg-accent px-1 text-center text-[11px] font-bold leading-[18px] text-accent-on ring-2 ring-[rgb(var(--frame-to))]">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </NavLink>
  );
}

function InstallBanner() {
  const { t } = useTranslation();
  const install = useInstallPrompt();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem("emi-install-dismissed") === "1";
    } catch {
      return false;
    }
  });
  if (dismissed || (!install.canPrompt && !install.showIOSHint)) return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem("emi-install-dismissed", "1");
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="card animate-rise mb-4 flex items-start gap-3 border-accent/60 bg-accent-soft/60 p-4" role="region" aria-label={t("install.title")}>
      {install.canPrompt ? <Download className="mt-0.5 shrink-0 text-primary-strong" aria-hidden /> : <Share className="mt-0.5 shrink-0 text-primary-strong" aria-hidden />}
      <div className="flex-1">
        <p className="font-semibold text-primary-strong">{install.canPrompt ? t("install.title") : t("install.iosTitle")}</p>
        <p className="text-sm text-muted">{install.canPrompt ? t("install.body") : t("install.iosBody")}</p>
        {install.canPrompt && (
          <div className="mt-3 flex gap-2">
            <button className="btn-primary" onClick={() => void install.prompt()}>
              {t("install.action")}
            </button>
            <button className="btn-ghost" onClick={dismiss}>
              {t("install.later")}
            </button>
          </div>
        )}
      </div>
      {!install.canPrompt && (
        <button className="btn-ghost min-h-[40px] px-2" onClick={dismiss} aria-label={t("common.close")}>
          <X size={18} />
        </button>
      )}
    </div>
  );
}

function UpdateToast() {
  const { t } = useTranslation();
  const [needRefresh, setNeedRefresh] = useState(false);
  const [update, setUpdate] = useState<(() => Promise<void>) | null>(null);
  useEffect(() => {
    if (import.meta.env.DEV) return;
    void import("virtual:pwa-register").then(({ registerSW }) => {
      const updateSW = registerSW({ onNeedRefresh: () => setNeedRefresh(true) });
      setUpdate(() => () => updateSW(true));
    });
  }, []);
  if (!needRefresh) return null;
  return (
    <div role="status" className="card fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 px-4 py-3 md:bottom-6">
      <span className="text-sm">{t("common.updateAvailable")}</span>
      <button className="btn-primary min-h-[36px]" onClick={() => void update?.()}>
        {t("common.reload")}
      </button>
    </div>
  );
}

export function Layout() {
  const { t } = useTranslation();
  const online = useOnline();
  const location = useLocation();
  useEffect(() => {
    document.getElementById("main")?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="min-h-screen md:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:p-3">
        {t("nav.skipToContent")}
      </a>

      {/* Desktop sidebar */}
      <aside className="lacquer sticky top-0 hidden h-screen w-64 shrink-0 flex-col md:flex">
        <div className="px-5 pb-4 pt-6">
          <Brand size={40} />
          <div aria-hidden className="mt-4 flex items-center gap-1.5 opacity-80">
            <span className="h-px flex-1 bg-gradient-to-r from-transparent to-[rgb(var(--frame-text))]" />
            <span className="h-1.5 w-1.5 rotate-45 bg-[rgb(var(--frame-text))]" />
            <span className="h-px flex-1 bg-gradient-to-l from-transparent to-[rgb(var(--frame-text))]" />
          </div>
        </div>
        <nav aria-label={t("nav.mainNavigation")} className="flex-1 px-3">
          <ul className="space-y-1">
            {NAV.map(({ to, key, icon: Icon, ...rest }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={"end" in rest}
                  className={({ isActive }) =>
                    cx(
                      "group relative flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-all duration-200",
                      isActive
                        ? "bg-gradient-to-r from-accent-bright to-accent text-[#3A0A08] shadow-[0_4px_14px_-6px_rgb(var(--accent))]"
                        : "text-frame-muted hover:translate-x-1 hover:bg-white/10 hover:text-frame-text",
                    )
                  }
                >
                  <Icon size={20} aria-hidden />
                  {t(key)}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="px-3 pb-5">
          <NavLink
            to="/notifications"
            className={({ isActive }) =>
              cx(
                "flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-all duration-200",
                isActive ? "bg-gradient-to-r from-accent-bright to-accent text-[#3A0A08]" : "text-frame-muted hover:translate-x-1 hover:bg-white/10 hover:text-frame-text",
              )
            }
          >
            <Bell size={20} aria-hidden /> {t("nav.notifications")}
          </NavLink>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="lacquer sticky top-0 z-30 flex items-center justify-between px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:hidden">
          <Brand size={32} />
          <div className="flex items-center">
            <NavLink
              to="/settings"
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-frame-text transition-colors hover:bg-white/10"
              aria-label={t("nav.settings")}
            >
              <Settings size={22} aria-hidden />
            </NavLink>
            <BellLink />
          </div>
        </header>

        {!online && (
          <div role="status" className="flex items-center gap-2 bg-accent-soft px-4 py-2 text-sm font-medium text-accent-text">
            <WifiOff size={16} aria-hidden /> {t("common.offline")}
          </div>
        )}

        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-5 outline-none sm:px-6 md:pb-10">
          <InstallBanner />
          <div key={location.pathname} className="animate-page-in">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        aria-label={t("nav.mainNavigation")}
        className="lacquer fixed inset-x-0 bottom-0 z-30 pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="grid grid-cols-5">
          {MOBILE_NAV.map(({ to, key, icon: Icon, ...rest }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={"end" in rest}
                className={({ isActive }) =>
                  cx(
                    "flex min-h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors",
                    isActive ? "text-accent-bright" : "text-frame-muted",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={cx(
                        "rounded-full px-4 py-1 transition-all duration-300",
                        isActive ? "-translate-y-0.5 bg-gradient-to-b from-accent-bright to-accent text-[#3A0A08] shadow-[0_4px_12px_-4px_rgb(var(--accent))]" : "",
                      )}
                    >
                      <Icon size={20} aria-hidden />
                    </span>
                    {t(key)}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <UpdateToast />
    </div>
  );
}
