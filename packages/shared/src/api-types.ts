import type { InstalmentStatus, LoanProgress, ScheduleSummary } from "@emi/core";
import type { LoanInput, Settings } from "./schemas";

export interface User {
  id: string;
  email: string;
  name: string;
  picture: string | null;
}

export interface Me {
  user: User;
  settings: Settings;
}

export interface Lender {
  id: string;
  name: string;
  country: string;
  color: string;
  initial: string;
  custom: boolean;
}

export interface Card {
  id: string;
  nickname: string;
  lenderId: string | null;
  last4: string | null;
  statementDay: number;
  dueDay: number | null;
  graceDays: number | null;
}

export interface Payment {
  id: string;
  paidDate: string;
  amountPaid: number;
  lateFee: number;
  note: string | null;
}

export interface Instalment {
  id: string;
  loanId: string;
  n: number;
  billedDate: string;
  payableDate: string;
  opening: number;
  interest: number;
  principal: number;
  emi: number;
  interestTax: number;
  fees: number;
  shiftCost: number;
  totalPayable: number;
  closing: number;
  overridden: boolean;
  skipped: boolean;
  status: InstalmentStatus;
  payment: Payment | null;
}

export interface Loan extends LoanInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface LoanListItem extends Loan {
  summary: ScheduleSummary;
  progress: LoanProgress;
  nextInstalment: Instalment | null;
}

export interface LoanDetail extends LoanListItem {
  instalments: Instalment[];
}

export type MoneyByCurrency = Record<string, number>;

export interface UpcomingItem {
  instalmentId: string;
  loanId: string;
  loanNickname: string;
  lenderId: string;
  cardId: string | null;
  currency: string;
  n: number;
  billedDate: string;
  payableDate: string;
  amount: number;
  status: InstalmentStatus;
}

export interface PayByGroup {
  key: string;
  cardId: string | null;
  payableDate: string;
  currency: string;
  total: number;
  items: UpcomingItem[];
}

export interface Dashboard {
  today: string;
  payableThisMonth: MoneyByCurrency;
  next7Days: MoneyByCurrency;
  next30Days: MoneyByCurrency;
  overdue: MoneyByCurrency;
  outstanding: MoneyByCurrency;
  byLender: Record<string, MoneyByCurrency>;
  byType: Record<string, MoneyByCurrency>;
  upcoming: PayByGroup[];
  activeLoans: number;
}

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  loanId: string | null;
  instalmentId: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface ApiError {
  error: string;
  message?: string;
  issues?: { path: (string | number)[]; message: string }[];
}
