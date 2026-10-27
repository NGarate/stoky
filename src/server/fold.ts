import { Prisma } from "@/generated/prisma/client";

/**
 * Accent folding, in the only language the database speaks.
 *
 * `datcollate` on the shipped image is en_US.utf8 on musl, which collates by
 * byte: `ORDER BY lower(name)` files "Ávila" and "Ñoquis" *after* "Zumo".
 * Measured against the dev database. `COLLATE "es-x-icu"` fixes it and exists
 * on that image, but a self-hosted Postgres built without ICU would fail the
 * query outright. So the fold is done with `translate`, which depends on
 * nothing; `unaccent` is an extension the migrations do not install.
 *
 * One list for every query that folds — the inventory's search and sort, and
 * the receipt matcher's comparison — because they have to agree about which
 * letters are the same letter. There were two, and only one knew "ã" and "õ":
 * "Pão" was found by the search and matched worse on a receipt. The cost of
 * folding "ñ" onto "n" is that the RAE's ordering is lost on ties, and a
 * trigram index cannot serve a folded predicate.
 */
const ACCENTED = "áàäâãéèëêíìïîóòöôõúùüûñç";
const UNACCENTED = "aaaaaeeeeiiiiooooouuuunc";

/** `value`, lower-cased and accent-folded. */
export const folded = (value: Prisma.Sql): Prisma.Sql =>
  Prisma.sql`translate(lower(${value}), ${ACCENTED}, ${UNACCENTED})`;
