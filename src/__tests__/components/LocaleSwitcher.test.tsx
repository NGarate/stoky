import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../utils/render";

// `setLocaleCookie` is a server action; importing it for real would pull in
// `next/headers`, which has no meaning outside a request.
const setLocaleCookie = mock(async (_locale: string) => {});
mock.module("@/lib/i18n/cookies", () => ({ setLocaleCookie }));

const reload = mock(() => {});
Object.defineProperty(window.location, "reload", {
  value: reload,
  configurable: true,
  writable: true,
});

const { LocaleSwitcher } = await import("@/components/ui/LocaleSwitcher");

beforeEach(() => {
  setLocaleCookie.mockClear();
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

  it("persists the chosen locale and reloads", async () => {
    renderWithIntl(<LocaleSwitcher />);

    await userEvent.selectOptions(screen.getByLabelText("Idioma"), "en");

    await waitFor(() => {
      expect(setLocaleCookie).toHaveBeenCalledWith("en");
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not persist anything before an interaction", () => {
    renderWithIntl(<LocaleSwitcher />);

    expect(setLocaleCookie).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});
