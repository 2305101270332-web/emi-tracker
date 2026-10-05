import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BellOff, CreditCard, Plus } from "lucide-react";
import { useFormat } from "../lib/format";
import type { LoanListItem } from "@emi/shared";
import { useLenders, useLoans, useSharedLoans } from "../lib/queries";
import { ErrorState, LenderAvatar, PageHeader, ProgressBar, Spinner } from "../components/ui";

export function Loans() {
  const { t } = useTranslation();
  const f = useFormat();
  const loans = useLoans();
  const lenders = useLenders();
  const shared = useSharedLoans();
  const lender = (id: string) => lenders.data?.find((l) => l.id === id);

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
            </div>
          </div>
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

  const sharedList = shared.data ?? [];
  return (
    <>
      <PageHeader title={t("loans.title")} actions={add} />
      {sharedList.length > 0 && <h2 className="mb-3 text-lg font-semibold text-primary-strong">{t("loans.myLoans")}</h2>}
      {loans.data!.length === 0 ? (
        <div className="card p-10 text-center text-muted">{t("loans.empty")}</div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{loans.data!.map(card)}</ul>
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
