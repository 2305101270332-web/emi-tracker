// Regenerates migrations/0002_seed_lenders.sql from @emi/shared SEED_LENDERS.
// Run: npx tsx scripts/gen-lender-seed.ts  (only needed when the list changes; add a new migration then)
import { SEED_LENDERS } from "@emi/shared";
const esc = (s: string) => s.replace(/'/g, "''");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const rows = SEED_LENDERS.map(
  (l) => `('seed-${l.country.toLowerCase()}-${slug(l.name)}', NULL, '${esc(l.name)}', '${l.country}', '${l.color}', '${esc(l.name[0]!.toUpperCase())}')`,
);
console.log(`-- Seeded lenders (generated from packages/shared/src/constants.ts)\nINSERT INTO lenders (id, user_id, name, country, color, initial) VALUES\n${rows.join(",\n")};`);
