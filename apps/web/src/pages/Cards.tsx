import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { CreditCard, Pencil, Plus, Trash2 } from "lucide-react";
import { cardInputSchema, type Card } from "@emi/shared";
import { HttpError, errorMessage } from "../lib/api";
import { useCards, useDeleteCard, useLenders, useSaveCard } from "../lib/queries";
import { DragonEmblem } from "../components/DragonEmblem";
import { Dialog, ErrorState, LenderAvatar, PageHeader, SelectField, Spinner, TextField } from "../components/ui";

function CardDialog({ card, onClose }: { card: Card | null; onClose: () => void }) {
  const { t } = useTranslation();
  const lenders = useLenders();
  const save = useSaveCard();
  const [nickname, setNickname] = useState(card?.nickname ?? "");
  const [lenderId, setLenderId] = useState(card?.lenderId ?? "");
  const [last4, setLast4] = useState(card?.last4 ?? "");
  const [statementDay, setStatementDay] = useState(String(card?.statementDay ?? ""));
  const [mode, setMode] = useState<"due" | "grace">(card?.graceDays ? "grace" : "due");
  const [dueDay, setDueDay] = useState(String(card?.dueDay ?? ""));
  const [graceDays, setGraceDays] = useState(String(card?.graceDays ?? "20"));
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = cardInputSchema.safeParse({
      nickname,
      lenderId: lenderId || null,
      last4: last4 || null,
      statementDay: Number(statementDay),
      dueDay: mode === "due" ? Number(dueDay) : null,
      graceDays: mode === "grace" ? Number(graceDays) : null,
    });
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "required";
      setError(t(`form.errors.${msg}`, { defaultValue: t("form.errors.required") }));
      return;
    }
    try {
      await save.mutateAsync({ id: card?.id, input: parsed.data });
      onClose();
    } catch (ex) {
      setError(errorMessage(t, ex));
    }
  };

  return (
    <Dialog open onClose={onClose} title={card ? t("common.edit") : t("cards.add")}>
      <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
        <TextField label={t("cards.nickname")} value={nickname} onChange={(e) => setNickname(e.target.value)} required maxLength={60} />
        <SelectField label={t("form.lender")} value={lenderId} onChange={(e) => setLenderId(e.target.value)}>
          <option value="">—</option>
          {lenders.data?.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({l.country})
            </option>
          ))}
        </SelectField>
        <div className="grid grid-cols-2 gap-3">
          <TextField label={t("cards.last4")} inputMode="numeric" value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} />
          <TextField label={t("cards.statementDay")} inputMode="numeric" value={statementDay} onChange={(e) => setStatementDay(e.target.value)} required />
        </div>
        <fieldset>
          <legend className="label">{t("cards.dueMode")}</legend>
          <div className="flex gap-4">
            {(["due", "grace"] as const).map((v) => (
              <label key={v} className="flex min-h-[44px] items-center gap-2 text-sm">
                <input type="radio" name="dueMode" checked={mode === v} onChange={() => setMode(v)} className="h-4 w-4 accent-[rgb(var(--primary))]" />
                {v === "due" ? t("cards.useDueDay") : t("cards.useGrace")}
              </label>
            ))}
          </div>
        </fieldset>
        {mode === "due" ? (
          <TextField label={t("cards.dueDay")} inputMode="numeric" value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
        ) : (
          <TextField label={t("cards.graceDays")} inputMode="numeric" value={graceDays} onChange={(e) => setGraceDays(e.target.value)} />
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <button className="btn-primary w-full" disabled={save.isPending}>
          {save.isPending ? t("common.saving") : t("common.save")}
        </button>
      </form>
    </Dialog>
  );
}

export function Cards() {
  const { t } = useTranslation();
  const cards = useCards();
  const lenders = useLenders();
  const del = useDeleteCard();
  const [editing, setEditing] = useState<Card | null | "new">(null);
  const [error, setError] = useState<string | null>(null);

  const onDelete = async (c: Card) => {
    if (!confirm(t("cards.deleteConfirm"))) return;
    try {
      setError(null);
      await del.mutateAsync(c.id);
    } catch (ex) {
      setError(ex instanceof HttpError && ex.status === 409 ? t("cards.inUse") : t("common.errorGeneric"));
    }
  };

  if (cards.isLoading) return <Spinner />;
  if (cards.error) return <ErrorState error={cards.error} onRetry={() => void cards.refetch()} />;
  return (
    <>
      <PageHeader
        title={t("cards.title")}
        actions={
          <button className="btn-primary" onClick={() => setEditing("new")}>
            <Plus size={18} aria-hidden /> {t("cards.add")}
          </button>
        }
      />
      {error && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {error}
        </p>
      )}
      {cards.data!.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 p-10 text-center text-muted">
          <CreditCard size={36} className="text-primary" aria-hidden />
          {t("cards.empty")}
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {cards.data!.map((c) => {
            const lender = lenders.data?.find((l) => l.id === c.lenderId);
            return (
              <li key={c.id} className="card overflow-hidden">
                <div className="lacquer relative overflow-hidden p-4">
                  <DragonEmblem size={88} className="pointer-events-none absolute -bottom-6 -right-5 opacity-25" />
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{c.nickname}</span>
                    {lender && <LenderAvatar lender={lender} size={28} />}
                  </div>
                  <p className="mt-6 font-mono tracking-widest">•••• {c.last4 ?? "····"}</p>
                </div>
                <div className="flex items-center justify-between gap-2 p-4">
                  <p className="text-sm text-muted">
                    {t("cards.cycle", {
                      statement: c.statementDay,
                      due: c.dueDay ? t("cards.dueOnDay", { day: c.dueDay }) : t("cards.dueAfter", { days: c.graceDays }),
                    })}
                  </p>
                  <div className="flex shrink-0">
                    <button className="btn-ghost px-2" onClick={() => setEditing(c)} aria-label={`${t("common.edit")} ${c.nickname}`}>
                      <Pencil size={16} aria-hidden />
                    </button>
                    <button className="btn-ghost px-2 text-danger" onClick={() => void onDelete(c)} aria-label={`${t("common.delete")} ${c.nickname}`}>
                      <Trash2 size={16} aria-hidden />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {editing && <CardDialog card={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
