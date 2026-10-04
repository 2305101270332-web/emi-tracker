import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, Lock, LogOut, MonitorSmartphone, Trash2, UserX } from "lucide-react";
import { parseMajor, toMajorString } from "@emi/core";
import { COMMON_CURRENCIES, COUNTRIES, DATE_FORMATS, TAX_LABELS, countryDefaults, type Settings as SettingsT } from "@emi/shared";
import { api } from "../lib/api";
import { useDeleteAccount, useDeleteLender, useDeletionImpact, useLenders, useMe, useSaveSettings } from "../lib/queries";
import { HttpError, errorMessage } from "../lib/api";
import { getPushState, subscribePush, unsubscribePush, type PushState } from "../lib/pwa";
import { applyTheme } from "../lib/theme";
import { Dialog, ErrorState, LenderAvatar, PageHeader, Section, SelectField, Spinner, TextField, Toggle } from "../components/ui";

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

function IncomeSection({ settings, onSave }: { settings: SettingsT; onSave: (p: Partial<SettingsT>) => Promise<void> }) {
  const { t } = useTranslation();
  const currency = settings.incomeCurrency ?? settings.currency;
  const [value, setValue] = useState(settings.monthlyIncome !== null ? toMajorString(settings.monthlyIncome, currency) : "");
  const [error, setError] = useState<string | null>(null);
  const save = async (raw: string, cur: string) => {
    setError(null);
    if (!raw.trim()) return onSave({ monthlyIncome: null, incomeCurrency: null });
    try {
      await onSave({ monthlyIncome: parseMajor(raw, cur), incomeCurrency: cur });
    } catch {
      setError(t("form.errors.invalid_amount"));
    }
  };
  return (
    <Section title={t("settings.income")}>
      <p className="mb-3 flex gap-2 text-sm text-muted">
        <Lock size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden />
        {t("settings.incomeIntro")}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t("settings.monthlyIncome")}
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => void save(value, currency)}
          error={error ?? undefined}
        />
        <SelectField label={t("settings.incomeCurrency")} value={currency} onChange={(e) => void save(value, e.target.value)}>
          {[...new Set([currency, ...COMMON_CURRENCIES])].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </SelectField>
      </div>
      {settings.monthlyIncome !== null && (
        <button
          className="btn-ghost mt-2"
          onClick={() => {
            setValue("");
            void save("", currency);
          }}
        >
          {t("settings.incomeClear")}
        </button>
      )}
    </Section>
  );
}

function DataSection({ email, onDeleted }: { email: string; onDeleted: () => void }) {
  const { t } = useTranslation();
  const del = useDeleteAccount();
  const [open, setOpen] = useState(false);
  const impact = useDeletionImpact(open);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";
  return (
    <Section title={t("data.title")}>
      <a className="btn-secondary" href={`${base}/api/account/export`} download>
        <Download size={16} aria-hidden /> {t("data.export")}
      </a>
      <p className="hint">{t("data.exportHint")}</p>
      <div className="mt-5 border-t border-line pt-4">
        <button className="btn-danger" onClick={() => setOpen(true)}>
          <UserX size={16} aria-hidden /> {t("data.delete")}
        </button>
        <p className="hint">{t("data.deleteHint")}</p>
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("data.deleteConfirmTitle")}>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await del.mutateAsync(typed);
              onDeleted();
            } catch (ex) {
              setError(ex instanceof HttpError && ex.status === 422 ? t("data.emailMismatch") : t("common.errorGeneric"));
            }
          }}
        >
          <p className="text-sm text-muted">{t("data.deleteHint")}</p>
          <div className="rounded-xl border border-danger/40 bg-danger/5 p-3">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-danger">
              <AlertTriangle size={16} aria-hidden /> {t("data.impactTitle")}
            </p>
            {impact.data ? (
              <ul className="list-disc space-y-1 pl-5 text-sm">
                <li>{t("data.impactOwned", { count: impact.data.ownedLoans })}</li>
                {impact.data.ownedSharedLoans > 0 && (
                  <li>{t("data.impactShared", { recipients: impact.data.shareRecipients, loans: impact.data.ownedSharedLoans })}</li>
                )}
                {impact.data.sharedWithMe > 0 && <li>{t("data.impactSharedWithMe", { count: impact.data.sharedWithMe })}</li>}
                <li>{t("data.impactIncome")}</li>
              </ul>
            ) : (
              <p className="text-sm text-muted">{t("common.loading")}</p>
            )}
          </div>
          <TextField label={t("data.deleteConfirmLabel")} hint={t("data.deleteConfirmBody", { email })} type="email" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" required />
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <button className="btn-danger w-full" disabled={del.isPending || typed.trim().toLowerCase() !== email.toLowerCase()}>
            {t("data.deleteAction")}
          </button>
        </form>
      </Dialog>
    </Section>
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

  const signOut = async (everywhere = false) => {
    if (everywhere && !confirm(t("common.signOutAllConfirm"))) return;
    await api(everywhere ? "/auth/logout-all" : "/auth/logout", { method: "POST" }).catch(() => undefined);
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
          <>
            <button className="btn-secondary" onClick={() => void signOut()}>
              <LogOut size={16} aria-hidden /> {t("common.signOut")}
            </button>
            <button className="btn-danger" onClick={() => void signOut(true)}>
              <MonitorSmartphone size={16} aria-hidden /> {t("common.signOutAll")}
            </button>
          </>
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
          <SelectField
            label={t("settings.dueWindow")}
            hint={t("settings.dueWindowHint")}
            value={String(s.dueWindowDays)}
            onChange={(e) => void patch({ dueWindowDays: Number(e.target.value) })}
            className="mt-4"
          >
            {[...new Set([0, 1, 2, 3, 5, 7, 10, 14, 21, 30, s.dueWindowDays])].sort((a, b) => a - b).map((d) => (
              <option key={d} value={d}>
                {d === 0 ? t("settings.dueWindowSameDay") : t("settings.dueWindowDays", { count: d })}
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
          {delLender.error && <p role="alert" className="text-sm text-danger">{errorMessage(t, delLender.error)}</p>}
        </Section>

        <IncomeSection settings={s} onSave={patch} />

        <DataSection
          email={me.data.user.email}
          onDeleted={() => {
            navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_API_CACHE" });
            qc.clear();
            qc.setQueryData(["me"], null);
          }}
        />
      </div>
    </>
  );
}
