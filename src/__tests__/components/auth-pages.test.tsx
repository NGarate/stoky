import "../setup/matchers";
import { describe, it, expect, afterEach, mock } from "bun:test";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { renderWithIntl as renderWithIntlOnly, type TestLocale } from "../utils/render";
import { resolve } from "../setup/tailwind";
import { MIN_PASSWORD_LENGTH } from "@/lib/validations/password";
import { registerSchema } from "@/lib/validations/auth";

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

/** What the next sign-in answers. Each test that changes it puts it back. */
let signInResult: { ok: boolean; error: string | null; code?: string } = {
  ok: true,
  error: null,
};

mock.module("next-auth/react", () => ({
  signIn: async () => signInResult,
}));

/** What the next registration throws, or `null` for success. Reset by each test that sets it. */
let registerFailure: Error | null = null;

/** Every path a page asked the router to replace the current entry with. */
const replaced: string[] = [];

mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: () => {},
    refresh: () => {},
    replace: (path: string) => replaced.push(path),
  }),
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
        useMutation: () => ({
          mutateAsync: async () => {
            if (registerFailure) throw registerFailure;
            return {};
          },
          isPending: false,
        }),
      },
    },
  },
  TRPCProvider: ({ children }: { children: React.ReactNode }) => children,
}));

/**
 * The root layout's query client, which `/login` empties on arrival — the
 * previous account's reads must not be the first thing the next one sees.
 */
function renderWithIntl(ui: ReactElement, options?: { locale?: TestLocale }) {
  return renderWithIntlOnly(
    <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>,
    options,
  );
}

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

  // The hint said eight while the server asked for twelve, and the field let
  // eleven through to a refusal that did not say why. The page has to hand the
  // catalogue the number and the browser the same one.
  for (const [locale, label] of [
    ["es", "Contraseña"],
    ["en", "Password"],
  ] as const) {
    it(`asks for the minimum the server enforces, in ${locale}`, () => {
      renderWithIntl(<RegisterPage />, { locale });

      const field = screen.getByLabelText(label) as HTMLInputElement;
      expect(field.minLength).toBe(MIN_PASSWORD_LENGTH);
      expect(document.getElementById("password-hint")?.textContent).toContain(
        `${MIN_PASSWORD_LENGTH} `,
      );
    });
  }
});

/**
 * ISSUES.md UI-10 — the hero panel beside the form.
 *
 * Both pages painted it `bg-primary`, which made the action colour a
 * full-height surface: the only place in the application where the colour that
 * means "press this" was a background rather than a control. The owner's
 * verdict on seeing it was "un fondo verde horrible", and the failure is
 * structural rather than a matter of taste — a surface and a button cannot
 * share a fill and still mean different things.
 *
 * The assertion compares two *compiled* fills rather than class names, through
 * the same Tailwind compiler the target-size guard uses: what is wrong here is
 * a colour, and `toHaveClass("bg-primary")` would pass just as happily on the
 * fixed version if someone re-pointed the token.
 */
function heroPanel(container: HTMLElement, asideTitle: string): HTMLElement {
  // Located by the copy only the panel carries — the narrow-screen fallback
  // repeats the heading and the subtitle, but never the aside block. Finding it
  // positionally would keep passing against the wrong <section> after a
  // reorder, which is the shape of bug this whole file exists for.
  const panel = Array.from(container.querySelectorAll("section")).find((section) =>
    section.textContent?.includes(asideTitle),
  );
  if (!panel) throw new Error(`no <section> carries the aside copy "${asideTitle}"`);
  return panel;
}

async function backgroundOf(classNames: string): Promise<string | undefined> {
  return (await resolve(classNames)).substituted.get("background-color");
}

describe("the panel beside the form is a surface, not the action colour", () => {
  const pages = [
    { name: "login", Page: LoginPage, asideTitle: "Hogar compartido" },
    { name: "register", Page: RegisterPage, asideTitle: "Primer hogar" },
  ] as const;

  for (const { name, Page, asideTitle } of pages) {
    it(`on ${name}`, async () => {
      const { container } = renderWithIntl(<Page />, { locale: "es" });

      const panelFill = await backgroundOf(heroPanel(container, asideTitle).className);
      const buttonFill = await backgroundOf("bg-primary");

      expect(buttonFill).toBeDefined();
      expect(panelFill).toBeDefined();
      expect(panelFill).not.toBe(buttonFill);
    });
  }
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

describe("how a failed sign-in reaches someone who cannot see the form", () => {
  for (const [name, Page] of [
    ["login", LoginPage],
    ["register", RegisterPage],
  ] as const) {
    it(`${name} carries its region before it has anything to say`, () => {
      const { container } = renderWithIntl(<Page />, { locale: "es" });

      // The region was rendered only once there was an error, so it was
      // inserted together with its text — the case screen readers may skip.
      // Someone who mistyped a password could be left with a form that looked
      // unchanged and said nothing (WCAG 4.1.3).
      const region = container.querySelector('[role="status"]');
      expect(region).not.toBeAbsent();
      expect(region?.getAttribute("aria-live")).toBe("polite");
      expect(region?.textContent).toBe("");
    });

    it(`${name} keeps that region out of the way while it is empty`, () => {
      const { container } = renderWithIntl(<Page />, { locale: "es" });

      // Present in the accessibility tree, absent from the layout: an empty
      // red panel above the button would be a failure nobody had had yet.
      expect(container.querySelector('[role="status"]')?.className).toContain(
        "sr-only",
      );
    });

    it(`${name} never adds a second assertive region`, () => {
      const { container } = renderWithIntl(<Page />, { locale: "es" });

      expect(container.querySelector('[role="alert"]')).toBeAbsent();
    });
  }
});

describe("where signing in leads", () => {
  // `/` is where the screen choice is honoured (`src/app/page.tsx`, Journey
  // 8): the kitchen tablet goes to the kitchen, the phone that chose the shop
  // goes to the shop, and somebody new is asked. Replacing straight to
  // `/dashboard` walked past all three — a new account never saw `/start`.
  it("goes to the landing decision after a sign-in", async () => {
    replaced.length = 0;
    renderWithIntl(<LoginPage />, { locale: "es" });

    await userEvent.type(screen.getByLabelText("Correo electrónico"), "a@b.es");
    await userEvent.type(screen.getByLabelText("Contraseña"), "secreta123");
    await userEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    await waitFor(() => expect(replaced).toEqual(["/"]));
  });

  it("goes to the landing decision after a registration", async () => {
    replaced.length = 0;
    renderWithIntl(<RegisterPage />, { locale: "es" });

    await userEvent.type(screen.getByLabelText("Nombre"), "Ana");
    await userEvent.type(screen.getByLabelText("Correo electrónico"), "a@b.es");
    await userEvent.type(screen.getByLabelText("Contraseña"), "Secreta1234!");
    await userEvent.click(screen.getByRole("button", { name: "Registrarse" }));

    await waitFor(() => expect(replaced).toEqual(["/"]));
  });
});

describe("what a refused sign-in says", () => {
  it("says what was wrong and what to check, not a word for it", async () => {
    // "Credenciales inválidas" named the failure in the system's word and
    // said nothing about what to do. Auth.js will not say which of the two
    // was wrong — deliberately — so the message names both, and the one
    // detail that most often explains a right-looking password.
    signInResult = { ok: false, error: "CredentialsSignin" };
    try {
      renderWithIntl(<LoginPage />, { locale: "es" });

      await userEvent.type(screen.getByLabelText("Correo electrónico"), "a@b.es");
      await userEvent.type(screen.getByLabelText("Contraseña"), "secreta123");
      await userEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));

      expect(
        await screen.findByText(
          "El correo o la contraseña no son correctos. Revisa los dos; la contraseña distingue mayúsculas.",
        ),
      ).toBeInTheDocument();
    } finally {
      signInResult = { ok: true, error: null };
    }
  });
});

describe("what a refused registration says", () => {
  // The identity rule's refusal arrives as tRPC's BAD_REQUEST, whose message is
  // the ZodError's own JSON. Built here from the real schema rather than
  // written out, so a reworded server message cannot leave this test passing
  // against a string the server no longer sends.
  const identity = { email: "noel@example.com", name: "Noel" };
  const password = "noel despensa 2026";

  for (const [locale, words, labels] of [
    [
      "es",
      "La contraseña contiene tu nombre o tu correo. Elige una que no los incluya.",
      { name: "Nombre", email: "Correo electrónico", password: "Contraseña", submit: "Registrarse" },
    ],
    [
      "en",
      "The password contains your name or your email address. Choose one that does not include them.",
      { name: "Name", email: "Email", password: "Password", submit: "Sign up" },
    ],
  ] as const) {
    it(`says the password contains the person's own name, in ${locale}`, async () => {
      const refusal = registerSchema.safeParse({ ...identity, password });
      expect(refusal.success).toBe(false);
      registerFailure = new Error(refusal.error?.message);
      try {
        renderWithIntl(<RegisterPage />, { locale });

        await userEvent.type(screen.getByLabelText(labels.name), identity.name);
        await userEvent.type(screen.getByLabelText(labels.email), identity.email);
        await userEvent.type(screen.getByLabelText(labels.password), password);
        await userEvent.click(screen.getByRole("button", { name: labels.submit }));

        expect(await screen.findByText(words)).toBeInTheDocument();
      } finally {
        registerFailure = null;
      }
    });
  }
});
