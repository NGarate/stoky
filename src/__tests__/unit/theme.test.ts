import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_THEME_MODE,
  isThemeMode,
  THEME_MODES,
  THEME_NO_FLASH_SCRIPT,
  THEME_STORAGE_KEY,
} from "@/lib/theme";

const GLOBALS_CSS = readFileSync(
  join(import.meta.dir, "..", "..", "app", "globals.css"),
  "utf8",
);

describe("theme modes", () => {
  it("offers three states, with system as the default", () => {
    expect(THEME_MODES).toEqual(["system", "light", "dark"]);
    expect(DEFAULT_THEME_MODE).toBe("system");
  });

  it("rejects anything that is not a mode", () => {
    expect(isThemeMode("dark")).toBe(true);
    expect(isThemeMode("auto")).toBe(false);
    expect(isThemeMode(null)).toBe(false);
    expect(isThemeMode(undefined)).toBe(false);
    expect(isThemeMode(1)).toBe(false);
  });
});

describe("pre-paint script", () => {
  it("reads the same storage key the control writes", () => {
    expect(THEME_NO_FLASH_SCRIPT).toContain(JSON.stringify(THEME_STORAGE_KEY));
  });

  it("writes only the two attribute values globals.css declares", () => {
    // If the script ever set data-theme="system", the light theme would be
    // pinned on: globals.css only recognises "light" and "dark".
    expect(GLOBALS_CSS).toContain(':root[data-theme="dark"]');
    expect(GLOBALS_CSS).toContain(':root[data-theme="light"]');
    expect(GLOBALS_CSS).toContain(':root:not([data-theme="light"])');
    expect(THEME_NO_FLASH_SCRIPT).toContain('m === "light" || m === "dark"');
    expect(THEME_NO_FLASH_SCRIPT).not.toContain('"system"');
  });

  it("cannot break the page it is inlined into", () => {
    // It runs before any bundle, in the <head>, with no error boundary above
    // it, so a throw would leave the document unstyled and unhydrated.
    expect(THEME_NO_FLASH_SCRIPT).toContain("try {");
    expect(THEME_NO_FLASH_SCRIPT).toContain("catch (e) {}");
    // Nothing that could close the tag it lives in.
    expect(THEME_NO_FLASH_SCRIPT).not.toContain("</");
  });

  it("actually applies a stored theme when executed", () => {
    const stored: Record<string, string> = { [THEME_STORAGE_KEY]: "dark" };
    const attributes: Record<string, string> = {};
    const sandbox = {
      localStorage: { getItem: (k: string) => stored[k] ?? null },
      document: {
        documentElement: {
          setAttribute(name: string, value: string) {
            attributes[name] = value;
          },
        },
      },
    };

    new Function("localStorage", "document", THEME_NO_FLASH_SCRIPT)(
      sandbox.localStorage,
      sandbox.document,
    );

    expect(attributes["data-theme"]).toBe("dark");
  });

  it("does nothing when storage throws", () => {
    const attributes: Record<string, string> = {};
    const throwing = {
      getItem() {
        throw new Error("storage disabled");
      },
    };
    const doc = {
      documentElement: {
        setAttribute(name: string, value: string) {
          attributes[name] = value;
        },
      },
    };

    expect(() =>
      new Function("localStorage", "document", THEME_NO_FLASH_SCRIPT)(
        throwing,
        doc,
      ),
    ).not.toThrow();
    expect(attributes["data-theme"]).toBeUndefined();
  });
});
