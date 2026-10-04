import type { LoanDetail } from "@emi/shared";
import { formatDate, type Settings } from "@emi/shared";
import i18n from "./i18n";
import { downloadBlob, slug } from "./download";

/**
 * Schedule PDF, generated in the browser (works offline). jsPDF is loaded on demand.
 * Amounts use the ISO code ("INR 1,23,456.00") because PDF base fonts lack some
 * currency symbols (₹, ₩ …); grouping still follows the user's locale.
 */
export async function exportSchedulePdf(loan: LoanDetail, settings: Pick<Settings, "locale" | "dateFormat">, lenderName: string) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const t = i18n.t.bind(i18n);
  const nf = new Intl.NumberFormat(settings.locale, { style: "currency", currency: loan.currency, currencyDisplay: "code" });
  const digits = nf.resolvedOptions().maximumFractionDigits ?? 2;
  const m = (v: number) => nf.format(v / 10 ** digits).replace(/ /g, " ");
  const d = (iso: string) => formatDate(iso, settings.dateFormat, settings.locale);
  const s = loan.summary;
  const taxName = loan.taxLabel === "None" ? t("schedule.tax") : loan.taxLabel;

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  doc.setFillColor(2, 62, 138);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 56, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text(t("exporting.pdfTitle", { loan: loan.nickname }), 40, 35);
  doc.setTextColor(11, 27, 43);
  doc.setFontSize(10);
  const lines = [
    `${lenderName} · ${loan.annualRate}% · ${t("common.months", { count: loan.tenureMonths })} · ${loan.repaymentType === "flat" ? t("form.flat") : t("form.reducing")}`,
    `${t("schedule.emi")}: ${m(s.emi)}   ${t("schedule.totalInterest")}: ${m(s.totalInterest)}   ${t("schedule.totalCost")}: ${m(s.totalCostOfBorrowing)}` +
      (s.effectiveAnnualRate !== null ? `   ${t("schedule.effectiveRate")}: ${s.effectiveAnnualRate.toFixed(2)}%` : ""),
    t("exporting.generated", { date: d(new Date().toISOString().slice(0, 10)) }),
  ];
  lines.forEach((l, i) => doc.text(l, 40, 76 + i * 14));

  autoTable(doc, {
    startY: 76 + lines.length * 14 + 6,
    head: [[t("schedule.n"), t("schedule.billed"), t("schedule.payable"), t("schedule.opening"), t("schedule.interest"), t("schedule.principal"), taxName, t("schedule.fees"), t("schedule.total"), t("schedule.closing"), t("schedule.status")]],
    body: loan.instalments.map((i) => [
      i.n,
      d(i.billedDate),
      d(i.payableDate),
      m(i.opening),
      m(i.interest),
      m(i.principal),
      m(i.interestTax),
      m(i.fees + i.shiftCost),
      m(i.totalPayable),
      m(i.closing),
      t(`schedule.statuses.${i.status}`),
    ]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [0, 119, 182], textColor: 255 },
    alternateRowStyles: { fillColor: [234, 244, 250] },
    columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" }, 8: { halign: "right" }, 9: { halign: "right" } },
    margin: { left: 40, right: 40 },
  });
  downloadBlob(`${slug(loan.nickname)}-schedule.pdf`, doc.output("arraybuffer"), "application/pdf");
}
