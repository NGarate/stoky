import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../utils/render";

// `setLocaleCookie` is a server action; importing it for real would pull in
// `next/headers`, which has no meaning outside a request.
const setLocaleCookie = mock(async (_locale: string) => {});
mock.module("@/lib/i18n/cookies", () => ({ setLocaleCookie }));

// The switcher now applies the locale with a router refresh instead of a full
// page reload, so the router is what the test has to observe.
const refresh = mock(() => {});
// Complete, per D50: `mock.module` is process-global, so a partial mock here
// deletes exports for every file that runs after it. This exact mock, carrying
// only `useRouter`, is what made `DashboardNav` and `CompactNav` fail in CI
// with "Export named 'usePathname' not found" while passing locally — the file
// order differs, and locally the landmine happened to sit behind the walker.
mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh, push: () => {} }),
  usePathname: () => "/settings",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: () => {},
}));

const reload = mock(() => {});
Object.defineProperty(window.location, "reload", {
  value: reload,
  configurable: true,
  writable: true,
});

const { LocaleSwitcher } = await import("@/components/ui/LocaleSwitcher");

beforeEach(() => {
  setLocaleCookie.mockClear();
  refresh.mockClear();
  reload.mockClear();
});

afterEach(cleanup);

describe("LocaleSwitcher", () => {
  it("renders a labelled select using the Spanish catalogue", () => {
    renderWithIntl(<LocaleSwitcher />);

    // "Idioma" is the real messages/es.json value for settings.language.
    expect(screen.getByLabelText("Idioma")).toBeInTheDocument();
  });

  it("offers Spanish and English", () => {
    renderWithIntl(<LocaleSwitcher />);

    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Español", "Inglés"]);
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual([
      "es",
      "en",
    ]);
  });

  it("defaults to the active locale", () => {
    renderWithIntl(<LocaleSwitcher />);

    expect(screen.getByLabelText("Idioma")).toHaveValue("es");
  });

  it("persists the chosen locale and refreshes without reloading", async () => {
    renderWithIntl(<LocaleSwitcher />);

    await userEvent.selectOptions(screen.getByLabelText("Idioma"), "en");

    await waitFor(() => {
      expect(setLocaleCookie).toHaveBeenCalledWith("en");
    });
    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
    // A reload would throw away anything already typed into a form on the
    // page, which is the defect this replaces (DESIGN_AUDIT A2.3).
    expect(reload).not.toHaveBeenCalled();
  });

  it("writes the cookie before refreshing", async () => {
    // The locale is read back from the cookie on the server, so refreshing
    // first would re-render in the language the user just left.
    const order: string[] = [];
    setLocaleCookie.mockImplementationOnce(async () => {
      // A server action is a network round-trip, so it does not settle in the
      // same tick. Resolving synchronously would let a `refresh()` that was
      // never awaited still land second, and the test would prove nothing.
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push("cookie");
    });
    refresh.mockImplementationOnce(() => {
      order.push("refresh");
    });

    renderWithIntl(<LocaleSwitcher />);
    await userEvent.selectOptions(screen.getByLabelText("Idioma"), "en");

    await waitFor(() => {
      expect(order).toEqual(["cookie", "refresh"]);
    });
  });

  it("does not persist anything before an interaction", () => {
    renderWithIntl(<LocaleSwitcher />);

    expect(setLocaleCookie).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("gives each instance its own id so two can share a page", () => {
    renderWithIntl(
      <>
        <LocaleSwitcher />
        <LocaleSwitcher />
      </>,
    );

    // The hardcoded id="locale-switcher" duplicated the id and pointed both
    // labels at the first select, which is why /settings could not render it.
    const selects = screen.getAllByRole("combobox");
    expect(selects).toHaveLength(2);
    expect(selects[0]?.id).not.toBe(selects[1]?.id);

    const labelled = screen.getAllByLabelText("Idioma");
    expect(labelled).toHaveLength(2);
    expect(labelled[0]).not.toBe(labelled[1]);
  });
});
