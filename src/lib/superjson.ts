import SuperJSON from "superjson";
import { Decimal } from "@prisma/client-runtime-utils";

/**
 * SuperJSON, with Prisma's `Decimal` registered.
 *
 * Quantities and money are `numeric` columns, which Prisma hands back as
 * `Decimal`. Unregistered, SuperJSON sends one as its internal digits
 * (`{ s, e, d }`), so every boundary that serialises — the tRPC links, the
 * offline queue's storage and the persisted read cache — imports this one,
 * not `superjson` itself. The value travels as its decimal string, so what
 * arrives is exactly what was stored.
 */
SuperJSON.registerCustom<Decimal, string>(
  {
    isApplicable: (value): value is Decimal => Decimal.isDecimal(value),
    serialize: (value) => value.toString(),
    deserialize: (value) => new Decimal(value),
  },
  "decimal",
);

export default SuperJSON;
