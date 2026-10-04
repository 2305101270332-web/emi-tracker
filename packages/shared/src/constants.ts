export const LOAN_TYPES = [
  "personal",
  "credit_card_emi",
  "home",
  "vehicle",
  "education",
  "gold",
  "consumer_durable",
  "goal",
  "bnpl",
  "other",
] as const;
export type LoanType = (typeof LOAN_TYPES)[number];

export const TAX_LABELS = ["GST", "VAT", "Sales Tax", "None"] as const;
export type TaxLabel = (typeof TAX_LABELS)[number];

export const INSTALMENT_STATUSES = ["upcoming", "due", "paid", "overdue", "skipped"] as const;

export const DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "DD MMM YYYY"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export interface CountryDefaults {
  code: string;
  name: string;
  currency: string;
  locale: string;
  timeZone: string;
  dateFormat: DateFormat;
  taxLabel: TaxLabel;
  /** Default tax rate in percent applied to interest/fees where applicable. */
  taxRate: number;
}

/** Defaults applied when a user picks a country; every value can be overridden. */
export const COUNTRIES: readonly CountryDefaults[] = [
  { code: "IN", name: "India", currency: "INR", locale: "en-IN", timeZone: "Asia/Kolkata", dateFormat: "DD/MM/YYYY", taxLabel: "GST", taxRate: 18 },
  { code: "US", name: "United States", currency: "USD", locale: "en-US", timeZone: "America/New_York", dateFormat: "MM/DD/YYYY", taxLabel: "None", taxRate: 0 },
  { code: "GB", name: "United Kingdom", currency: "GBP", locale: "en-GB", timeZone: "Europe/London", dateFormat: "DD/MM/YYYY", taxLabel: "None", taxRate: 0 },
  { code: "AE", name: "United Arab Emirates", currency: "AED", locale: "en-AE", timeZone: "Asia/Dubai", dateFormat: "DD/MM/YYYY", taxLabel: "VAT", taxRate: 5 },
  { code: "SG", name: "Singapore", currency: "SGD", locale: "en-SG", timeZone: "Asia/Singapore", dateFormat: "DD/MM/YYYY", taxLabel: "GST", taxRate: 0 },
  { code: "AU", name: "Australia", currency: "AUD", locale: "en-AU", timeZone: "Australia/Sydney", dateFormat: "DD/MM/YYYY", taxLabel: "None", taxRate: 0 },
  { code: "CA", name: "Canada", currency: "CAD", locale: "en-CA", timeZone: "America/Toronto", dateFormat: "YYYY-MM-DD", taxLabel: "None", taxRate: 0 },
  { code: "DE", name: "Germany", currency: "EUR", locale: "de-DE", timeZone: "Europe/Berlin", dateFormat: "DD/MM/YYYY", taxLabel: "None", taxRate: 0 },
  { code: "JP", name: "Japan", currency: "JPY", locale: "ja-JP", timeZone: "Asia/Tokyo", dateFormat: "YYYY-MM-DD", taxLabel: "None", taxRate: 0 },
  { code: "OTHER", name: "Other", currency: "USD", locale: "en-US", timeZone: "UTC", dateFormat: "YYYY-MM-DD", taxLabel: "None", taxRate: 0 },
];

export function countryDefaults(code: string): CountryDefaults {
  return COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[COUNTRIES.length - 1]!;
}

/** Common ISO 4217 codes offered in pickers; any valid 3-letter code is accepted by the API. */
export const COMMON_CURRENCIES = [
  "INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD", "JPY", "CHF", "CNY", "HKD", "SAR", "QAR", "KWD", "BHD", "OMR",
  "MYR", "THB", "IDR", "PHP", "ZAR", "NZD", "BDT", "LKR", "NPR", "PKR", "BRL", "MXN",
] as const;

export interface SeedLender {
  name: string;
  country: string;
  color: string;
}

export const SEED_LENDERS: readonly SeedLender[] = [
  { name: "ICICI Bank", country: "IN", color: "#B02A30" },
  { name: "HDFC Bank", country: "IN", color: "#004C8F" },
  { name: "Axis Bank", country: "IN", color: "#97144D" },
  { name: "State Bank of India", country: "IN", color: "#22409A" },
  { name: "Kotak Mahindra Bank", country: "IN", color: "#ED1C24" },
  { name: "IDFC First Bank", country: "IN", color: "#9C1D26" },
  { name: "Citi", country: "IN", color: "#056DAE" },
  { name: "HSBC", country: "IN", color: "#DB0011" },
  { name: "Standard Chartered", country: "IN", color: "#0473EA" },
  { name: "Bajaj Finserv", country: "IN", color: "#005DAC" },
  { name: "Yes Bank", country: "IN", color: "#00518F" },
  { name: "IndusInd Bank", country: "IN", color: "#8B1D41" },
  { name: "Bank of Baroda", country: "IN", color: "#F26522" },
  { name: "Punjab National Bank", country: "IN", color: "#A6192E" },
  { name: "AU Small Finance Bank", country: "IN", color: "#6D2077" },
  { name: "RBL Bank", country: "IN", color: "#21409A" },
  { name: "Chase", country: "US", color: "#117ACA" },
  { name: "Bank of America", country: "US", color: "#E31837" },
  { name: "Wells Fargo", country: "US", color: "#D71E28" },
  { name: "Citi", country: "US", color: "#056DAE" },
  { name: "Capital One", country: "US", color: "#004977" },
  { name: "American Express", country: "US", color: "#2E77BB" },
  { name: "Affirm", country: "US", color: "#4A4AF4" },
  { name: "Klarna", country: "US", color: "#FFB3C7" },
  { name: "Barclays", country: "GB", color: "#00AEEF" },
  { name: "HSBC", country: "GB", color: "#DB0011" },
  { name: "Lloyds Bank", country: "GB", color: "#006A4D" },
  { name: "NatWest", country: "GB", color: "#5A287D" },
  { name: "Santander", country: "GB", color: "#EC0000" },
  { name: "Emirates NBD", country: "AE", color: "#072B61" },
  { name: "First Abu Dhabi Bank", country: "AE", color: "#00205B" },
  { name: "Mashreq", country: "AE", color: "#F37021" },
  { name: "DBS", country: "SG", color: "#ED1C24" },
  { name: "OCBC", country: "SG", color: "#E2231A" },
  { name: "UOB", country: "SG", color: "#005EB8" },
  { name: "Commonwealth Bank", country: "AU", color: "#FFCC00" },
  { name: "Westpac", country: "AU", color: "#DA1710" },
  { name: "ANZ", country: "AU", color: "#007DBA" },
  { name: "RBC", country: "CA", color: "#005DAA" },
  { name: "TD Bank", country: "CA", color: "#34A853" },
  { name: "Deutsche Bank", country: "DE", color: "#0018A8" },
  { name: "MUFG", country: "JP", color: "#E60012" },
];

/** Upload limits for R2 documents (Phase 2). */
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;

/** Default reminder offsets (days before payable date). */
export const DEFAULT_REMINDER_DAYS = [3, 1] as const;
