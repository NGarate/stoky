import { describe, it, expect } from "bun:test";
import { withoutComments } from "../utils/without-comments";

/**
 * The comment stripper two meta-tests scan through. Its own docblock carries
 * the rationale; what is pinned here is the defect that made it a scanner
 * rather than a pair of regexes (DEFERRED.md items 9 and 10), and the
 * behaviors the scans depend on.
 */
describe("withoutComments", () => {
  it("strips a line comment", () => {
    expect(withoutComments("a; // gone\nb;")).toBe("a; \nb;");
  });

  it("strips a block comment but keeps its newlines", () => {
    expect(withoutComments("a;/* one\ntwo */b;")).toBe("a;\nb;");
  });

  it("does not treat // inside a string as a comment", () => {
    // The regex version stripped from the // to the end of the line,
    // swallowing guard(x) from the scan — the exact shape of item 9.
    const source = 'throw new Error("see https://example.com"); guard(x);';
    expect(withoutComments(source)).toBe(source);
  });

  it("does not treat /* inside a string or template as a comment", () => {
    const single = "const glob = 'src/*'; guard(x);";
    const template = "const t = `a // b /* c */ d`; guard(x);";
    expect(withoutComments(single)).toBe(single);
    expect(withoutComments(template)).toBe(template);
  });

  it("an escaped quote does not end the string", () => {
    const source = 'const s = "a \\" // still inside"; guard(x);';
    expect(withoutComments(source)).toBe(source);
  });

  it("a quote inside a comment does not open a string", () => {
    expect(withoutComments('// it\'s fine\nguard("x");')).toBe(
      '\nguard("x");',
    );
  });

  it("a // inside a block comment does not outlive the block", () => {
    expect(withoutComments("/* a // b */ guard(x);")).toBe(" guard(x);");
  });

  it("a name spelled in a comment cannot satisfy a scan", () => {
    // Both directions the meta-tests care about: a bare name and full call
    // syntax, each present only in comments, each absent after stripping.
    const source = [
      "// calls assertOwnProduct(id, hh)",
      "/* withReplay(ctx, { ... }) */",
      "real();",
    ].join("\n");
    const stripped = withoutComments(source);
    expect(stripped).not.toContain("assertOwnProduct");
    expect(stripped).not.toContain("withReplay(");
    expect(stripped).toContain("real();");
  });
});
