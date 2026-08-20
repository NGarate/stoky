import { PrismaClient } from "@prisma/client";
import SuperJSON from "superjson";
const db = new PrismaClient();

const r = await db.$queryRaw<any[]>`SELECT round(SUM(q)::numeric, 2) AS r FROM (VALUES (0.1::float8),(0.2::float8)) t(q)`;
const dec = r[0].r;
console.log("Decimal value:", String(dec), "| typeof", typeof dec, "| isDecimal-ish", dec?.constructor?.name, "| keys", Object.keys(dec));
console.log("superjson:", SuperJSON.stringify({ totalStock: dec }));
console.log("JSON:", JSON.stringify({ totalStock: dec }));
console.log("dec < 2 ?", dec < 2, "| dec + 1 =", (dec as any) + 1, "| typeof that:", typeof ((dec as any)+1));

await db.$executeRawUnsafe(`CREATE TEMP TABLE p(id int)`);
await db.$executeRawUnsafe(`CREATE TEMP TABLE se(pid int, q float8)`);
await db.$executeRawUnsafe(`CREATE TEMP TABLE si(pid int, q float8)`);
await db.$executeRawUnsafe(`INSERT INTO p VALUES (1)`);
await db.$executeRawUnsafe(`INSERT INTO se VALUES (1, 2), (1, 3)`);
await db.$executeRawUnsafe(`INSERT INTO si VALUES (1, 5), (1, 7)`);
const fan = await db.$queryRaw<any[]>`
  SELECT p.id, SUM(se.q) AS stock, SUM(si.q) AS onlist, COUNT(*) AS nrows
  FROM p LEFT JOIN se ON se.pid = p.id LEFT JOIN si ON si.pid = p.id
  GROUP BY p.id`;
console.log("FAN-OUT (truth: stock 5, onlist 12):", fan[0]);
const ok = await db.$queryRaw<any[]>`
  SELECT p.id,
    COALESCE((SELECT SUM(q) FROM se WHERE se.pid = p.id), 0) AS stock,
    COALESCE((SELECT SUM(q) FROM si WHERE si.pid = p.id), 0) AS onlist
  FROM p`;
console.log("SUBQUERY (correct):", ok[0]);
await db.$disconnect();
