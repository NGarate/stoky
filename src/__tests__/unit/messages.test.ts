import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import es from "../../../messages/es.json";
import { MIN_PASSWORD_LENGTH } from "@/lib/validations/password";

/**
 * The two catalogues have to hold the same keys.
 *
 * next-intl does not throw on a missing key — it renders the key itself. So a
 * string added to `es.json` and forgotten in `en.json` does not fail a build, a
 * test or a page load; it puts `receipts.status.parsed` on screen for anyone
 * reading the app in English, and the only way anyone finds out is by switching
 * language and looking. That has already happened once in this project, on a
 * form field, where the leaked key became the field's accessible name.
 *
 * This is a unit test rather than part of the browser suite because it is a
 * property of two files, not of a rendered page: a route nobody visits in the
 * E2E suite can still carry the untranslated string.
 */

type Catalogue = { [key: string]: string | Catalogue };

function paths(node: Catalogue, prefix = ""): string[] {
  return Object.entries(node).flatMap(([key, value]) =>
    typeof value === "object" && value !== null
      ? paths(value, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

const spanish = paths(es as Catalogue);
const english = paths(en as Catalogue);

describe("message catalogues", () => {
  test("every Spanish key exists in English", () => {
    const missing = spanish.filter((key) => !english.includes(key));
    expect(missing).toEqual([]);
  });

  test("every English key exists in Spanish", () => {
    const missing = english.filter((key) => !spanish.includes(key));
    expect(missing).toEqual([]);
  });

  test("no value is left empty", () => {
    const empty = [
      ...paths(es as Catalogue).map((k) => ["es", k] as const),
      ...paths(en as Catalogue).map((k) => ["en", k] as const),
    ].filter(([catalogue, key]) => {
      const source = catalogue === "es" ? es : en;
      const value = key
        .split(".")
        .reduce<unknown>((node, part) => (node as Catalogue)?.[part], source);
      return typeof value !== "string" || value.trim() === "";
    });
    expect(empty).toEqual([]);
  });

  /**
   * A translation that is byte-identical to the Spanish is usually a copy that
   * nobody translated. Proper nouns and units legitimately match, so those are
   * listed rather than guessed at — an entry here is a claim that the word is
   * the same in both languages, not a way to silence the check.
   */
  test("no English string is an untranslated copy of the Spanish", () => {
    const SAME_IN_BOTH = new Set([
      "common.currency",
      "common.no",
      "products.new.unitPack",
      "settings.spanish",
      "settings.english",
    ]);

    const copied = spanish.filter((key) => {
      if (SAME_IN_BOTH.has(key)) return false;
      const read = (source: unknown) =>
        key.split(".").reduce<unknown>((n, p) => (n as Catalogue)?.[p], source);
      const a = read(es);
      const b = read(en);
      if (typeof a !== "string" || typeof b !== "string") return false;
      if (a !== b) return false;
      // A template made only of placeholders and punctuation — "{quantity}
      // {unit}", "{name} — {brand}" — has nothing in it to translate, so it is
      // identical in every language by construction.
      if (a.replace(/\{[^}]*\}/g, "").replace(/[\s·—–\-,.:;()]/g, "") === "") {
        return false;
      }
      // One word is too often a legitimate cognate ("Total", "Stock") to be
      // worth reporting; a whole sentence repeated is not.
      return a.trim().split(/\s+/).length > 1;
    });
    expect(copied).toEqual([]);
  });
});

/**
 * ISSUES.md I18N-2 — one word for one thing.
 *
 * The catalogue called the same piece of paper a *recibo* in `receipts.*` and a
 * *ticket* in `receipts.applied.*`, so the pipeline changed vocabulary at its
 * last step — the same class of seam as I18N-1, only subtler because both words
 * are Spanish and neither looks wrong on its own.
 *
 * "Ticket" won because `REDESIGN_PLAN.md` §3 says no system vocabulary and
 * writes for somebody standing in a supermarket: a Spanish supermarket hands
 * you a ticket, while a recibo is what a bank sends. It was the *larger* change
 * — twenty-three strings against nine — which is the direction the argument
 * pointed rather than the direction the diff did.
 */
describe("one word for one thing", () => {
  /** Terms that were split, and the word that won. */
  const RETIRED: [RegExp, string][] = [[/\brecibos?\b/i, "ticket"]];

  test("never uses a word the catalogue retired", () => {
    const offenders = spanish.filter((key) => {
      const value = key
        .split(".")
        .reduce<unknown>((node, part) => (node as Catalogue)?.[part], es);
      return (
        typeof value === "string" &&
        RETIRED.some(([pattern]) => pattern.test(value))
      );
    });

    expect(offenders).toEqual([]);
  });

  test("would notice one", () => {
    // Without this the check above passes for ever if `flatten` or the pattern
    // stops working, and a vocabulary test that cannot see the word it bans is
    // just a comment.
    expect(RETIRED[0][0].test("Subir recibo")).toBe(true);
    expect(RETIRED[0][0].test("Subir ticket")).toBe(false);
  });
});

/**
 * Typography each language expects, checked rather than remembered.
 *
 * Spanish quotes with «», English with “”; both use the ellipsis character
 * rather than three full stops; and "solo" lost its accent in 2010. The
 * catalogues had all of these wrong somewhere — English strings quoting a
 * product name in «», 23 values ending "...", a hint quoting "Casa" in
 * straight quotes — and nothing could see it but a reader.
 */
describe("typography", () => {
  const valueOf = (catalogue: Catalogue, key: string): string =>
    key
      .split(".")
      .reduce<unknown>((node, part) => (node as Catalogue)?.[part], catalogue) as string;

  const offending = (
    catalogue: Catalogue,
    keys: string[],
    pattern: RegExp,
  ): string[] => keys.filter((key) => pattern.test(valueOf(catalogue, key)));

  test("uses the ellipsis character, never three full stops", () => {
    expect(offending(es as Catalogue, spanish, /\.\.\./)).toEqual([]);
    expect(offending(en as Catalogue, english, /\.\.\./)).toEqual([]);
  });

  test("quotes Spanish with «» and English with “”, never straight quotes", () => {
    expect(offending(es as Catalogue, spanish, /["“”]/)).toEqual([]);
    expect(offending(en as Catalogue, english, /["«»]/)).toEqual([]);
  });

  test("writes solo without its retired accent", () => {
    expect(offending(es as Catalogue, spanish, /\b[Ss]ólo\b/)).toEqual([]);
  });

  test("would notice each of them", () => {
    expect(/\.\.\./.test("Cargando...")).toBe(true);
    expect(/["«»]/.test("Could not delete «Lidl».")).toBe(true);
    expect(/\b[Ss]ólo\b/.test("Sólo quien administra")).toBe(true);
  });
});

/**
 * One action, one name: the link that opens a flow, its page's title and the
 * button that commits it say the same words.
 *
 * Recording what was used was "Consumir stock" in Spanish and, in English,
 * "Use stock" on the inventory's link and "Consume stock" on the dashboard's,
 * the page's title and its button — one action wearing two names in one
 * language. The vocabulary of an interface is how people find their way round
 * it, so the names are pinned to each other rather than to a spelling.
 */
describe("one action, one name", () => {
  const FLOWS: Record<string, string[]> = {
    "recording what was used": [
      "dashboard.quickConsumeStock",
      "inventory.consumeStock",
      "inventory.consume.title",
      "inventory.consume.submit",
    ],
  };

  for (const [flow, keys] of Object.entries(FLOWS)) {
    for (const [language, catalogue] of [
      ["es", es],
      ["en", en],
    ] as const) {
      test(`${flow} keeps one name in ${language}`, () => {
        const names = keys.map((key) =>
          key
            .split(".")
            .reduce<unknown>((node, part) => (node as Catalogue)?.[part], catalogue),
        );
        expect(new Set(names).size).toBe(1);
      });
    }
  }
});

/**
 * Arrows belong to the component, never to the string.
 *
 * `BackLink` draws an `aria-hidden` `<ArrowLeft/>`, and eight catalogue
 * entries opened with a literal "← ". The first two screens to adopt the
 * component therefore rendered **two** back arrows side by side — one drawn,
 * one typed — and no gate saw it: the strings were valid, the parity test
 * passed, and `tsc` has no opinion about the contents of a translation.
 *
 * A typed arrow is also worse than redundant on its own. Screen readers
 * announce "flecha hacia la izquierda" as part of the accessible name, which
 * is the noise `aria-hidden` exists to prevent (WCAG 2.4.9, DESIGN_AUDIT §4),
 * and a right-to-left locale would need the glyph flipped in every string
 * rather than once in a stylesheet.
 */
describe("decoration lives in components, not in the catalogue", () => {
  /**
   * Glyphs a component draws. None of them is ever part of a message.
   *
   * Not `«»`: those are Spanish quotation marks, which is typography the
   * catalogue is right to carry — forty-odd strings use them correctly.
   */
  const DRAWN = /[←→↑↓▲▼✓✔✕✖]/u;

  test("no catalogue string carries a glyph a component draws", () => {
    const offenders = [
      ...spanish.map((key) => [key, "es", value(es as Catalogue, key)] as const),
      ...english.map((key) => [key, "en", value(en as Catalogue, key)] as const),
    ]
      .filter(([, , text]) => typeof text === "string" && DRAWN.test(text))
      .map(([key, locale]) => `${locale}:${key}`);

    expect(offenders).toEqual([]);
  });

  test("would notice one", () => {
    expect(DRAWN.test("← Volver a productos")).toBe(true);
    expect(DRAWN.test("Volver a productos")).toBe(false);
    // Typography, not iconography: the em dash, the middot and the Spanish
    // quotation marks all stay.
    expect(DRAWN.test("2 lotes — 3 productos · «Leche»")).toBe(false);
  });
});

/**
 * A number in a sentence agrees with the sentence.
 *
 * `{count} artículos` reads "1 artículos", and Spanish notices. next-intl
 * speaks ICU, so the plural rule belongs in the catalogue rather than in a
 * ternary at the call site — where it would have to be written once per
 * screen and would still be wrong in a language with more than two forms.
 *
 * Only `count` is checked. `quantity` and `stock` are amounts rather than
 * counts — "1,5 L" is not a plural — and the unit beside them comes from the
 * household's own data, which no catalogue can decline.
 */
describe("a number in a sentence agrees with it", () => {
  test("every {count} carries a plural rule", () => {
    const offenders = [
      ...spanish.map((key) => [key, "es", value(es as Catalogue, key)] as const),
      ...english.map((key) => [key, "en", value(en as Catalogue, key)] as const),
    ]
      .filter(
        ([, , text]) =>
          typeof text === "string" &&
          text.includes("{count}") &&
          !text.includes("plural"),
      )
      .map(([key, locale]) => `${locale}:${key}`);

    expect(offenders).toEqual([]);
  });

  test("would notice one", () => {
    const bare = "{count} artículos";
    const declined =
      "{count, plural, one {# artículo} other {# artículos}}";

    expect(bare.includes("{count}") && !bare.includes("plural")).toBe(true);
    expect(
      declined.includes("{count}") && !declined.includes("plural"),
    ).toBe(false);
  });
});

/**
 * A password hint states the minimum the server enforces.
 *
 * `newPasswordSchema` has asked for twelve characters since DEBT-1 was
 * answered, while the registration hint still said "Ocho caracteres o más",
 * the add-a-member hint said 8 and the add-a-member field carried
 * `minLength={8}`. Somebody who followed the screen typed nine characters,
 * passed the browser's check and got back a generic refusal that did not say
 * why. The add-a-member hint also promised "La persona podrá cambiarla más
 * adelante" when nothing in the application changed a password once it was
 * set; the promise came back with `auth.changePassword`, true this time.
 *
 * The number therefore reaches the screen as an ICU parameter fed from
 * `MIN_PASSWORD_LENGTH`, never as a literal in a translation or in a
 * component, so raising the rule cannot leave one of the three behind again.
 */
describe("a password hint states the minimum the server enforces", () => {
  const HINTS = [
    ["auth", "passwordHintRegister"],
    ["household", "addPasswordHint"],
    ["household", "resetPasswordHint"],
    ["household", "resetTooShort"],
    ["password", "newPasswordHint"],
    ["password", "newPasswordTooShort"],
  ] as const;

  for (const [locale, messages] of [
    ["es", es],
    ["en", en],
  ] as const) {
    for (const [namespace, key] of HINTS) {
      test(`${locale}:${namespace}.${key} takes the minimum as a parameter`, () => {
        const raw = value(messages as Catalogue, `${namespace}.${key}`);
        expect(typeof raw).toBe("string");
        // The placeholder, and no number of its own: a literal "12" would pass
        // the render below today and go stale the day the rule changes.
        expect(raw as string).toContain("{min}");
        expect(raw as string).not.toMatch(/\d/);

        const t = createTranslator({ locale, messages, namespace }) as unknown as (
          key: string,
          values: Record<string, number>,
        ) => string;
        expect(t(key, { min: MIN_PASSWORD_LENGTH })).toContain(
          String(MIN_PASSWORD_LENGTH),
        );
      });
    }
  }

  test("promises a password can be changed only while something changes it", () => {
    // The add-a-member hint promised this once when nothing could, and the
    // promise was removed (security review, 2026-10-12). It is back because
    // `auth.changePassword` exists, and it says where — the screen's own name
    // in each catalogue, so renaming Settings cannot leave it pointing at a
    // place that is not there. Deleting the procedure turns this red, which
    // is the moment the sentence would become untrue again.
    const router = readFileSync(
      join(import.meta.dir, "../../server/trpc/routers/auth.ts"),
      "utf8",
    );
    expect(router).toMatch(/^ {2}changePassword: protectedProcedure\b/m);

    expect(value(es as Catalogue, "household.addPasswordHint")).toMatch(/cambiar/i);
    expect(value(es as Catalogue, "household.addPasswordHint")).toContain(
      value(es as Catalogue, "navigation.settings") as string,
    );
    expect(value(en as Catalogue, "household.addPasswordHint")).toMatch(/change/i);
    expect(value(en as Catalogue, "household.addPasswordHint")).toContain(
      value(en as Catalogue, "navigation.settings") as string,
    );
  });

  const componentSources = (): string[] => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          if (entry !== "__tests__") walk(path);
        } else if (path.endsWith(".tsx")) {
          files.push(path);
        }
      }
    };
    walk(join(import.meta.dir, "../.."));
    return files;
  };

  test("every call site hands the hint the minimum", () => {
    // The catalogue tests above cannot see a call site. Without the argument
    // next-intl raises no error and the screen reads "Al menos {min}
    // caracteres." with the braces in it, and only the register page is
    // rendered by a component test.
    const CALL =
      /\bt\(\s*"(passwordHintRegister|addPasswordHint|resetPasswordHint|resetTooShort|newPasswordHint|newPasswordTooShort)"([^)]*)\)/g;
    const ARGUMENT = /^\s*,\s*\{\s*min:\s*MIN_PASSWORD_LENGTH\s*\}\s*$/;
    const found = new Set<string>();
    const bare: string[] = [];
    for (const file of componentSources()) {
      for (const match of readFileSync(file, "utf8").matchAll(CALL)) {
        found.add(match[1]);
        if (!ARGUMENT.test(match[2])) bare.push(`${file}: ${match[0]}`);
      }
    }

    // Every hint is in use, so an empty scan cannot pass for a clean one.
    expect([...found].sort()).toEqual([
      "addPasswordHint",
      "newPasswordHint",
      "newPasswordTooShort",
      "passwordHintRegister",
      "resetPasswordHint",
      "resetTooShort",
    ]);
    expect(bare).toEqual([]);
  });

  test("no component writes a password length as a literal", () => {
    const files = componentSources();

    const LITERAL = [/minLength=\{\s*\d+\s*\}/, /password\.length\s*[<>]=?\s*\d+/];
    const offenders = files.filter((file) => {
      const source = readFileSync(file, "utf8");
      return LITERAL.some((pattern) => pattern.test(source));
    });

    expect(files.length).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  test("would notice one", () => {
    const LITERAL = [/minLength=\{\s*\d+\s*\}/, /password\.length\s*[<>]=?\s*\d+/];
    expect(LITERAL[0].test("minLength={8}")).toBe(true);
    expect(LITERAL[1].test("password.length < 8")).toBe(true);
    expect(LITERAL.some((p) => p.test("minLength={MIN_PASSWORD_LENGTH}"))).toBe(false);
    expect(LITERAL.some((p) => p.test("password.length < MIN_PASSWORD_LENGTH"))).toBe(false);
  });
});

function value(node: Catalogue, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>((current, part) => (current as Catalogue)?.[part], node);
}
