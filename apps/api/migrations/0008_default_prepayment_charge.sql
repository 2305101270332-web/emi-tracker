-- Default pre-closure charge: 3% of the amount prepaid plus the owner's tax rate (GST 18% in
-- India). Applied to loans that have no charge yet; the field shipped shortly before this, so
-- "none" here means "never set". New loans get the same default from the loan form.
UPDATE loans
SET prepayment_charge = '{"kind":"percent","percent":3}',
    prepayment_charge_tax_rate = COALESCE((SELECT s.tax_rate FROM settings s WHERE s.user_id = loans.user_id), 18)
WHERE prepayment_charge = '{"kind":"none"}';
