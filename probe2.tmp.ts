import { PrismaClient, Prisma } from "@prisma/client";
const db = new PrismaClient();

try { await db.$queryRaw`SELECT 1 AS x OFFSET ${-1}`; }
catch (e) { console.log("OFFSET -1 FULL:\n", (e as Error).message); }

// NULL semantics in SQL vs TS
const n = await db.$queryRaw<any[]>`
  SELECT
    (NULL::float8 < 2)          AS "nullLtTwo",
    (NULL::float8 <= 0)         AS "nullLeZero",
    (NULL::float8 IS NOT DISTINCT FROM NULL) AS "isnd",
    CASE WHEN (NULL::float8 < 2) THEN 'kept' ELSE 'dropped' END AS "caseResult"
`;
console.log("NULL semantics:", n[0]);

// LIMIT rounding with a float
for (const lim of [2.4, 2.5, 2.6, 0.4]) {
  const r = await db.$queryRaw<any[]>`SELECT * FROM (VALUES (1),(2),(3),(4),(5)) v(x) LIMIT ${lim}`;
  console.log(`LIMIT ${lim} ->`, r.length, "rows");
}

// bigint arithmetic
const c = (await db.$queryRaw<any[]>`SELECT COUNT(*) AS total FROM (VALUES (1),(2),(3)) v(x)`)[0].total;
try { console.log("pages:", Math.ceil(c / 20)); } catch (e) { console.log("Math.ceil(bigint/num) THREW:", (e as Error).message); }
try { console.log("c + 1 =", (c as any) + 1); } catch (e) { console.log("bigint + number THREW:", (e as Error).message); }
console.log("c > 0 ?", c > 0, "| c === 3 ?", (c as any) === 3, "| c == 3 ?", (c as any) == 3);

await db.$disconnect();
