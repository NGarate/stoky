import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

// association order changes the float sum
const a = await db.$queryRaw<any[]>`SELECT SUM(q) AS s FROM (VALUES (0.1::float8),(0.2::float8),(0.3::float8)) t(q)`;
const b = await db.$queryRaw<any[]>`SELECT SUM(q) AS s FROM (VALUES (0.3::float8),(0.2::float8),(0.1::float8)) t(q)`;
console.log("sum asc:", a[0].s, " sum desc:", b[0].s, " equal?", a[0].s === b[0].s);

// bought 0.1 + 0.2, consumed 0.3 -> should be exactly zero
const z = await db.$queryRaw<any[]>`
  SELECT SUM(q) AS s, (SUM(q) <= 0) AS "isOut", (round(SUM(q)::numeric, 2) <= 0) AS "isOutRounded"
  FROM (VALUES (0.1::float8),(0.2::float8),(-0.3::float8)) t(q)`;
console.log("net-zero case:", z[0]);
console.log("JS reduce:", [0.1,0.2,-0.3].reduce((s,x)=>s+x,0));

// round returns numeric -> what type does Prisma give back?
const r = await db.$queryRaw<any[]>`SELECT round(SUM(q)::numeric, 2) AS r FROM (VALUES (0.1::float8),(0.2::float8)) t(q)`;
console.log("round(numeric):", r[0].r, typeof r[0].r, r[0].r?.constructor?.name);

// fan-out demo: two LEFT JOINs multiply
await db.$executeRawUnsafe(`CREATE TEMP TABLE p(id int); CREATE TEMP TABLE se(pid int, q float8); CREATE TEMP TABLE si(pid int, q float8);`);
await db.$executeRawUnsafe(`INSERT INTO p VALUES (1); INSERT INTO se VALUES (1, 2), (1, 3); INSERT INTO si VALUES (1, 5), (1, 7);`);
const fan = await db.$queryRaw<any[]>`
  SELECT p.id, SUM(se.q) AS stock, SUM(si.q) AS onlist, COUNT(*) AS rows
  FROM p LEFT JOIN se ON se.pid = p.id LEFT JOIN si ON si.pid = p.id
  GROUP BY p.id`;
console.log("FAN-OUT (truth: stock 5, onlist 12):", fan[0]);

await db.$disconnect();
