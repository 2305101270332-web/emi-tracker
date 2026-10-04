import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BellRing, CheckCheck } from "lucide-react";
import { useMarkAllRead, useNotifications } from "../lib/queries";
import { useFormat } from "../lib/format";
import { ErrorState, PageHeader, Spinner, cx } from "../components/ui";

export function Notifications() {
  const { t } = useTranslation();
  const f = useFormat();
  const q = useNotifications();
  const markAll = useMarkAllRead();
  const unread = q.data?.some((n) => !n.readAt);

  // Opening the centre marks everything read after a short delay so unread items are still highlighted.
  useEffect(() => {
    if (!unread) return;
    const id = setTimeout(() => markAll.mutate(), 2500);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread]);

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <>
      <PageHeader
        title={t("notifications.title")}
        actions={
          unread ? (
            <button className="btn-secondary" onClick={() => markAll.mutate()}>
              <CheckCheck size={16} aria-hidden /> {t("notifications.markAllRead")}
            </button>
          ) : undefined
        }
      />
      {q.data!.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 p-10 text-center text-muted">
          <BellRing size={36} className="text-primary" aria-hidden />
          {t("notifications.empty")}
        </div>
      ) : (
        <ul className="card divide-y divide-line">
          {q.data!.map((n) => (
            <li key={n.id} className={cx("flex gap-3 p-4", !n.readAt && "bg-primary-soft/40")}>
              <span aria-hidden className={cx("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", n.kind === "overdue" ? "bg-accent" : "bg-primary", n.readAt && "opacity-0")} />
              <div className="min-w-0 flex-1">
                {n.loanId ? (
                  <Link to={`/loans/${n.loanId}`} className="font-semibold hover:underline">
                    {n.title}
                  </Link>
                ) : (
                  <p className="font-semibold">{n.title}</p>
                )}
                <p className="text-sm text-muted">{n.body}</p>
                <p className="mt-1 text-xs text-muted">{f.date(n.createdAt.slice(0, 10))}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
