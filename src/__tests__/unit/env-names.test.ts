import { describe, expect, it } from "bun:test";
import { RENAMED, SECRET_VARIABLE, readRenamed, renamedVariableWarnings } from "@/lib/env-names";

/**
 * The `STOKY_` rename and the old names it keeps reading (PROGRESS D137).
 *
 * An installation from before the rename has `NEXTAUTH_SECRET` in its `.env`.
 * It must go on signing with that value — a new one signs everybody out and
 * changes every account tag in the security log — while being told, once, to
 * rename the line.
 */

const KEPT = "kept-as-written-0123456789abcdef0123";
const OTHER = "a-different-value-0123456789abcdef01";

describe("readRenamed", () => {
  it("reads the legacy name when it is the only one set", () => {
    expect(readRenamed({ NEXTAUTH_SECRET: KEPT }, SECRET_VARIABLE)).toEqual({
      value: KEPT,
      name: "NEXTAUTH_SECRET",
      from: "legacy",
    });
  });

  it("prefers the new name when both are set", () => {
    expect(
      readRenamed({ STOKY_SECRET: KEPT, NEXTAUTH_SECRET: OTHER }, SECRET_VARIABLE),
    ).toEqual({ value: KEPT, name: "STOKY_SECRET", from: "current" });
  });

  it("treats an empty new name as unset, the way Compose passes ${STOKY_SECRET:-}", () => {
    for (const empty of ["", "   "]) {
      expect(
        readRenamed({ STOKY_SECRET: empty, NEXTAUTH_SECRET: KEPT }, SECRET_VARIABLE).value,
      ).toBe(KEPT);
    }
  });

  it("names the new variable when neither is set, which is the one to set", () => {
    expect(readRenamed({ NEXTAUTH_SECRET: "" }, SECRET_VARIABLE)).toEqual({
      value: undefined,
      name: "STOKY_SECRET",
      from: null,
    });
  });

  it("returns the value as written, so the account tag keyed with it does not move", () => {
    expect(readRenamed({ STOKY_SECRET: ` ${KEPT} ` }, SECRET_VARIABLE).value).toBe(` ${KEPT} `);
  });
});

describe("renamedVariableWarnings", () => {
  it("names both variables and no value when only the legacy name is set", () => {
    const warnings = renamedVariableWarnings({ NEXTAUTH_SECRET: KEPT });
    expect(warnings).toEqual([
      "[config] NEXTAUTH_SECRET is deprecated; rename it to STOKY_SECRET. It is still read for now.",
    ]);
    expect(warnings.join("\n")).not.toContain(KEPT);
  });

  it("says the legacy name is ignored when both are set", () => {
    const warnings = renamedVariableWarnings({ STOKY_SECRET: KEPT, NEXTAUTH_SECRET: OTHER });
    expect(warnings).toEqual([
      "[config] STOKY_SECRET and NEXTAUTH_SECRET are both set; STOKY_SECRET is used and NEXTAUTH_SECRET is ignored. Remove it.",
    ]);
    expect(warnings.join("\n")).not.toContain(KEPT);
    expect(warnings.join("\n")).not.toContain(OTHER);
  });

  it("says nothing when only the new name is set, or the legacy one is empty", () => {
    expect(renamedVariableWarnings({ STOKY_SECRET: KEPT })).toEqual([]);
    expect(renamedVariableWarnings({ STOKY_SECRET: KEPT, NEXTAUTH_SECRET: "" })).toEqual([]);
    expect(renamedVariableWarnings({})).toEqual([]);
  });

  it("keeps every new name clear of the prefixes libraries read on their own", () => {
    for (const { current } of RENAMED) {
      expect(current).toMatch(/^STOKY_/);
      expect(current).not.toMatch(/^(AUTH_|BETTER_AUTH_|NEXTAUTH_)/);
    }
  });
});
