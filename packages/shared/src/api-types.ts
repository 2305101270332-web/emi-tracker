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
  /** Which optional channels the server has configured (email needs Resend; push needs VAPID keys). */
  features: { email: boolean; push: boolean };
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
  /** Annual rate applied to this instalment (changes with floating-rate changes). */
  annualRate: number;
  status: InstalmentStatus;
  payment: Payment | null;
}

export interface Loan extends LoanInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

/** The viewer's role on a loan: owner, or a shared user with edit/view access. */
export type LoanAccess = "owner" | "edit" | "view";

export interface LenderSnapshot {
  name: string;
  color: string;
  initial: string;
}

export interface LoanListItem extends Loan {
  summary: ScheduleSummary;
  progress: LoanProgress;
  nextInstalment: Instalment | null;
  access: LoanAccess;
  /** Lender name/colour so shared users can see it without access to the owner's custom lenders. */
  lender: LenderSnapshot | null;
  /** Owner's display name; set only for loans shared with the viewer. */
  ownerName: string | null;
}

export interface LoanShare {
  id: string;
  email: string;
  access: "view" | "edit";
  /** pending = invited email has not signed in yet. */
  status: "pending" | "active";
  name: string | null;
  createdAt: string;
}

export interface RateChangeRecord {
  id: string;
  effectiveDate: string;
  annualRate: number;
  mode: "keep_emi" | "keep_tenure";
}

export interface LoanDocument {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
}

export interface LoanDetail extends LoanListItem {
  instalments: Instalment[];
  rateChanges: RateChangeRecord[];
  /** Owner only; empty for shared users. */
  documents: LoanDocument[];
  /** Owner only; empty for shared users. */
  shares: LoanShare[];
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
  /** Debt-to-income in the income currency; null when no income is set. */
  dti: {
    currency: string;
    income: number;
    obligations: number;
    ratio: number;
    band: "healthy" | "caution" | "high";
    /** Active loans in other currencies, not counted. */
    excludedLoans: number;
  } | null;
  /** Projected outstanding principal at each month end, per currency (own loans, schedule assumed paid). */
  balanceTrend: Record<string, { date: string; outstanding: number }[]>;
}

export interface DeletionImpact {
  ownedLoans: number;
  /** Owned loans that are shared with someone (their access will be revoked). */
  ownedSharedLoans: number;
  shareRecipients: number;
  /** Loans other people shared with this user (the user is removed from them). */
  sharedWithMe: number;
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
