import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Trash2 } from "lucide-react";
import { COMMON_CURRENCIES, COUNTRIES, DATE_FORMATS, TAX_LABELS, countryDefaults, type Settings as SettingsT } from "@emi/shared";
import { api } from "../lib/api";
import { useDeleteLender, useLenders, useMe, useSaveSettings } from "../lib/queries";
import { getPushState, subscribePush, unsubscribePush, type PushState } from "../lib/pwa";
import { applyTheme } from "../lib/theme";
import { ErrorState, LenderAvatar, PageHeader, Section, SelectField, Spinner, TextField, Toggle } from "../components/ui";

const timeZones = (): string[] => {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
  } catch {
    return COUNTRIES.map((c) => c.timeZone);
  }
};

function PushSettings() {
  const { t } = useTranslation();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  useEffect(() => {
    void getPushState().then(setState);
  }, []);
  if (state === null) return null;
  return (
    <div className="space-y-2">
      {state === "unsupported" && <p className="text-sm text-muted">{t("settings.pushUnsupported")}</p>}
      {state === "denied" && <p className="text-sm text-accent-text">{t("settings.pushDenied")}</p>}
      {state === "unconfigured" && <p className="text-sm text-muted">{t("settings.pushUnconfigured")}</p>}
      {(state === "default" || state === "subscribed") && (
        <Toggle
          label={state === "subscribed" ? t("settings.pushEnabled") : t("settings.pushEnable")}
          checked={state === "subscribed"}
          disabled={busy}
          onChange={async (on) => {
            setBusy(true);
            try {
              if (on) setState(await subscribePush());
              else {
                await unsubscribePush();
                setState("default");
              }
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      {state === "subscribed" && (
        <button
          className="btn-secondary"
          onClick={async () => {
            const r = await api<{ sent: number }>("/push/test", { method: "POST" }).catch(() => ({ sent: 0 }));
            setSent(String(r.sent));
          }}
        >
          {t("settings.pushTest")}
        </button>
      )}
      {sent !== null && <p role="status" className="text-xs text-muted">✓ {sent}</p>}
    </div>
  );
}

export function Settings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const me = useMe();
  const save = useSaveSettings();
  const lenders = useLenders();
  const delLender = useDeleteLender();
  const [status, setStatus] = useState<string | null>(null);
  const zones = useMemo(timeZones, []);

  if (me.isLoading) return <Spinner />;
  if (me.error || !me.data) return <ErrorState error={me.error} />;
  const s = me.data.settings;

  const patch = async (p: Partial<SettingsT>) => {
    setStatus(null);
    if (p.theme) applyTheme(p.theme);
    await save.mutateAsync(p);
    setStatus(t("settings.saved"));
  };

  const signOut = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_API_CACHE" });
    qc.clear();
    qc.setQueryData(["me"], null);
  };

  const days = [7, 5, 3, 2, 1];

  return (
    <>
      <PageHeader
        title={t("settings.title")}
        actions={
          <button className="btn-secondary" onClick={() => void signOut()}>
            <LogOut size={16} aria-hidden /> {t("common.signOut")}
          </button>
        }
      />
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={t("settings.profile")}>
          <div className="flex items-center gap-3">
            {me.data.user.picture ? (
              <img src={me.data.user.picture} alt="" width={48} height={48} className="rounded-full" referrerPolicy="no-referrer" />
            ) : (
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft font-bold text-primary-strong">{me.data.user.name[0]}</span>
            )}
            <div>
              <p className="font-semibold">{me.data.user.name}</p>
              <p className="text-sm text-muted">{me.data.user.email}</p>
            </div>
          </div>
        </Section>

        <Section title={t("settings.appearance")}>
          <SelectField label={t("settings.theme")} value={s.theme} onChange={(e) => void patch({ theme: e.target.value as SettingsT["theme"] })}>
            <option value="system">{t("settings.themeSystem")}</option>
            <option value="light">{t("settings.themeLight")}</option>
            <option value="dark">{t("settings.themeDark")}</option>
          </SelectField>
        </Section>

        <Section title={t("settings.region")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label={t("settings.country")}
              value={s.country}
              onChange={(e) => {
                const d = countryDefaults(e.target.value);
                void patch({ country: d.code, currency: d.currency, locale: d.locale, timeZone: d.timeZone, dateFormat: d.dateFormat, taxLabel: d.taxLabel, taxRate: d.taxRate });
              }}
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </SelectField>
            <SelectField label={t("settings.currency")} value={s.currency} onChange={(e) => void patch({ currency: e.target.value })}>
              {[...new Set([s.currency, ...COMMON_CURRENCIES])].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </SelectField>
            <SelectField label={t("settings.locale")} value={s.locale} onChange={(e) => void patch({ locale: e.target.value })}>
              {[...new Set([s.locale, ...COUNTRIES.map((c) => c.locale)])].map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </SelectField>
            <SelectField label={t("settings.dateFormat")} value={s.dateFormat} onChange={(e) => void patch({ dateFormat: e.target.value as SettingsT["dateFormat"] })}>
              {DATE_FORMATS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </SelectField>
            <SelectField label={t("settings.timeZone")} value={s.timeZone} onChange={(e) => void patch({ timeZone: e.target.value })} className="sm:col-span-2">
              {[...new Set([s.timeZone, ...zones])].map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </SelectField>
          </div>
        </Section>

        <Section title={t("settings.tax")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label={t("settings.taxLabel")} value={s.taxLabel} onChange={(e) => void patch({ taxLabel: e.target.value as SettingsT["taxLabel"] })}>
              {TAX_LABELS.map((l) => (
                <option key={l} value={l}>
                  {l === "None" ? t("common.none") : l}
                </option>
              ))}
            </SelectField>
            <TextField
              label={t("settings.taxRate")}
              inputMode="decimal"
              defaultValue={String(s.taxRate)}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v >= 0 && v <= 100 && v !== s.taxRate) void patch({ taxRate: v });
              }}
            />
          </div>
        </Section>

        <Section title={t("settings.reminders")}>
          <SelectField label={t("settings.reminderHour")} value={String(s.reminderHour)} onChange={(e) => void patch({ reminderHour: Number(e.target.value) })}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {new Intl.DateTimeFormat(s.locale, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(Date.UTC(2024, 0, 1, h))}
              </option>
            ))}
          </SelectField>
          <fieldset className="mt-4">
            <legend className="label">{t("settings.reminderDaysBefore")}</legend>
            <div className="flex flex-wrap gap-2">
              {days.map((d) => {
                const on = s.reminderDaysBefore.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() => void patch({ reminderDaysBefore: on ? s.reminderDaysBefore.filter((x) => x !== d) : [...s.reminderDaysBefore, d] })}
                    className={on ? "btn min-h-[40px] bg-primary text-primary-on" : "btn-secondary min-h-[40px]"}
                  >
                    {t("common.days", { count: d })}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="mt-2 divide-y divide-line">
            <Toggle label={t("settings.remindOnDay")} checked={s.remindOnDay} onChange={(v) => void patch({ remindOnDay: v })} />
            <Toggle label={t("settings.remindOverdue")} checked={s.remindOverdue} onChange={(v) => void patch({ remindOverdue: v })} />
          </div>
        </Section>

        <Section title={t("settings.push")}>
          <Toggle label={t("settings.push")} checked={s.pushEnabled} onChange={(v) => void patch({ pushEnabled: v })} />
          {s.pushEnabled && <PushSettings />}
          <h3 className="mb-1 mt-5 text-sm font-semibold text-primary-strong">{t("settings.email")}</h3>
          <div className="divide-y divide-line">
            <Toggle label={t("settings.emailReminders")} checked={s.emailReminders} onChange={(v) => void patch({ emailReminders: v })} />
            <Toggle label={t("settings.weeklySummary")} checked={s.weeklySummary} onChange={(v) => void patch({ weeklySummary: v })} />
          </div>
        </Section>

        <Section title={t("settings.lenders")}>
          <ul className="divide-y divide-line">
            {(lenders.data ?? [])
              .filter((l) => l.custom)
              .map((l) => (
                <li key={l.id} className="flex items-center gap-3 py-2">
                  <LenderAvatar lender={l} size={32} />
                  <span className="flex-1">{l.name}</span>
                  <button className="btn-ghost px-2 text-danger" onClick={() => delLender.mutate(l.id)} aria-label={`${t("common.delete")} ${l.name}`}>
                    <Trash2 size={16} aria-hidden />
                  </button>
                </li>
              ))}
          </ul>
          {delLender.error && <p role="alert" className="text-sm text-danger">{(delLender.error as Error).message}</p>}
        </Section>
      </div>
    </>
  );
}
