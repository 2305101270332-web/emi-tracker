import { useMemo, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BellOff, CreditCard, Plus, UserRound, Users } from "lucide-react";
import { useFormat } from "../lib/format";
import { splitAmount, type CardSnapshot, type LoanListItem } from "@emi/shared";
import { useLenders, useLoans, useSharedLoans } from "../lib/queries";
import { ErrorState, LenderAvatar, PageHeader, ProgressBar, SelectField, Spinner, cx } from "../components/ui";
import { LOAN_SORTS, readLoanSort, saveLoanSort, sortLoans, type LoanSort } from "../lib/sort-loans";
import { FILTER_KEYS, activeFilters, filterLoans, filterOptions, readFilters, type LoanFilters } from "../lib/filter-loans";
import { LoanFilterBar } from "../components/LoanFilters";

/** Which card a card EMI is on, and whose name is on it when it isn't the user's own. */
export function CardLine({ card, className }: { card: CardSnapshot; className?: string }) {
  const { t } = useTranslation();
  const label = `${card.nickname}${card.last4 ? ` ••${card.last4}` : ""}`;
  const holder = card.holderName ? t("loans.nameOnCard", { name: card.holderName }) : null;
  // Two lines, so a long card name never hides whose name is on the card.
  return (
    <div className={cx("mt-1 min-w-0 space-y-0.5 text-xs", className)}>
      <p className="flex min-w-0 items-center gap-1 text-muted" title={label}>
        <CreditCard size={13} className="shrink-0 text-accent-text" aria-hidden />
        <span className="truncate">{label}</span>
      </p>
      {holder && (
        <p className="flex min-w-0 items-center gap-1 font-semibold text-fg" title={holder}>
          <UserRound size={13} className="shrink-0 text-accent-text" aria-hidden />
          <span className="truncate">{holder}</span>
        </p>
      )}
    </div>
  );
}

export function Loans() {
  const { t } = useTranslation();
  const f = useFormat();
  const loans = useLoans();
  const lenders = useLenders();
  const shared = useSharedLoans();
  const lender = (id: string) => lenders.data?.find((l) => l.id === id);
  const [sort, setSort] = useState<LoanSort>(readLoanSort);
  const changeSort = (next: LoanSort) => {
    setSort(next);
    saveLoanSort(next);
  };
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => readFilters(params), [params]);
  const today = f.today();
  const allMine = useMemo(() => sortLoans(loans.data ?? [], sort), [loans.data, sort]);
  const allShared = useMemo(() => sortLoans(shared.data ?? [], sort), [shared.data, sort]);
  const options = useMemo(() => filterOptions([...allMine, ...allShared]), [allMine, allShared]);
  const mine = useMemo(() => filterLoans(allMine, filters, today), [allMine, filters, today]);
  const sharedList = useMemo(() => filterLoans(allShared, filters, today), [allShared, filters, today]);
  const total = allMine.length + allShared.length;
  const filtering = activeFilters(filters).length > 0;

  const setFilter = (key: keyof LoanFilters, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === "due" && value !== "range") {
      next.delete("from");
      next.delete("to");
    }
    setParams(next, { replace: true });
  };
  const clearFilters = () => {
    const next = new URLSearchParams(params);
    for (const k of FILTER_KEYS) next.delete(k);
    setParams(next, { replace: true });
  };

  const add = (
    <>
      <Link to="/cards" className="btn-secondary">
        <CreditCard size={18} aria-hidden /> {t("nav.cards")}
      </Link>
      <Link to="/loans/new" className="btn-primary">
        <Plus size={18} aria-hidden /> {t("loans.add")}
      </Link>
    </>
  );
  if (loans.isLoading) return <Spinner />;
  if (loans.error) return <ErrorState error={loans.error} onRetry={() => void loans.refetch()} />;

  const card = (l: LoanListItem, idx: number) => {
    const closed = l.progress.principalOutstanding <= 0;
    const lend = l.lender ?? lender(l.lenderId);
    return (
      <li key={l.id} className="animate-rise" style={{ "--i": Math.min(idx, 8) } as CSSProperties}>
        <Link to={`/loans/${l.id}`} className="card block h-full p-4">
          <div className="flex items-start gap-3">
            <LenderAvatar lender={lend} />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1 truncate font-semibold">
                {l.nickname}
                {l.muted && l.access === "owner" && <BellOff size={14} className="text-muted" aria-label={t("loans.muted")} />}
              </p>
              <p className="truncate text-xs text-muted">
                {lend?.name} · {l.type === "other" ? l.customTypeLabel : t(`loans.types.${l.type}`)}
              </p>
              {l.card && <CardLine card={l.card} />}
              {l.access !== "owner" && (
                <p className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                  <span className="rounded-full bg-primary-soft px-2 py-0.5 font-semibold text-primary-strong">
                    {l.access === "edit" ? t("loans.accessEdit") : t("loans.accessView")}
                  </span>
                  <span className="text-muted">{t("loans.sharedBy", { name: l.ownerName ?? "" })}</span>
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-xs text-muted">{t("loans.emi")}</p>
              <p className="num font-bold">{f.money(l.summary.emi, l.currency)}</p>
              {l.splits.length > 0 && (
                <>
                  <p className="mt-1 text-xs text-muted">{l.access === "owner" ? t("loans.yourShare") : t("loans.ownerShare", { name: l.ownerName ?? "" })}</p>
                  <p className="num text-sm font-semibold text-accent-text">{f.money(splitAmount(l.summary.emi, l.splits).mine, l.currency)}</p>
                </>
              )}
            </div>
          </div>
          {l.splits.length > 0 && (
            <p className="mt-2 flex min-w-0 items-center gap-1 text-xs text-muted">
              <Users size={13} className="shrink-0 text-accent-text" aria-hidden />
              <span className="truncate">{t("loans.splitWith", { names: l.splits.map((x) => x.name).join(", ") })}</span>
            </p>
          )}
          <div className="mt-4">
            <ProgressBar value={l.progress.progress} label={t("loans.progress", { percent: Math.round(l.progress.progress * 100) })} />
            <div className="mt-2 flex justify-between text-xs text-muted">
              <span>{t("loans.progress", { percent: Math.round(l.progress.progress * 100) })}</span>
              <span>{closed ? t("loans.closed") : t("loans.instalmentsLeft", { count: l.progress.instalmentsLeft })}</span>
            </div>
          </div>
          <div className="mt-3 flex items-end justify-between border-t border-line pt-3 text-sm">
            <div>
              <p className="text-xs text-muted">{t("loans.outstanding")}</p>
              <p className="num font-semibold">{f.money(l.progress.principalOutstanding, l.currency)}</p>
            </div>
            {l.nextInstalment && (
              <p className={l.nextInstalment.status === "overdue" ? "font-semibold text-accent-text" : "text-muted"}>
                {t("loans.nextDue", { date: f.date(l.nextInstalment.payableDate) })}
              </p>
            )}
          </div>
        </Link>
      </li>
    );
  };

  return (
    <>
      <PageHeader title={t("loans.title")} actions={add} />
      {total > 1 && (
        <LoanFilterBar
          filters={filters}
          options={options}
          onChange={setFilter}
          onClear={clearFilters}
          shown={mine.length + sharedList.length}
          total={total}
          sort={
            <SelectField label={t("loans.sortBy")} value={sort} onChange={(e) => changeSort(e.target.value as LoanSort)}>
              {LOAN_SORTS.map((k) => (
                <option key={k} value={k}>
                  {t(`loans.sort.${k}`)}
                </option>
              ))}
            </SelectField>
          }
        />
      )}
      {filtering && mine.length + sharedList.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 p-10 text-center text-muted">
          {t("loans.filters.noMatch")}
          <button type="button" className="btn-secondary" onClick={clearFilters}>
            {t("loans.filters.clear")}
          </button>
        </div>
      ) : (
        <>
          {sharedList.length > 0 && mine.length > 0 && <h2 className="mb-3 text-lg font-semibold text-primary-strong">{t("loans.myLoans")}</h2>}
          {allMine.length === 0 ? (
            <div className="card p-10 text-center text-muted">{t("loans.empty")}</div>
          ) : (
            mine.length > 0 && <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{mine.map(card)}</ul>
          )}
        </>
      )}
      {sharedList.length > 0 && (
        <section className="mt-8" aria-labelledby="shared-heading">
          <h2 id="shared-heading" className="mb-3 text-lg font-semibold text-primary-strong">
            {t("loans.sharedWithMe")}
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{sharedList.map(card)}</ul>
        </section>
      )}
    </>
  );
}
