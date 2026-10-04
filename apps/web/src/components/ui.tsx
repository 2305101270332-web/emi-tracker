import { useEffect, useId, useRef, type ReactNode, type SelectHTMLAttributes, type InputHTMLAttributes } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2, X } from "lucide-react";
import type { InstalmentStatus } from "@emi/core";
import type { Lender } from "@emi/shared";
import { errorMessage } from "../lib/api";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Field(props: { label: string; hint?: string; error?: string; children: (id: string, describedBy?: string) => ReactNode; className?: string }) {
  const id = useId();
  const hintId = props.hint ? `${id}-hint` : undefined;
  const errId = props.error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={props.className}>
      <label htmlFor={id} className="label">
        {props.label}
      </label>
      {props.children(id, describedBy)}
      {props.hint && (
        <p id={hintId} className="hint">
          {props.hint}
        </p>
      )}
      {props.error && (
        <p id={errId} role="alert" className="mt-1 text-xs font-medium text-danger">
          {props.error}
        </p>
      )}
    </div>
  );
}

export function TextField({ label, hint, error, className, ...rest }: { label: string; hint?: string; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(id, d) => <input id={id} aria-describedby={d} aria-invalid={!!error || undefined} className="input" {...rest} />}
    </Field>
  );
}

export function SelectField({
  label,
  hint,
  error,
  className,
  children,
  ...rest
}: { label: string; hint?: string; error?: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(id, d) => (
        <select id={id} aria-describedby={d} aria-invalid={!!error || undefined} className="input pr-8" {...rest}>
          {children}
        </select>
      )}
    </Field>
  );
}

export function Toggle(props: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div>
        <label htmlFor={id} className="text-sm font-medium">
          {props.label}
        </label>
        {props.hint && <p className="hint">{props.hint}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={props.checked}
        disabled={props.disabled}
        onClick={() => props.onChange(!props.checked)}
        className={cx(
          "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50",
          props.checked ? "border-primary bg-primary" : "border-line bg-surface-2",
        )}
      >
        <span
          aria-hidden
          className={cx("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform", props.checked ? "translate-x-6" : "translate-x-1")}
        />
      </button>
    </div>
  );
}

export function Dialog(props: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useTranslation();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (props.open && !d.open) d.showModal?.();
    if (!props.open && d.open) d.close?.();
  }, [props.open]);
  if (!props.open) return null;
  return (
    <dialog
      ref={ref}
      onClose={props.onClose}
      onCancel={props.onClose}
      aria-labelledby="dialog-title"
      className="w-[min(32rem,calc(100vw-2rem))] rounded-card border border-line bg-surface p-0 text-fg shadow-card backdrop:bg-black/40"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 id="dialog-title" className="text-lg font-semibold">
          {props.title}
        </h2>
        <button type="button" onClick={props.onClose} className="btn-ghost min-h-[40px] px-2" aria-label={t("common.close")}>
          <X size={20} />
        </button>
      </div>
      <div className="max-h-[75vh] overflow-y-auto p-5">{props.children}</div>
    </dialog>
  );
}

export function Spinner({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div role="status" className="flex items-center justify-center gap-2 p-8 text-muted">
      <Loader2 className="animate-spin" size={20} aria-hidden />
      <span>{label ?? t("common.loading")}</span>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="card flex flex-col items-center gap-3 p-6 text-center">
      <AlertTriangle className="text-accent-text" aria-hidden />
      <p className="text-sm text-muted">{errorMessage(t, error)}</p>
      {onRetry && (
        <button className="btn-secondary" onClick={onRetry}>
          {t("common.retry")}
        </button>
      )}
    </div>
  );
}

const STATUS_STYLE: Record<InstalmentStatus, string> = {
  paid: "bg-success/15 text-success",
  due: "bg-accent-soft text-accent-text",
  overdue: "bg-accent text-accent-on",
  upcoming: "bg-primary-soft text-primary-strong",
  skipped: "bg-surface-2 text-muted",
};

export function StatusBadge({ status }: { status: InstalmentStatus }) {
  const { t } = useTranslation();
  return (
    <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold", STATUS_STYLE[status])}>
      {t(`schedule.statuses.${status}`)}
    </span>
  );
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label} className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
      <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function LenderAvatar({ lender, size = 40 }: { lender?: Pick<Lender, "color" | "initial" | "name">; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-xl font-bold text-white"
      style={{ width: size, height: size, background: lender?.color ?? "#0077B6", fontSize: size * 0.42 }}
    >
      {lender?.initial ?? "?"}
    </span>
  );
}

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold tracking-tight text-primary-strong">{title}</h1>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cx("card p-4 sm:p-5", className)}>
      {title && <h2 className="mb-3 text-base font-semibold text-primary-strong">{title}</h2>}
      {children}
    </section>
  );
}

/** Per-currency amounts, one per line. Never combined across currencies. */
export function MoneyLines({ entries, money, className }: { entries: [string, number][]; money: (v: number, c: string) => string; className?: string }) {
  if (!entries.length) return <span className={cx("num", className)}>—</span>;
  return (
    <span className={cx("flex flex-col", className)}>
      {entries.map(([c, v]) => (
        <span key={c} className="num">
          {money(v, c)}
        </span>
      ))}
    </span>
  );
}
