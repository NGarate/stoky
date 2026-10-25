/**
 * Internal link checker.
 *
 * Run: bun scripts/check-links.ts [--verbose]
 *
 * Compares every internal navigation target in the source against the App
 * Router's actual route tree, and fails on any link pointing at a route that
 * does not exist.
 *
 * This exists because the manual version of the check failed three times in a
 * row. It missed `/products/[id]`, linked from every row of two tables and both
 * success paths of the scanner; `/settings`, linked from the navigation of every
 * dashboard page; and `/receipts/[id]/applied`, the final step of the receipt
 * pipeline. Each was missed for the same reason: the audit compared `href="/…"`
 * string literals, and those call sites use template literals.
 *
 * So the rule here is that a target counts however it is written — string
 * literal, template literal, or a router call — and dynamic segments are
 * normalised on both sides before comparison.
 */
import { readFileSync } from "node:fs";
import { Glob } from "bun";

const APP_DIR = "src/app";
const SOURCE_GLOBS = ["src/**/*.tsx", "src/**/*.ts"];

/** Route groups like `(dashboard)` are organisational and not part of the URL. */
function routeFromFile(file: string): string {
  return (
    file
      .replace(`${APP_DIR}`, "")
      .replace(/\/page\.tsx$/, "")
      .replace(/\/\([^)]+\)/g, "") || "/"
  );
}

/** Collapse `[id]` and `${expr}` to one placeholder so both sides compare alike. */
function normalise(path: string): string {
  const withoutQuery = path.split("?")[0].split("#")[0];
  const trimmed = withoutQuery.replace(/\/+$/, "") || "/";
  return trimmed.replace(/\$\{[^}]*\}/g, "[·]").replace(/\[[^\]]+\]/g, "[·]");
}

interface Link {
  target: string;
  file: string;
  line: number;
}

function collectLinks(): Link[] {
  const links: Link[] = [];
  const patterns = [
    // href={`/products/${id}`}
    /href=\{`([^`]+)`\}/g,
    // href="/products"
    /href="(\/[^"]*)"/g,
    // router.push(`/receipts/${id}/applied`) and router.replace("/login")
    /router\.(?:push|replace)\(\s*`([^`]+)`/g,
    /router\.(?:push|replace)\(\s*"(\/[^"]*)"/g,
    // redirect("/login")
    /redirect\(\s*"(\/[^"]*)"/g,
  ];

  for (const pattern of SOURCE_GLOBS) {
    for (const file of new Glob(pattern).scanSync(".")) {
      const source = readFileSync(file, "utf8");
      const lines = source.split("\n");
      for (const regex of patterns) {
        regex.lastIndex = 0;
        let match: RegExpExecArray | null = regex.exec(source);
        while (match !== null) {
          const target = match[1];
          if (target.startsWith("/") && !target.startsWith("//")) {
            const line = source.slice(0, match.index).split("\n").length;
            links.push({ target, file, line });
          }
          match = regex.exec(source);
        }
      }
      void lines;
    }
  }
  return links;
}

const routes = new Set<string>();
for (const file of new Glob(`${APP_DIR}/**/page.tsx`).scanSync(".")) {
  routes.add(normalise(routeFromFile(file)));
}

// API handlers are real destinations too, even though they render nothing.
for (const file of new Glob(`${APP_DIR}/**/route.ts`).scanSync(".")) {
  routes.add(normalise(routeFromFile(file).replace(/\/route\.ts$/, "")));
}

const links = collectLinks();
const verbose = process.argv.includes("--verbose");
const broken = links.filter((l) => !routes.has(normalise(l.target)));

if (verbose) {
  console.log("Routes:");
  for (const r of [...routes].sort()) console.log(`  ${r}`);
  console.log("\nLinks:");
  for (const l of links.sort((a, b) => a.target.localeCompare(b.target))) {
    console.log(
      `  ${routes.has(normalise(l.target)) ? "ok  " : "DEAD"} ${l.target}`,
    );
  }
  console.log();
}

console.log(
  `${links.length} internal links checked against ${routes.size} routes.`,
);

if (broken.length === 0) {
  console.log("No links point at a route that does not exist.");
  process.exit(0);
}

console.error(`\n${broken.length} broken link(s):\n`);
for (const l of broken) {
  console.error(`  ${l.target}`);
  console.error(
    `    ${l.file}:${l.line} — no route matches ${normalise(l.target)}`,
  );
}
console.error(
  "\nEither create the route, or point the link somewhere that exists.",
);
process.exit(1);
