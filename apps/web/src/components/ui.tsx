import { useEffect, useId, useRef, type CSSProperties, type ChangeEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, X } from "lucide-react";
import type { InstalmentStatus } from "@emi/core";
import type { Lender } from "@emi/shared";
import { errorMessage } from "../lib/api";
import { DragonEmblem } from "./DragonEmblem";
import { Select } from "./Select";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Field(props: {
  label: string;
  hint?: string;
  error?: string;
  children: (id: string, describedBy?: string) => ReactNode;
  className?: string;
  hideLabel?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const hintId = props.hint ? `${id}-hint` : undefined;
  const errId = props.error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={props.className}>
      <label htmlFor={id} id={`${id}-label`} className={props.hideLabel ? "sr-only" : "label"}>
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
  value,
  onChange,
  disabled,
  hideLabel,
}: {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: ReactNode;
  value?: string | number;
  onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
  disabled?: boolean;
  hideLabel?: boolean;
  required?: boolean;
}) {
  return (
    <Field label={label} hint={hint} error={error} className={className} hideLabel={hideLabel}>
      {(id, d) => (
        <Select id={id} value={value} onChange={onChange} disabled={disabled} invalid={!!error} describedBy={d}>
          {children}
        </Select>
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
          "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors duration-300 disabled:opacity-50",
          props.checked ? "border-accent-text/60 bg-primary" : "border-line bg-surface-2",
        )}
      >
        <span
          aria-hidden
          className={cx(
            "inline-block h-5 w-5 rounded-full border border-accent-text/50 shadow transition-transform duration-300 ease-[cubic-bezier(.3,1.4,.5,1)]",
            props.checked ? "translate-x-6" : "translate-x-1",
          )}
          style={{ background: "linear-gradient(160deg, rgb(var(--accent-bright)), rgb(var(--accent)))" }}
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
      className="animate-pop w-[min(32rem,calc(100vw-2rem))] overflow-hidden rounded-card border border-accent/70 bg-surface p-0 text-fg shadow-card backdrop:bg-black/50 backdrop:backdrop-blur-[2px]"
    >
      <div className="lacquer flex items-center justify-between px-5 py-3">
        <h2 id="dialog-title" className="flex items-center gap-2 text-lg font-semibold">
          <DragonEmblem size={24} />
          {props.title}
        </h2>
        <button
          type="button"
          onClick={props.onClose}
          className="btn min-h-[40px] px-2 text-frame-text hover:bg-white/10"
          aria-label={t("common.close")}
        >
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
    <div role="status" className="animate-fade flex flex-col items-center justify-center gap-3 p-10 text-muted">
      <DragonEmblem size={56} className="animate-coil drop-shadow" />
      <span className="font-display text-sm tracking-widest">{label ?? t("common.loading")}</span>
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
  paid: "bg-success/15 text-success ring-1 ring-success/30",
  due: "bg-accent-soft text-accent-text ring-1 ring-accent/50",
  overdue: "bg-danger text-danger-on [animation:ember_2.4s_ease-in-out_infinite]",
  upcoming: "bg-primary-soft text-primary-strong ring-1 ring-primary/20",
  skipped: "bg-surface-2 text-muted ring-1 ring-line",
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
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2 ring-1 ring-inset ring-line"
    >
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-out"
        style={{ width: `${pct}%`, background: "linear-gradient(90deg, rgb(var(--primary)), rgb(var(--accent)))" }}
      />
    </div>
  );
}

export function LenderAvatar({ lender, size = 40 }: { lender?: Pick<Lender, "color" | "initial" | "name">; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-xl font-display font-bold text-white ring-2 ring-accent/70 ring-offset-1 ring-offset-surface"
      style={{ width: size, height: size, background: lender?.color ?? "rgb(var(--primary))", fontSize: size * 0.42 }}
    >
      {lender?.initial ?? "?"}
    </span>
  );
}

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="animate-page-in mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="gilded-text text-2xl font-bold sm:text-3xl">{title}</h1>
        <div aria-hidden className="mt-1 flex items-center gap-1.5">
          <span className="h-0.5 w-10 rounded bg-accent" />
          <span className="h-1.5 w-1.5 rotate-45 bg-accent" />
          <span className="h-0.5 w-20 rounded bg-gradient-to-r from-accent to-transparent" />
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, children, className, index = 0 }: { title?: string; children: ReactNode; className?: string; index?: number }) {
  return (
    <section className={cx("card animate-rise p-4 sm:p-5", className)} style={{ "--i": index } as CSSProperties}>
      {title && <h2 className="ornate-title">{title}</h2>}
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
