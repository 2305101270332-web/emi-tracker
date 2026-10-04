import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import type {
  AppNotification,
  Card,
  CardInput,
  Dashboard,
  Lender,
  LenderInput,
  LoanDetail,
  LoanInputRaw,
  LoanListItem,
  Me,
  PaymentInput,
  Settings,
  UpcomingItem,
} from "@emi/shared";
import { api, HttpError } from "./api";

export const keys = {
  me: ["me"] as const,
  lenders: ["lenders"] as const,
  cards: ["cards"] as const,
  loans: ["loans"] as const,
  loan: (id: string) => ["loans", id] as const,
  dashboard: ["dashboard"] as const,
  instalments: (from: string, to: string) => ["instalments", from, to] as const,
  notifications: ["notifications"] as const,
};

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return await api<Me>("/me");
      } catch (e) {
        if (e instanceof HttpError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

export const useLenders = () => useQuery({ queryKey: keys.lenders, queryFn: () => api<Lender[]>("/lenders"), staleTime: 5 * 60_000 });
export const useCards = () => useQuery({ queryKey: keys.cards, queryFn: () => api<Card[]>("/cards") });
export const useLoans = () => useQuery({ queryKey: keys.loans, queryFn: () => api<LoanListItem[]>("/loans") });
export const useLoan = (id: string | undefined) =>
  useQuery({ queryKey: keys.loan(id ?? ""), queryFn: () => api<LoanDetail>(`/loans/${id}`), enabled: !!id });
export const useDashboard = () => useQuery({ queryKey: keys.dashboard, queryFn: () => api<Dashboard>("/dashboard") });
export const useInstalments = (from: string, to: string) =>
  useQuery({ queryKey: keys.instalments(from, to), queryFn: () => api<UpcomingItem[]>(`/instalments?from=${from}&to=${to}`) });
export const useNotifications = () =>
  useQuery({ queryKey: keys.notifications, queryFn: () => api<AppNotification[]>("/notifications"), refetchInterval: 5 * 60_000 });

/** Mutation helper that invalidates the given query keys on success. */
function useApiMutation<TVars, TRes>(fn: (v: TVars) => Promise<TRes>, invalidate: (v: TVars, r: TRes) => QueryKey[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (res, vars) => {
      for (const k of invalidate(vars, res)) void qc.invalidateQueries({ queryKey: k });
    },
  });
}

const loanDataKeys = (id?: string): QueryKey[] => [keys.loans, keys.dashboard, ["instalments"], ...(id ? [keys.loan(id)] : [])];

export function useSaveLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: LoanInputRaw }) =>
      api<LoanDetail>(id ? `/loans/${id}` : "/loans", { method: id ? "PUT" : "POST", body: input }),
    onSuccess: (loan) => {
      qc.setQueryData(keys.loan(loan.id), loan);
      for (const k of loanDataKeys()) void qc.invalidateQueries({ queryKey: k });
    },
  });
}

/** Mutations returning the updated LoanDetail; we write it straight into the cache. */
function useLoanDetailMutation<TVars>(fn: (v: TVars) => Promise<LoanDetail>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (loan) => {
      qc.setQueryData(keys.loan(loan.id), loan);
      for (const k of loanDataKeys()) void qc.invalidateQueries({ queryKey: k });
      void qc.invalidateQueries({ queryKey: keys.notifications });
    },
  });
}

export const usePay = () =>
  useLoanDetailMutation(({ instalmentId, input }: { instalmentId: string; input: PaymentInput }) =>
    api<LoanDetail>(`/instalments/${encodeURIComponent(instalmentId)}/payment`, { method: "POST", body: input }),
  );
export const useUnpay = () =>
  useLoanDetailMutation((instalmentId: string) =>
    api<LoanDetail>(`/instalments/${encodeURIComponent(instalmentId)}/payment`, { method: "DELETE" }),
  );
export const useSkip = () =>
  useLoanDetailMutation(({ instalmentId, skipped }: { instalmentId: string; skipped: boolean }) =>
    api<LoanDetail>(`/instalments/${encodeURIComponent(instalmentId)}`, { method: "PATCH", body: { skipped } }),
  );
export const useOverride = () =>
  useLoanDetailMutation(({ loanId, n, amount }: { loanId: string; n: number; amount: number | null }) =>
    api<LoanDetail>(`/loans/${loanId}/instalments/${n}/override`, { method: "PUT", body: { amount } }),
  );

export const useDeleteLoan = () => useApiMutation((id: string) => api<void>(`/loans/${id}`, { method: "DELETE" }), () => loanDataKeys());
export const useMuteLoan = () =>
  useApiMutation(
    ({ id, muted }: { id: string; muted: boolean }) => api<{ muted: boolean }>(`/loans/${id}/mute`, { method: "PATCH", body: { muted } }),
    ({ id }) => loanDataKeys(id),
  );

export const useSaveCard = () =>
  useApiMutation(
    ({ id, input }: { id?: string; input: CardInput }) => api<Card>(id ? `/cards/${id}` : "/cards", { method: id ? "PUT" : "POST", body: input }),
    () => [keys.cards, ...loanDataKeys()],
  );
export const useDeleteCard = () => useApiMutation((id: string) => api<void>(`/cards/${id}`, { method: "DELETE" }), () => [keys.cards]);

export const useAddLender = () => useApiMutation((input: LenderInput) => api<Lender>("/lenders", { method: "POST", body: input }), () => [keys.lenders]);
export const useDeleteLender = () => useApiMutation((id: string) => api<void>(`/lenders/${id}`, { method: "DELETE" }), () => [keys.lenders]);

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => api<Settings>("/settings", { method: "PATCH", body: patch }),
    onSuccess: (settings) => {
      qc.setQueryData<Me | null>(keys.me, (me) => (me ? { ...me, settings } : me));
      for (const k of loanDataKeys()) void qc.invalidateQueries({ queryKey: k });
    },
  });
}

export const useMarkAllRead = () => useApiMutation(() => api("/notifications/read-all", { method: "POST" }), () => [keys.notifications]);
