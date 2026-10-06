import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { DUE_FILTERS, OWN_CARD, activeFilters, type FilterOptions, type LoanFilters } from "../lib/filter-loans";
import { SelectField, TextField, cx } from "./ui";

/** Search box, "Filters" toggle with a panel of choices, and removable chips for active filters. */
export function LoanFilterBar({
  filters,
  options,
  onChange,
  onClear,
  shown,
  total,
  sort,
}: {
  filters: LoanFilters;
  options: FilterOptions;
  onChange: (key: keyof LoanFilters, value: string) => void;
  onClear: () => void;
  shown: number;
  total: number;
  /** The sort control, placed in the same toolbar. */
  sort: ReactNode;
}) {
  const { t } = useTranslation();
  const active = activeFilters(filters).filter((k) => k !== "q");
  const [open, setOpen] = useState(active.length > 0);
  const any = t("loans.filters.any");

  const labelFor = (k: keyof LoanFilters): string => {
    const v = filters[k];
    switch (k) {
      case "bank":
        return `${t("loans.filters.bank")}: ${v}`;
      case "card":
        return `${t("loans.filters.card")}: ${v === "none" ? t("loans.filters.noCard") : (options.cards.find((c) => c.id === v)?.label ?? v)}`;
      case "holder":
        return `${t("loans.filters.holder")}: ${v === OWN_CARD ? t("loans.filters.ownCard") : v}`;
      case "type":
        return `${t("loans.filters.type")}: ${t(`loans.types.${v}`)}`;
      case "due":
        return v === "range"
          ? `${t("loans.filters.due")}: ${filters.from || "…"} – ${filters.to || "…"}`
          : `${t("loans.filters.due")}: ${t(`loans.filters.dueOptions.${v}`)}`;
      case "status":
        return `${t("loans.filters.status")}: ${t(`loans.filters.${v}`)}`;
      case "split":
        return v === "yes" ? t("loans.filters.splitYes") : t("loans.filters.splitNo");
      case "currency":
        return `${t("loans.filters.currency")}: ${v}`;
      default:
        return v;
    }
  };

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-[12rem] flex-1">
          <label htmlFor="loan-search" className="label">
            {t("loans.filters.search")}
          </label>
          <Search size={16} className="pointer-events-none absolute bottom-3.5 left-3 text-muted" aria-hidden />
          <input
            id="loan-search"
            type="search"
            className="input pl-9"
            placeholder={t("loans.filters.searchPlaceholder")}
            value={filters.q}
            onChange={(e) => onChange("q", e.target.value)}
          />
        </div>
        <button type="button" className={cx("btn-secondary", open && "ring-2 ring-accent/60")} aria-expanded={open} aria-controls="loan-filter-panel" onClick={() => setOpen((o) => !o)}>
          <SlidersHorizontal size={16} aria-hidden /> {t("loans.filters.button")}
          {active.length > 0 && <span className="num rounded-full bg-accent px-1.5 text-xs font-bold text-accent-on">{active.length}</span>}
        </button>
        <div className="w-full sm:w-60">{sort}</div>
      </div>

      {open && (
        <div id="loan-filter-panel" className="card animate-drop grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <SelectField label={t("loans.filters.bank")} value={filters.bank} onChange={(e) => onChange("bank", e.target.value)}>
            <option value="">{any}</option>
            {options.banks.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </SelectField>
          <SelectField label={t("loans.filters.card")} value={filters.card} onChange={(e) => onChange("card", e.target.value)}>
            <option value="">{any}</option>
            {options.cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
            <option value="none">{t("loans.filters.noCard")}</option>
          </SelectField>
          {(options.holders.length > 0 || options.ownCards) && (
            <SelectField label={t("loans.filters.holder")} value={filters.holder} onChange={(e) => onChange("holder", e.target.value)}>
              <option value="">{any}</option>
              {options.ownCards && <option value={OWN_CARD}>{t("loans.filters.ownCard")}</option>}
              {options.holders.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </SelectField>
          )}
          <SelectField label={t("loans.filters.type")} value={filters.type} onChange={(e) => onChange("type", e.target.value)}>
            <option value="">{any}</option>
            {options.types.map((ty) => (
              <option key={ty} value={ty}>
                {t(`loans.types.${ty}`)}
              </option>
            ))}
          </SelectField>
          <SelectField label={t("loans.filters.due")} value={filters.due} onChange={(e) => onChange("due", e.target.value)}>
            <option value="">{any}</option>
            {DUE_FILTERS.map((d) => (
              <option key={d} value={d}>
                {t(`loans.filters.dueOptions.${d}`)}
              </option>
            ))}
          </SelectField>
          {filters.due === "range" && (
            <>
              <TextField label={t("loans.filters.from")} type="date" value={filters.from} onChange={(e) => onChange("from", e.target.value)} />
              <TextField label={t("loans.filters.to")} type="date" value={filters.to} onChange={(e) => onChange("to", e.target.value)} />
            </>
          )}
          <SelectField label={t("loans.filters.status")} value={filters.status} onChange={(e) => onChange("status", e.target.value)}>
            <option value="">{any}</option>
            <option value="active">{t("loans.filters.active")}</option>
            <option value="closed">{t("loans.filters.closed")}</option>
          </SelectField>
          {options.anySplit && (
            <SelectField label={t("loans.filters.split")} value={filters.split} onChange={(e) => onChange("split", e.target.value)}>
              <option value="">{any}</option>
              <option value="yes">{t("loans.filters.splitYes")}</option>
              <option value="no">{t("loans.filters.splitNo")}</option>
            </SelectField>
          )}
          {options.currencies.length > 1 && (
            <SelectField label={t("loans.filters.currency")} value={filters.currency} onChange={(e) => onChange("currency", e.target.value)}>
              <option value="">{any}</option>
              {options.currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </SelectField>
          )}
        </div>
      )}

      {(active.length > 0 || filters.q.trim()) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted" role="status">
            {t("loans.filters.showing", { shown, total })}
          </span>
          {active.map((k) => (
            <button
              key={k}
              type="button"
              className="inline-flex min-h-[32px] items-center gap-1 rounded-full border border-accent/60 bg-accent-soft px-3 text-xs font-semibold text-accent-text"
              onClick={() => onChange(k, "")}
              aria-label={t("loans.filters.remove", { label: labelFor(k) })}
            >
              {labelFor(k)} <X size={12} aria-hidden />
            </button>
          ))}
          <button type="button" className="text-xs font-semibold text-primary-strong underline" onClick={onClear}>
            {t("loans.filters.clear")}
          </button>
        </div>
      )}
    </div>
  );
}
