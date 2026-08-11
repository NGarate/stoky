import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_LOCALE,
  LOCALES,
  isSupportedLocale,
  resolveLocale,
} from "@/lib/i18n/locales";

/**
 * The last thing between an attacker-chosen string and a module path.
 *
 * `setLocaleCookie` is a `"use server"` action, which is a public HTTP
 * endpoint, and it is unauthenticated on purpose — switching language should
 * not need an account. Its argument was a bare `string`, written straight into
 * a cookie that `src/i18n/request.ts` interpolates into a dynamic `import()`.
 *
 * Found by `react-doctor`'s `server-auth-actions` rule on its first run over
 * this project, which is most of the argument for making it a gate.
 */

describe("isSupportedLocale", () => {
  it("accepts the languages this application ships", () => {
    for (const locale of LOCALES) {
      expect(isSupportedLocale(locale)).toBe(true);
    }
  });

  it("refuses anything that could steer a module path", () => {
    for (const attempt of [
      "../package",
      "../../package.json",
      "es/../../../etc/passwd",
      "..%2F..%2Fpackage",
      "es.json",
      "ES",
      "",
      " es",
    ]) {
      expect(isSupportedLocale(attempt), attempt).toBe(false);
    }
  });

  it("refuses anything that is not a string", () => {
    for (const attempt of [null, undefined, 7, {}, [], true]) {
      expect(isSupportedLocale(attempt)).toBe(false);
    }
  });
});

describe("resolveLocale", () => {
  it("keeps a language we ship", () => {
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("es")).toBe("es");
  });

  it("falls back rather than throwing, so a bad cookie is not a 500", () => {
    // The failure mode this prevents is not only traversal. An unknown locale
    // reaching the dynamic import is a module-not-found on every request until
    // the person clears their cookie.
    expect(resolveLocale("../package")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE);
  });

  it("falls back to Spanish, which the plan calls primary and not a fallback", () => {
    expect(DEFAULT_LOCALE).toBe("es");
  });
});

describe("the list and the catalogues agree", () => {
  it("ships a catalogue for every locale, and no locale without one", () => {
    const messages = join(import.meta.dir, "../../../messages");

    for (const locale of LOCALES) {
      // Throws if the file is missing, which is the whole assertion: a locale
      // in this list with no catalogue is a guaranteed module-not-found.
      const catalogue = JSON.parse(
        readFileSync(join(messages, `${locale}.json`), "utf8"),
      ) as Record<string, unknown>;
      expect(Object.keys(catalogue).length).toBeGreaterThan(0);
    }
  });
});

describe("the switcher offers exactly what is supported", () => {
  it("has an option for each locale and no others", () => {
    const source = readFileSync(
      join(import.meta.dir, "../../components/ui/LocaleSwitcher.tsx"),
      "utf8",
    );
    const offered = [...source.matchAll(/<option value="([a-z-]+)"/g)].map(
      (match) => match[1] as string,
    );

    // Three copies of this fact used to exist and none was checked against the
    // others: the switcher's options, the request config's default, and the
    // action's parameter type.
    expect(offered.sort()).toEqual([...LOCALES].sort());
  });
});
