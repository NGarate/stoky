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
import { REGISTRATION_CLOSED_MESSAGE } from "@/lib/auth/registration";
import type { PasswordCredentials, SignInResult } from "@/lib/auth/client";

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
let signInResult: SignInResult = { ok: true };

/** What every sign-in was called with, in order. */
const signInCalls: PasswordCredentials[] = [];

/**
 * The browser's one auth module, replaced **completely** (D50): the real
 * module is spread in, so `readSessionExpiry` and anything added later stay
 * real for every other suite in the process, and only the sign-in call, which
 * would otherwise reach for a server, answers from `signInResult`.
 */
const realAuthClient = await import("@/lib/auth/client");
mock.module("@/lib/auth/client", () => ({
  ...realAuthClient,
  signInWithPassword: async (credentials: PasswordCredentials) => {
    signInCalls.push(credentials);
    return signInResult;
  },
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

/**
 * What `/register` did on its way to choosing a screen, in order: `connection`
 * when it declared itself request-bound, `count` when it asked how many
 * accounts exist. Cleared by each test that reads it.
 */
const pageSteps: string[] = [];

/** What the account count answers. Each test that changes it puts it back. */
let userCount = 0;

/**
 * `connection()` throws outside a request scope, which is every test. The
 * real module is spread in so the mock is complete (D50): `src/lib/auth.ts`
 * and the proxy import other exports from it, and none of them is replaced.
 */
const realServer = await import("next/server");
mock.module("next/server", () => ({
  ...realServer,
  connection: async () => {
    pageSteps.push("connection");
  },
}));

/**
 * Complete: `prisma` is the module's only export. Nothing in this suite may
 * reach a database, and the page's single query is the one thing it needs.
 * No other component suite calls Prisma; `@/lib/i18n/cookies`, which imports
 * it, is mocked wherever it is rendered.
 */
mock.module("@/lib/prisma", () => ({
  prisma: {
    user: {
      count: async () => {
        pageSteps.push("count");
        return userCount;
      },
    },
  },
}));

const { default: LoginPage } = await import("@/app/(auth)/login/page");
const { LoginForm } = await import("@/components/session/LoginForm");
const { default: RegisterPage } = await import("@/app/(auth)/register/page");
const { RegisterForm } = await import("@/components/session/RegisterForm");
const { RegistrationClosed } = await import("@/components/session/RegistrationClosed");

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
    renderWithIntl(<LoginForm />, { locale: "es" });

    // Not `Login`, which is what it said. The catalogue key was already there
    // and already used by the submit button on the same page.
    expect(headings()).toEqual(["Iniciar sesión", "Iniciar sesión"]);
  });

  it("heads the page in English for an English reader", () => {
    renderWithIntl(<LoginForm />, { locale: "en" });

    expect(headings()).toEqual(["Sign in", "Sign in"]);
  });

  it("says nothing in Spanish to an English reader", () => {
    const { container } = renderWithIntl(<LoginForm />, { locale: "en" });

    for (const spanish of SPANISH_ONLY) {
      expect(container.textContent).not.toContain(spanish);
    }
  });

  it("translates the panel beside the form, not only the form", () => {
    // The half a Spanish-only test cannot see: this block read correctly in
    // Spanish and was hardcoded, so it stayed Spanish in English.
    const { container } = renderWithIntl(<LoginForm />, { locale: "en" });

    expect(container.textContent).toContain("A shared household");
  });
});

describe("the login page around the form", () => {
  // The page became a server component that renders `LoginForm`, and the
  // device's cleanup moved with it into the page. Every other test here drives
  // the form; this one is what notices the cleanup left behind.
  it("empties the previous account's queries on arrival", () => {
    const client = new QueryClient();
    const key = [["inventory", "getStockOverview"], { type: "query" }];
    client.setQueryData(key, { items: ["the previous account's milk"] });

    renderWithIntlOnly(
      <QueryClientProvider client={client}>
        <LoginPage />
      </QueryClientProvider>,
      { locale: "es" },
    );

    expect(client.getQueryData<unknown>(key)).toBeUndefined();
    expect(headings()).toEqual(["Iniciar sesión", "Iniciar sesión"]);
  });
});

describe("the register form", () => {
  it("heads the page in each language", () => {
    renderWithIntl(<RegisterForm />, { locale: "es" });
    expect(headings()).toEqual(["Registrarse", "Registrarse"]);

    cleanup();

    renderWithIntl(<RegisterForm />, { locale: "en" });
    expect(headings()).toEqual(["Sign up", "Sign up"]);
  });

  it("says nothing in Spanish to an English reader", () => {
    const { container } = renderWithIntl(<RegisterForm />, { locale: "en" });

    for (const spanish of SPANISH_ONLY) {
      expect(container.textContent).not.toContain(spanish);
    }
  });

  it("translates the panel beside the form", () => {
    const { container } = renderWithIntl(<RegisterForm />, { locale: "en" });

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
      renderWithIntl(<RegisterForm />, { locale });

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
    { name: "login", Page: LoginForm, asideTitle: "Hogar compartido" },
    { name: "register", Page: RegisterForm, asideTitle: "Primer hogar" },
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
      const { container } = renderWithIntl(<LoginForm />, { locale });

      expect(container.textContent).not.toContain("auth.");
    });
  }
});

describe("how a failed sign-in reaches someone who cannot see the form", () => {
  for (const [name, Page] of [
    ["login", LoginForm],
    ["register", RegisterForm],
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
    renderWithIntl(<LoginForm />, { locale: "es" });

    await userEvent.type(screen.getByLabelText("Correo electrónico"), "a@b.es");
    await userEvent.type(screen.getByLabelText("Contraseña"), "secreta123");
    await userEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    await waitFor(() => expect(replaced).toEqual(["/"]));
  });

  it("goes to the landing decision after a registration", async () => {
    replaced.length = 0;
    renderWithIntl(<RegisterForm />, { locale: "es" });

    await userEvent.type(screen.getByLabelText("Nombre"), "Ana");
    await userEvent.type(screen.getByLabelText("Correo electrónico"), "a@b.es");
    await userEvent.type(screen.getByLabelText("Contraseña"), "Secreta1234!");
    await userEvent.click(screen.getByRole("button", { name: "Registrarse" }));

    await waitFor(() => expect(replaced).toEqual(["/"]));
  });
});

describe("keep me signed in", () => {
  // D141. Unticked by default: a browser session is what anybody gets without
  // deciding, and the box is for a home device used every day.
  const LABEL = { es: "Mantener la sesión iniciada", en: "Keep me signed in" } as const;
  const HINT = {
    es: "Márcala en los dispositivos de casa que usas a diario, como la pantalla de la cocina. Sin marcar, la sesión se cierra al cerrar el navegador o tras 15 minutos sin uso.",
    en: "Tick it on home devices you use every day, such as the kitchen screen. Unticked, the session ends when you close the browser or after 15 minutes without use.",
  } as const;

  for (const locale of ["es", "en"] as const) {
    it(`is a labelled box with its hint, unticked, in ${locale}`, () => {
      renderWithIntl(<LoginForm />, { locale });

      const box = screen.getByRole("checkbox", { name: LABEL[locale] });
      expect(box).not.toBeChecked();
      expect(box).toHaveAccessibleDescription(HINT[locale]);
    });
  }

  async function submit(tick: boolean): Promise<PasswordCredentials> {
    signInCalls.length = 0;
    renderWithIntl(<LoginForm />, { locale: "es" });
    await userEvent.type(screen.getByLabelText("Correo electrónico"), "a@b.es");
    await userEvent.type(screen.getByLabelText("Contraseña"), "secreta123");
    if (tick) await userEvent.click(screen.getByRole("checkbox", { name: LABEL.es }));
    await userEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    await waitFor(() => expect(signInCalls).toHaveLength(1));
    return signInCalls[0];
  }

  it("sends rememberMe: false when it is left alone", async () => {
    expect(await submit(false)).toEqual({
      email: "a@b.es",
      password: "secreta123",
      rememberMe: false,
    });
  });

  it("sends rememberMe: true when it is ticked", async () => {
    expect((await submit(true)).rememberMe).toBe(true);
  });

  it("is not on the registration form, which signs in for a browser session", async () => {
    signInCalls.length = 0;
    renderWithIntl(<RegisterForm />, { locale: "es" });
    expect(screen.queryByRole("checkbox")).toBeNull();

    await userEvent.type(screen.getByLabelText("Nombre"), "Ana");
    await userEvent.type(screen.getByLabelText("Correo electrónico"), "a@b.es");
    await userEvent.type(screen.getByLabelText("Contraseña"), "Secreta1234!");
    await userEvent.click(screen.getByRole("button", { name: "Registrarse" }));

    await waitFor(() => expect(signInCalls).toHaveLength(1));
    expect(signInCalls[0].rememberMe).toBe(false);
  });
});

describe("what a refused sign-in says", () => {
  it("says what was wrong and what to check, not a word for it", async () => {
    // "Credenciales inválidas" named the failure in the system's word and
    // said nothing about what to do. The server will not say which of the
    // two was wrong — deliberately — so the message names both, and the one
    // detail that most often explains a right-looking password.
    signInResult = { ok: false, code: "invalid_credentials" };
    try {
      renderWithIntl(<LoginForm />, { locale: "es" });

      await userEvent.type(screen.getByLabelText("Correo electrónico"), "a@b.es");
      await userEvent.type(screen.getByLabelText("Contraseña"), "secreta123");
      await userEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));

      expect(
        await screen.findByText(
          "El correo o la contraseña no son correctos. Revisa los dos; la contraseña distingue mayúsculas.",
        ),
      ).toBeInTheDocument();
    } finally {
      signInResult = { ok: true };
    }
  });
});

describe("what a refused sign-in says when it has been tried too often", () => {
  // Two limits refuse with two codes. The address's says "this connection";
  // the account's must not, because a different network cannot help and the
  // person may be the one someone else is spending the attempts of.
  for (const [locale, code, words, labels] of [
    [
      "es",
      "account_rate_limited",
      "Demasiados intentos con esta cuenta. Espera unos minutos; si se repite, avisa a quien administra tu hogar.",
      { email: "Correo electrónico", password: "Contraseña", submit: "Iniciar sesión" },
    ],
    [
      "en",
      "account_rate_limited",
      "Too many attempts with this account. Wait a few minutes; if it keeps happening, tell whoever runs your household.",
      { email: "Email", password: "Password", submit: "Sign in" },
    ],
    [
      "es",
      "rate_limited",
      "Demasiados intentos desde esta conexión. Espera unos minutos y vuelve a probar.",
      { email: "Correo electrónico", password: "Contraseña", submit: "Iniciar sesión" },
    ],
  ] as const) {
    it(`says what ran out for ${code}, in ${locale}`, async () => {
      signInResult = { ok: false, code };
      try {
        renderWithIntl(<LoginForm />, { locale });

        await userEvent.type(screen.getByLabelText(labels.email), "a@b.es");
        await userEvent.type(screen.getByLabelText(labels.password), "secreta123");
        await userEvent.click(screen.getByRole("button", { name: labels.submit }));

        expect(await screen.findByText(words)).toBeInTheDocument();
      } finally {
        signInResult = { ok: true };
      }
    });
  }
});

describe("what a sign-in refused straight after registering says", () => {
  // The account exists by then, so the form signs it in. A refusal there
  // must still be worded, not swallowed into a navigation to a screen the
  // person cannot reach — the register form's own call to the sign-in module.
  it("says the account limit ran out, in es", async () => {
    signInResult = { ok: false, code: "account_rate_limited" };
    try {
      replaced.length = 0;
      renderWithIntl(<RegisterForm />, { locale: "es" });

      await userEvent.type(screen.getByLabelText("Nombre"), "Ana");
      await userEvent.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
      await userEvent.type(screen.getByLabelText("Contraseña"), "cocina despensa nevera");
      await userEvent.click(screen.getByRole("button", { name: "Registrarse" }));

      expect(
        await screen.findByText(
          "Demasiados intentos con esta cuenta. Espera unos minutos; si se repite, avisa a quien administra tu hogar.",
        ),
      ).toBeInTheDocument();
      expect(replaced).toEqual([]);
    } finally {
      signInResult = { ok: true };
    }
  });
});

describe("what a refused registration says", () => {
  // `STOKY_REGISTRATION` closed, or first-user with the instance claimed: the
  // server's FORBIDDEN carries the shared constant, and the form must say the
  // door is shut — not "check the details", which would send someone round the
  // form again for a refusal nothing they type can change.
  for (const [locale, words, labels] of [
    [
      "es",
      "El registro está cerrado en este servidor. Pide a quien administra tu hogar que te añada desde «Personas del hogar», en Configuración.",
      { name: "Nombre", email: "Correo electrónico", password: "Contraseña", submit: "Registrarse" },
    ],
    [
      "en",
      "Registration is closed on this server. Ask whoever runs your household to add you from “People in the household”, in Settings.",
      { name: "Name", email: "Email", password: "Password", submit: "Sign up" },
    ],
  ] as const) {
    it(`says registration is closed, in ${locale}`, async () => {
      registerFailure = new Error(REGISTRATION_CLOSED_MESSAGE);
      try {
        renderWithIntl(<RegisterForm />, { locale });

        await userEvent.type(screen.getByLabelText(labels.name), "Ana");
        await userEvent.type(screen.getByLabelText(labels.email), "ana@example.com");
        await userEvent.type(screen.getByLabelText(labels.password), "cocina despensa nevera");
        await userEvent.click(screen.getByRole("button", { name: labels.submit }));

        expect(await screen.findByText(words)).toBeInTheDocument();
      } finally {
        registerFailure = null;
      }
    });
  }

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
        renderWithIntl(<RegisterForm />, { locale });

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

/**
 * Registration closed (`STOKY_REGISTRATION`), said before anybody fills in a
 * form that cannot succeed.
 *
 * The page rendered the form whatever the setting, so a visitor on a closed
 * instance chose a password and learnt the answer from the refusal — and,
 * without JavaScript, never learnt it at all. The page now decides on the
 * server and renders one of two screens.
 */
describe("the screen that says registration is closed", () => {
  for (const [locale, words] of [
    [
      "es",
      {
        title: "El registro está cerrado",
        body: "En este servidor, las cuentas nuevas las crea quien administra el hogar. Pídele que te añada desde «Personas del hogar», en Configuración.",
        back: "Volver a iniciar sesión",
      },
    ],
    [
      "en",
      {
        title: "Registration is closed",
        body: "On this server, new accounts are created by whoever runs the household. Ask them to add you from “People in the household”, in Settings.",
        back: "Back to sign in",
      },
    ],
  ] as const) {
    it(`says what is closed and who can let the person in, in ${locale}`, () => {
      renderWithIntl(<RegistrationClosed />, { locale });

      expect(headings()).toEqual([words.title]);
      expect(screen.getByText(words.body)).toBeInTheDocument();
    });

    it(`leads back to sign-in by name alone, in ${locale}`, () => {
      renderWithIntl(<RegistrationClosed />, { locale });

      // BackLink's arrow is aria-hidden, so the accessible name is the words;
      // an arrow typed into the string would make this name longer.
      const back = screen.getByRole("link", { name: words.back });
      expect(back.getAttribute("href")).toBe("/login");
      expect(back.querySelector('svg[aria-hidden="true"]')).not.toBeAbsent();
    });
  }

  it("offers nothing to fill in", () => {
    const { container } = renderWithIntl(<RegistrationClosed />, { locale: "es" });

    expect(container.querySelector("form")).toBeAbsent();
    // Not "no input": the theme and language controls are inputs, and stay.
    expect(container.querySelector('input[type="email"], input[type="password"]')).toBeAbsent();
    expect(screen.queryByRole("button", { name: "Registrarse" })).toBeAbsent();
  });

  it("says nothing in Spanish to an English reader, and renders no raw key", () => {
    const { container } = renderWithIntl(<RegistrationClosed />, { locale: "en" });

    expect(container.textContent).not.toContain("auth.");
    for (const spanish of ["registro", "Configuración", "Personas del hogar"]) {
      expect(container.textContent).not.toContain(spanish);
    }
  });
});

describe("which screen /register chooses", () => {
  /** Runs `body` with `STOKY_REGISTRATION` set, and the count it would see. */
  async function withSetting(
    mode: string,
    count: number,
    body: () => Promise<void>,
  ): Promise<void> {
    const previous = process.env.STOKY_REGISTRATION;
    process.env.STOKY_REGISTRATION = mode;
    userCount = count;
    pageSteps.length = 0;
    try {
      await body();
    } finally {
      if (previous === undefined) delete process.env.STOKY_REGISTRATION;
      else process.env.STOKY_REGISTRATION = previous;
      userCount = 0;
    }
  }

  /** The page's own output, rendered as the server would have sent it. */
  async function renderPage(): Promise<HTMLElement> {
    return renderWithIntl(await RegisterPage(), { locale: "es" }).container;
  }

  it("shows the closed screen when closed, without asking the database", async () => {
    await withSetting("closed", 0, async () => {
      const page = await renderPage();

      expect(headings()).toEqual(["El registro está cerrado"]);
      expect(page.querySelector("form")).toBeAbsent();
      expect(pageSteps).toEqual(["connection"]);
    });
  });

  it("shows the closed screen once a first-user instance has its account", async () => {
    await withSetting("first-user", 1, async () => {
      const page = await renderPage();

      expect(headings()).toEqual(["El registro está cerrado"]);
      expect(page.querySelector("form")).toBeAbsent();
      // Declared request-bound before it counted: a prerender would otherwise
      // have counted at build time and baked the answer in.
      expect(pageSteps).toEqual(["connection", "count"]);
    });
  });

  it("shows the form on a first-user instance nobody has claimed", async () => {
    await withSetting("first-user", 0, async () => {
      const page = await renderPage();

      expect(page.querySelector("form")).not.toBeAbsent();
      expect(headings()).toEqual(["Registrarse", "Registrarse"]);
      expect(pageSteps).toEqual(["connection", "count"]);
    });
  });

  it("shows the form when open, without asking the database", async () => {
    await withSetting("open", 7, async () => {
      const page = await renderPage();

      expect(page.querySelector("form")).not.toBeAbsent();
      expect(pageSteps).toEqual(["connection"]);
    });
  });

  it("shows the closed screen for a value it does not know", async () => {
    // Outside production an unknown value does not stop the server, so the
    // page is what a mistyped setting looks like there: closed, never open.
    await withSetting("Open", 0, async () => {
      const page = await renderPage();

      expect(page.querySelector("form")).toBeAbsent();
      expect(headings()).toEqual(["El registro está cerrado"]);
    });
  });
});
