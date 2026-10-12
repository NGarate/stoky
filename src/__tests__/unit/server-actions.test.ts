import { describe, it, expect } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import ts from "typescript";

/**
 * No Server Action carries a value from the server to the browser and back.
 *
 * Two shapes make an action carry one, and both are unsafe here:
 *
 * - An inline `"use server"` function closes over its scope. Next encrypts
 *   the closed-over variables with an AES key that `next build` writes into
 *   `.next/server/server-reference-manifest.json`, which the Dockerfile
 *   copies into the public image. Every installation of a release shares that
 *   key and anybody who pulls the image can read it, so the ciphertext is
 *   neither secret nor tamper-proof.
 * - `.bind()` on an action attaches arguments that React serialises into the
 *   page as they are (`$$bound`), not encrypted at all. A householdId bound
 *   into a form is read and replaced by whoever submits it, key or no key.
 *
 * Today neither exists. The three actions are modules whose first statement
 * is `"use server"`, and their callers pass ordinary arguments, which the
 * action validates like any other request. This holds that shape, so the
 * first action that would carry a value is a decision taken here (SECURITY.md,
 * "Keys `next build` writes into the image") rather than something found by
 * the next audit. A closure would first need `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`
 * set per installation, at runtime; a bound argument would need the action to
 * re-check it as untrusted input.
 *
 * Parsed with the TypeScript compiler rather than searched for, because the
 * phrase is discussed in prose — in this file, in `locales.test.ts` and in
 * comments under `src/` — and a guard that went red on an explanation would be
 * deleted within the week.
 */

const ROOT = join(import.meta.dir, "..", "..", "..");
const SRC = join(ROOT, "src");
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"];

function shippedFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (path.includes("__tests__")) continue;
    if (statSync(path).isDirectory()) shippedFiles(path, found);
    else if (EXTENSIONS.some((ext) => path.endsWith(ext))) found.push(path);
  }
  return found;
}

function parse(path: string, text: string): ts.SourceFile {
  const kind =
    path.endsWith(".tsx") || path.endsWith(".jsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS;
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
}

function isUseServer(node: ts.Node): node is ts.ExpressionStatement {
  return (
    ts.isExpressionStatement(node) &&
    ts.isStringLiteral(node.expression) &&
    node.expression.text === "use server"
  );
}

/** A file whose first statement is the directive: a module of actions. */
function isActionModule(source: ts.SourceFile): boolean {
  const first = source.statements[0];
  return first !== undefined && isUseServer(first);
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/**
 * Every `"use server"` statement that is not a module's first: an inline
 * action inside a function body, which closes over its scope, or a directive
 * written after an import, which Next ignores and a reader does not.
 */
function strayDirectives(source: ts.SourceFile): number[] {
  const lines: number[] = [];
  const visit = (node: ts.Node): void => {
    if (isUseServer(node) && node !== source.statements[0]) {
      lines.push(lineOf(source, node));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return lines;
}

/** Where an import specifier points, if it is a file under `src/`. */
function resolve(from: string, specifier: string): string | undefined {
  let base: string;
  if (specifier.startsWith("@/")) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = join(dirname(from), specifier);
  else return undefined;

  const candidates = [
    base,
    ...EXTENSIONS.map((ext) => base + ext),
    ...EXTENSIONS.map((ext) => join(base, "index" + ext)),
  ];
  return candidates.find((path) => existsSync(path) && statSync(path).isFile());
}

/**
 * The names a file gives the actions it imports — named, renamed, default,
 * and namespace imports, the last tracked separately because the action is
 * then `ns.action`.
 */
function importedActions(
  source: ts.SourceFile,
  isAction: (specifier: string) => boolean,
): { names: Set<string>; namespaces: Set<string> } {
  const names = new Set<string>();
  const namespaces = new Set<string>();

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!isAction(statement.moduleSpecifier.text)) continue;

    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name) names.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) names.add(element.name.text);
    }
  }
  return { names, namespaces };
}

/** Every `.bind(` applied to an action this file imported. */
function boundActions(
  source: ts.SourceFile,
  isAction: (specifier: string) => boolean,
): number[] {
  const { names, namespaces } = importedActions(source, isAction);
  const lines: number[] = [];

  const isImportedAction = (node: ts.Expression): boolean => {
    if (ts.isIdentifier(node)) return names.has(node.text);
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      return namespaces.has(node.expression.text);
    }
    if (ts.isParenthesizedExpression(node)) return isImportedAction(node.expression);
    return false;
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "bind" &&
      isImportedAction(node.expression.expression)
    ) {
      lines.push(lineOf(source, node));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return lines;
}

const files = shippedFiles(SRC).map((path) => ({
  path,
  source: parse(path, readFileSync(path, "utf8")),
}));
const actionModules = new Set(
  files.filter(({ source }) => isActionModule(source)).map(({ path }) => path),
);
const importsAnAction = (from: string) => (specifier: string) => {
  const target = resolve(from, specifier);
  return target !== undefined && actionModules.has(target);
};

describe("Server Actions carry no values of their own", () => {
  it("scans something, so the checks below are not vacuous", () => {
    expect(files.length).toBeGreaterThan(100);
    expect([...actionModules].map((path) => relative(SRC, path)).toSorted()).toEqual(
      expect.arrayContaining([
        "lib/auth/actions.ts",
        "lib/i18n/cookies.ts",
        "lib/landing/choose.ts",
      ]),
    );

    // The bind check only looks where an action is imported; finding none
    // would pass it everywhere.
    const callers = files.filter(({ path, source }) => {
      const { names, namespaces } = importedActions(source, importsAnAction(path));
      return names.size + namespaces.size > 0;
    });
    expect(callers.length).toBeGreaterThanOrEqual(3);
  });

  it("declares every action at the top of its own module", () => {
    const offenders = files.flatMap(({ path, source }) =>
      strayDirectives(source).map((line) => `${relative(SRC, path)}:${line}`),
    );
    expect(offenders).toEqual([]);
  });

  it("binds no argument to an imported action", () => {
    const offenders = files.flatMap(({ path, source }) =>
      boundActions(source, importsAnAction(path)).map(
        (line) => `${relative(SRC, path)}:${line}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});

describe("the checks recognise what they look for", () => {
  // The two walks above are the whole guard, and a walk that matches nothing
  // passes both. Checked against the shapes they must catch and the ones they
  // must not.

  it("finds an inline action, in each way one is written", () => {
    const inline = parse(
      "page.tsx",
      [
        "export default async function Page() {",
        "  const householdId = await current();",
        "  async function save() {",
        '    "use server";',
        "    await write(householdId);",
        "  }",
        "  const remove = async () => {",
        "    'use server';",
        "  };",
        "  return <form action={save} />;",
        "}",
      ].join("\n"),
    );
    expect(strayDirectives(inline)).toEqual([4, 8]);

    const late = parse("late.ts", 'import { x } from "y";\n"use server";\n');
    expect(strayDirectives(late)).toEqual([2]);
  });

  it("accepts a module of actions and the phrase in prose", () => {
    const actionsFile = parse(
      "actions.ts",
      [
        '"use server";',
        "// a comment that says \"use server\";",
        'const label = "use server";',
        "export async function act(): Promise<void> {}",
      ].join("\n"),
    );
    expect(isActionModule(actionsFile)).toBe(true);
    expect(strayDirectives(actionsFile)).toEqual([]);

    const jsx = parse("note.tsx", "export const N = () => <p>use server</p>;\n");
    expect(isActionModule(jsx)).toBe(false);
    expect(strayDirectives(jsx)).toEqual([]);
  });

  it("finds a bound action, however it was imported", () => {
    const fromActions = (specifier: string) => specifier === "@/lib/actions";
    const caller = parse(
      "form.tsx",
      [
        'import { chooseScreen, other as renamed } from "@/lib/actions";',
        'import * as actions from "@/lib/actions";',
        'import act from "@/lib/actions";',
        'import { helper } from "@/lib/helpers";',
        "const a = chooseScreen.bind(null, householdId);",
        "const b = renamed.bind(null, 1);",
        "const c = actions.chooseScreen.bind(null, 2);",
        "const d = act.bind(null, 3);",
        "const e = helper.bind(null, 4);",
        "const f = chooseScreen(householdId);",
      ].join("\n"),
    );
    expect(boundActions(caller, fromActions)).toEqual([5, 6, 7, 8]);
  });
});
