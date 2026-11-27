import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createContext } from "react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { renderWithIntl } from "../utils/render";

/**
 * Configuración, ordered by task (DECISIONS.md NAVIGATION): four groups in
 * the owner's order, the same settings the flat list had, and a search that
 * narrows them as you type.
 */

/** Who the page thinks is looking. */
let role = "OWNER";

// Complete, per D50 — a partial mock of a shared module deletes exports for
// every file that runs after it.
mock.module("next/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: () => {},
}));

mock.module("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

mock.module("@/lib/i18n/cookies", () => ({
  setLocalePreference: async () => {},
}));

mock.module("@/lib/offline/queue-context", () => ({
  WriteQueueContext: createContext(null),
  useWriteQueue: () => ({
    state: { pending: [], failed: [], status: "idle", full: false },
    enqueue: () => ({ ok: true, id: "op" }),
    drain: () => {},
    cancel: () => true,
    holdRemainingMs: () => 0,
    retry: () => {},
    discard: () => {},
    flush: async () => {},
    purgeAll: () => {},
  }),
}));

mock.module("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({
      household: { current: { invalidate: async () => {} } },
      data: { exportHousehold: { fetch: async () => ({}) } },
    }),
    household: {
      current: {
        useQuery: () => ({
          data: {
            household: {
              id: "h1",
              name: "Casa",
              tabName: null,
              appName: null,
            },
            role,
          },
        }),
      },
      update: {
        useMutation: () => ({ mutate: () => {}, isPending: false }),
      },
    },
    auth: {
      setSnackbarDuration: {
        useMutation: () => ({ mutate: () => {}, isPending: false }),
      },
    },
  },
}));

const { SnackbarProvider } = await import("@/components/ui/snackbar");
const { default: SettingsPage } =
  await import("@/app/(dashboard)/settings/page");

function renderPage(): void {
  renderWithIntl(
    <SnackbarProvider>
      <SettingsPage />
    </SnackbarProvider>,
    { locale: "es" },
  );
}

function groups(): string[] {
  return screen
    .queryAllByRole("heading", { level: 2 })
    .filter((heading) => heading.id.startsWith("settings-"))
    .map((heading) => heading.textContent ?? "");
}

function group(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

function rowTitles(region: HTMLElement): string[] {
  return within(region)
    .queryAllByRole("link")
    .map((link) => link.textContent ?? "");
}

beforeEach(() => {
  role = "OWNER";
});

afterEach(cleanup);

describe("Configuración", () => {
  it("is ordered by task, in the owner's order", () => {
    renderPage();

    expect(groups()).toEqual([
      "Organizar la casa",
      "Cómo se ve y cómo avisa",
      "Seguridad",
      "Tus datos",
    ]);
  });

  it("files each setting under what somebody came to do", () => {
    renderPage();

    const house = group("Organizar la casa");
    expect(
      within(house).getByLabelText("Nombre del hogar"),
    ).toBeInTheDocument();
    expect(rowTitles(house)).toEqual([
      "Personas del hogar",
      "Ubicaciones de almacenamiento",
      "Tiendas",
    ]);

    const look = group("Cómo se ve y cómo avisa");
    expect(within(look).getByLabelText("Idioma")).toBeInTheDocument();
    expect(
      within(look).getByRole("group", { name: "Duración de los avisos" }),
    ).toBeInTheDocument();
    expect(
      within(look).getByRole("group", { name: "Tema" }),
    ).toBeInTheDocument();
    expect(rowTitles(look)).toEqual(["Pantalla de inicio"]);

    expect(rowTitles(group("Seguridad"))).toEqual(["Seguridad y acceso"]);

    const data = group("Tus datos");
    expect(rowTitles(data)).toEqual(["Cambios sin guardar"]);
    expect(
      within(data).getByRole("button", {
        name: "Descargar un archivo con todo",
      }),
    ).toBeInTheDocument();
  });

  it("has the groups as its only sections, and what is titled inside them one level down", () => {
    renderPage();

    expect(
      screen
        .getAllByRole("heading", { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual([
      "Organizar la casa",
      "Cómo se ve y cómo avisa",
      "Seguridad",
      "Tus datos",
    ]);
    expect(
      within(group("Organizar la casa")).getByRole("heading", {
        level: 3,
        name: "Hogar",
      }),
    ).toBeInTheDocument();
    expect(
      within(group("Tus datos")).getByRole("heading", {
        level: 3,
        name: "Descargar tus datos",
      }),
    ).toBeInTheDocument();
  });

  it("has the same places to go as before, and no way out: that is the account panel's", () => {
    renderPage();

    expect(
      screen
        .getAllByRole("link")
        .map((link) => link.getAttribute("href"))
        .filter((href) => href?.startsWith("/settings/")),
    ).toEqual([
      "/settings/people",
      "/settings/locations",
      "/settings/stores",
      "/settings/screen",
      "/settings/security",
      "/settings/unsaved",
    ]);
    expect(
      screen.queryByRole("button", { name: "Cerrar sesión" }),
    ).toBeAbsent();
  });

  it("goes back to Inicio, since no bar marks it", () => {
    renderPage();

    expect(
      screen.getByRole("link", { name: "Volver al inicio" }),
    ).toHaveAttribute("href", "/dashboard");
  });

  it("shows the household's names only to whoever may change them", () => {
    role = "MEMBER";
    renderPage();

    expect(screen.queryByLabelText("Nombre del hogar")).toBeAbsent();
  });
});

describe("searching Configuración", () => {
  it("keeps only what matches, without accents or capitals in the way", async () => {
    renderPage();

    await userEvent.type(
      screen.getByRole("searchbox", { name: "Buscar en Configuración" }),
      "DURACION",
    );

    expect(groups()).toEqual(["Cómo se ve y cómo avisa"]);
    const look = group("Cómo se ve y cómo avisa");
    expect(
      within(look).getByRole("group", { name: "Duración de los avisos" }),
    ).toBeInTheDocument();
    expect(within(look).queryByLabelText("Idioma")).toBeAbsent();
    expect(screen.getByRole("status")).toHaveTextContent("1 ajuste coincide");
  });

  it("finds a setting by the sentence under it", async () => {
    renderPage();

    await userEvent.type(screen.getByRole("searchbox"), "nevera");

    expect(groups()).toEqual(["Organizar la casa"]);
    expect(rowTitles(group("Organizar la casa"))).toEqual([
      "Ubicaciones de almacenamiento",
    ]);
  });

  it("finds a whole group by its name", async () => {
    renderPage();

    await userEvent.type(screen.getByRole("searchbox"), "tus datos");

    expect(groups()).toEqual(["Tus datos"]);
    expect(rowTitles(group("Tus datos"))).toEqual(["Cambios sin guardar"]);
    // Settings counted, not groups.
    expect(screen.getByRole("status")).toHaveTextContent("2 ajustes coinciden");
  });

  it("says so when nothing matches", async () => {
    renderPage();

    await userEvent.type(screen.getByRole("searchbox"), "zzz");

    expect(groups()).toEqual([]);
    expect(
      screen.getByText("Nada en Configuración coincide con «zzz»."),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Ningún ajuste coincide",
    );
  });

  it("finds nobody the household's names who cannot see them", async () => {
    // Otherwise the search would keep a group whose one match draws nothing.
    role = "MEMBER";
    renderPage();

    await userEvent.type(screen.getByRole("searchbox"), "pestaña");

    expect(groups()).toEqual([]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Ningún ajuste coincide",
    );
  });

  it("says nothing while nothing is being searched", () => {
    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent("");
  });
});
