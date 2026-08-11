import "../setup/matchers";
import { describe, it, expect, afterEach, mock } from "bun:test";
import { cleanup, screen } from "@testing-library/react";
import { renderWithIntl } from "../utils/render";

/**
 * ISSUES.md I18N-8 — the two pages an unauthenticated visitor can reach, in
 * both languages.
 *
 * They got it wrong in both directions at once. The `<h1>` was the literal
 * string `Login`, directly above a translated subtitle, so a Spanish reader saw
 * an English heading over a Spanish sentence. The panel beside it was hardcoded
 * Spanish, so an English reader saw an English heading, an English subtitle,
 * and a Spanish promotional block.
 *
 * **Rendering in Spanish alone cannot catch the second half** — a string
 * hardcoded in Spanish looks right — which is why every assertion here runs in
 * both catalogues. `messages.test.ts` compares the two catalogues against each
 * other and cannot see a string that never reached either; this is the check
 * that closes that blind spot for these pages.
 */

mock.module("next-auth/react", () => ({
  signIn: async () => ({ ok: true, error: null }),
}));

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  usePathname: () => "/login",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: () => {},
}));

/**
 * A **complete** mock, both exports, per D50: `mock.module` is process-global,
 * and a partial one turns the missing exports into `undefined` for every other
 * file in the run. Safe to replace here only because nothing else in the suite
 * imports this module — checked, not assumed.
 */
mock.module("@/components/providers/TRPCProvider", () => ({
  api: {
    auth: {
      register: {
        useMutation: () => ({ mutateAsync: async () => ({}), isPending: false }),
      },
    },
  },
  TRPCProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const { default: LoginPage } = await import("@/app/(auth)/login/page");
const { default: RegisterPage } = await import("@/app/(auth)/register/page");

afterEach(cleanup);

/** Strings that must never appear when the other language is selected. */
const SPANISH_ONLY = [
  "Hogar compartido",
  "Primer hogar",
  "Inventario, tickets y precios",
  "Puedes crear el hogar",
];

/**
 * Every top-level heading on the page, not one of them.
 *
 * Each page renders its `<h1>` twice — once in the panel that shows from `lg`
 * up, once for narrow screens — and only one is visible at a time. Asserting
 * that *a* heading is translated passes while the other still says `Login`,
 * which is half the bug still shipping to half the viewports.
 */
function headings(): string[] {
  return screen.getAllByRole("heading", { level: 1 }).map((node) => node.textContent ?? "");
}

describe("the login page", () => {
  it("heads the page in Spanish for a Spanish reader", () => {
    renderWithIntl(<LoginPage />, { locale: "es" });

    // Not `Login`, which is what it said. The catalogue key was already there
    // and already used by the submit button on the same page.
    expect(headings()).toEqual(["Iniciar sesión", "Iniciar sesión"]);
  });

  it("heads the page in English for an English reader", () => {
    renderWithIntl(<LoginPage />, { locale: "en" });

    expect(headings()).toEqual(["Sign in", "Sign in"]);
  });

  it("says nothing in Spanish to an English reader", () => {
    const { container } = renderWithIntl(<LoginPage />, { locale: "en" });

    for (const spanish of SPANISH_ONLY) {
      expect(container.textContent).not.toContain(spanish);
    }
  });

  it("translates the panel beside the form, not only the form", () => {
    // The half a Spanish-only test cannot see: this block read correctly in
    // Spanish and was hardcoded, so it stayed Spanish in English.
    const { container } = renderWithIntl(<LoginPage />, { locale: "en" });

    expect(container.textContent).toContain("A shared household");
  });
});

describe("the register page", () => {
  it("heads the page in each language", () => {
    renderWithIntl(<RegisterPage />, { locale: "es" });
    expect(headings()).toEqual(["Registrarse", "Registrarse"]);

    cleanup();

    renderWithIntl(<RegisterPage />, { locale: "en" });
    expect(headings()).toEqual(["Sign up", "Sign up"]);
  });

  it("says nothing in Spanish to an English reader", () => {
    const { container } = renderWithIntl(<RegisterPage />, { locale: "en" });

    for (const spanish of SPANISH_ONLY) {
      expect(container.textContent).not.toContain(spanish);
    }
  });

  it("translates the panel beside the form", () => {
    const { container } = renderWithIntl(<RegisterPage />, { locale: "en" });

    expect(container.textContent).toContain("Your first household");
  });
});

describe("neither page renders a raw key", () => {
  // next-intl renders the key itself when it is missing rather than throwing,
  // so a typo ships as `auth.loginAsideTitle` on screen. Nothing else notices.
  for (const locale of ["es", "en"] as const) {
    it(`in ${locale}`, () => {
      const { container } = renderWithIntl(<LoginPage />, { locale });

      expect(container.textContent).not.toContain("auth.");
    });
  }
});
