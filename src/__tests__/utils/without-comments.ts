/**
 * Strip comments from TypeScript source before a meta-test scans it, so prose
 * satisfies nothing and trips nothing.
 *
 * Two scans needed this and each had one half of the problem.
 * `tenant-scoped-ids.test.ts` matches bare helper names, which a comment like
 * `// (see assertOwnProduct above)` satisfies as readily as a call — with the
 * regex version in place that file stayed green after the real
 * `assertOwnProduct(...)` call was deleted from `confirmItem`.
 * `replayable.test.ts` matches `withReplay(` call syntax, which a comment
 * *spelling* the call would falsely count as a use, breaking its exact-list
 * assertion in the other direction.
 *
 * The regex version this replaces (`/\/\/.*$/gm`) had a third defect, the
 * reason this is a scanner rather than two regexes: a `//` inside a string
 * literal — an URL in an error message — stripped the rest of that line,
 * swallowing real code from the scan (DEFERRED.md item 9). This walks the
 * source tracking string state, so comment markers inside `'…'`, `"…"` and
 * template literals are left alone, and escaped quotes do not end a string.
 *
 * Known limit, stated rather than solved: a regex literal is not tracked, so
 * an unescaped `//` inside a character class — `/[/]{2}/` — would still open
 * a false comment. No router contains one; a scanner that decides whether `/`
 * begins a regex or a division needs a parser, which is more machinery than
 * two meta-tests justify.
 *
 * Newlines inside stripped comments are kept, so line-anchored patterns and
 * indexes computed on the stripped source still correspond to the original's
 * lines.
 */
export function withoutComments(source: string): string {
  let out = "";
  let i = 0;
  let mode:
    | "code"
    | "line"
    | "block"
    | "single"
    | "double"
    | "template" = "code";

  while (i < source.length) {
    const ch = source[i] as string;
    const next = source[i + 1];

    switch (mode) {
      case "code":
        if (ch === "/" && next === "/") {
          mode = "line";
          i += 2;
        } else if (ch === "/" && next === "*") {
          mode = "block";
          i += 2;
        } else {
          if (ch === "'") mode = "single";
          else if (ch === '"') mode = "double";
          else if (ch === "`") mode = "template";
          out += ch;
          i += 1;
        }
        break;
      case "line":
        if (ch === "\n") {
          mode = "code";
          out += ch;
        }
        i += 1;
        break;
      case "block":
        if (ch === "*" && next === "/") {
          mode = "code";
          i += 2;
        } else {
          if (ch === "\n") out += ch;
          i += 1;
        }
        break;
      case "single":
      case "double":
      case "template": {
        if (ch === "\\") {
          out += ch + (next ?? "");
          i += 2;
          break;
        }
        const closer =
          mode === "single" ? "'" : mode === "double" ? '"' : "`";
        if (ch === closer) mode = "code";
        out += ch;
        i += 1;
        break;
      }
    }
  }

  return out;
}
