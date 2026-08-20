import { PrismaClient, Prisma } from "@prisma/client";
const db = new PrismaClient();

const rows = await db.$queryRaw<any[]>`
  SELECT
    COUNT(*)                       AS "countStar",
    COUNT(*) OVER ()               AS "countWindow",
    SUM(q)                         AS "sumFloat",
    COALESCE(SUM(q), 0)            AS "sumCoalesced",
    SUM(q) FILTER (WHERE false)    AS "sumNoRows",
    (SUM(q) < 2)                   AS "cmp",
    0.1::float8 + 0.2::float8      AS "fp",
    (0.1::float8 + 0.2::float8 = 0.3::float8) AS "fpEq"
  FROM (VALUES (0.1::float8), (0.2::float8)) AS t(q)
`;
for (const [k, v] of Object.entries(rows[0])) {
  console.log(k, "=", v, "| typeof:", typeof v, "| ctor:", v === null ? "null" : (v as any).constructor?.name);
}

// empty set
const empty = await db.$queryRaw<any[]>`
  SELECT COUNT(*) AS c, SUM(q) AS s, COALESCE(SUM(q),0) AS sc
  FROM (SELECT 1::float8 AS q WHERE false) t
`;
console.log("EMPTY:", empty[0], "typeofs:", Object.entries(empty[0]).map(([k,v]) => `${k}:${typeof v}`).join(","));

// what does superjson do
const SuperJSON = (await import("superjson")).default;
console.log("superjson bigint:", SuperJSON.stringify({ total: rows[0].countStar }));
try { console.log("JSON.stringify:", JSON.stringify({ total: rows[0].countStar })); }
catch (e) { console.log("JSON.stringify THREW:", (e as Error).message); }

// LIMIT with a float parameter
try {
  const r = await db.$queryRaw`SELECT 1 AS x LIMIT ${20.5}`;
  console.log("LIMIT float ok:", r);
} catch (e) { console.log("LIMIT float THREW:", (e as Error).message.split("\n").slice(0,4).join(" | ")); }

try {
  const r = await db.$queryRaw`SELECT 1 AS x LIMIT ${20}`;
  console.log("LIMIT int ok:", r);
} catch (e) { console.log("LIMIT int THREW:", (e as Error).message.split("\n").slice(0,4).join(" | ")); }

try {
  const r = await db.$queryRaw`SELECT 1 AS x OFFSET ${-1}`;
  console.log("OFFSET -1 ok:", r);
} catch (e) { console.log("OFFSET -1 THREW:", (e as Error).message.split("\n").slice(0,4).join(" | ")); }

await db.$disconnect();
