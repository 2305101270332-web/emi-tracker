import { addDays, addMonthsClamped, todayInZone } from "@emi/core";
import { loanInputSchema, type LoanInput, type LoanInputRaw } from "@emi/shared";
import { newId } from "../lib/util";
import { regenerateSchedule } from "./loans";
import { cardFromRow, loanColumns } from "./repo";

/** Sample data for demos: a few Indian loans, a card with two card EMIs, and a USD loan. */
export async function seedDemo(db: D1Database, userId: string): Promise<number> {
  const existing = await db.prepare("SELECT COUNT(*) AS c FROM loans WHERE user_id = ?").bind(userId).first<{ c: number }>();
  if ((existing?.c ?? 0) > 0) return 0;

  const today = todayInZone("Asia/Kolkata");
  const monthsAgo = (m: number, day: number) => addMonthsClamped(today, -m, day);

  const cardId = newId();
  await db
    .prepare("INSERT INTO cards (id, user_id, lender_id, nickname, last4, statement_day, due_day, grace_days) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)")
    .bind(cardId, userId, "seed-in-hdfc-bank", "HDFC Regalia", "4321", 12, 2)
    .run();
  const card = cardFromRow((await db.prepare("SELECT * FROM cards WHERE id = ?").bind(cardId).first())!);

  const samples: LoanInputRaw[] = [
    {
      lenderId: "seed-in-hdfc-bank", cardId, type: "credit_card_emi", nickname: "iPhone 16 (no-cost)", currency: "INR",
      principal: 79_900_00, annualRate: 15, tenureMonths: 6, repaymentType: "reducing",
      bookingDate: monthsAgo(2, 3), firstEmiDate: monthsAgo(1, 12), emiDay: 12,
      processingFee: { kind: "flat", amount: 199_00 }, processingFeeTaxRate: 18, feeCollection: "first_instalment",
      taxLabel: "GST", interestTaxEnabled: true, interestTaxRate: 18, noCostEmi: true,
    },
    {
      lenderId: "seed-in-hdfc-bank", cardId, type: "credit_card_emi", nickname: "Laptop EMI", currency: "INR",
      principal: 1_20_000_00, annualRate: 16, tenureMonths: 12, repaymentType: "reducing",
      bookingDate: monthsAgo(1, 5), firstEmiDate: addMonthsClamped(monthsAgo(1, 5), 1, 12), emiDay: 12,
      taxLabel: "GST", interestTaxEnabled: true, interestTaxRate: 18,
      emiShift: { enabled: true, dayCount: 365, collection: "first_instalment" },
    },
    {
      lenderId: "seed-in-icici-bank", type: "personal", nickname: "Wedding loan", currency: "INR",
      principal: 5_00_000_00, annualRate: 11.25, tenureMonths: 36, repaymentType: "reducing",
      bookingDate: monthsAgo(5, 1), firstEmiDate: monthsAgo(4, 5), emiDay: 5,
      processingFee: { kind: "percent", percent: 1.5 }, processingFeeTaxRate: 18, taxLabel: "GST",
      holidayRule: "next_working_day",
    },
    {
      lenderId: "seed-in-state-bank-of-india", type: "home", nickname: "Home loan", currency: "INR",
      principal: 45_00_000_00, annualRate: 8.5, tenureMonths: 240, repaymentType: "reducing",
      bookingDate: monthsAgo(14, 10), firstEmiDate: monthsAgo(13, 10), emiDay: 10,
      processingFee: { kind: "flat", amount: 10_000_00 }, processingFeeTaxRate: 18, taxLabel: "GST",
    },
    {
      lenderId: "seed-in-axis-bank", type: "vehicle", nickname: "Car loan (flat)", currency: "INR",
      principal: 6_00_000_00, annualRate: 7, tenureMonths: 48, repaymentType: "flat",
      bookingDate: monthsAgo(3, 15), firstEmiDate: monthsAgo(2, 15), emiDay: 15,
    },
    {
      lenderId: "seed-us-affirm", type: "bnpl", nickname: "Sofa (Affirm)", currency: "USD",
      principal: 1_499_00, annualRate: 0, tenureMonths: 4, repaymentType: "reducing",
      bookingDate: addDays(today, -20), firstEmiDate: addDays(today, 10), emiDay: Number(addDays(today, 10).slice(8)),
    },
  ];

  let created = 0;
  for (const raw of samples) {
    const input: LoanInput = loanInputSchema.parse(raw);
    const id = newId();
    const cols = loanColumns(input);
    await db
      .prepare(`INSERT INTO loans (id, user_id, ${Object.keys(cols).join(", ")}) VALUES (?, ?, ${Object.keys(cols).map(() => "?").join(", ")})`)
      .bind(id, userId, ...Object.values(cols))
      .run();
    await regenerateSchedule(db, userId, id, input, input.cardId ? card : null);

    // Mark past instalments as paid (except leave one overdue on the personal loan).
    await db
      .prepare(
        `INSERT INTO payments (id, user_id, loan_id, instalment_id, paid_date, amount_paid)
         SELECT lower(hex(randomblob(16))), user_id, loan_id, id, payable_date, total_payable FROM instalments
         WHERE loan_id = ? AND user_id = ? AND payable_date < ? AND NOT (? = 'personal' AND n = (SELECT MAX(n) FROM instalments WHERE loan_id = ? AND payable_date < ?))`,
      )
      .bind(id, userId, today, input.type, id, today)
      .run();
    created++;
  }
  return created;
}
