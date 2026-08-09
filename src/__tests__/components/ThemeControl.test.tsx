import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach } from "bun:test";
import { screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../utils/render";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import { ThemeControl } from "@/components/ui/ThemeControl";

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

afterEach(cleanup);

describe("ThemeControl", () => {
  it("offers three states, not a toggle", () => {
    renderWithIntl(<ThemeControl />);

    // Labels come from the real messages/es.json catalogue.
    const options = screen.getAllByRole("radio");
    expect(options.map((o) => (o as HTMLInputElement).value)).toEqual([
      "system",
      "light",
      "dark",
    ]);
    expect(screen.getByLabelText("Sistema")).toBeInTheDocument();
    expect(screen.getByLabelText("Claro")).toBeInTheDocument();
    expect(screen.getByLabelText("Oscuro")).toBeInTheDocument();
  });

  it("names the group so the three options read as one setting", () => {
    renderWithIntl(<ThemeControl />);

    expect(screen.getByRole("group", { name: "Tema" })).toBeInTheDocument();
  });

  it("starts on 'system' when nothing is stored", () => {
    renderWithIntl(<ThemeControl />);

    expect(screen.getByLabelText("Sistema")).toBeChecked();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("reflects a stored choice on mount", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    renderWithIntl(<ThemeControl />);

    await waitFor(() => {
      expect(screen.getByLabelText("Oscuro")).toBeChecked();
    });
  });

  it("ignores a stored value that is not a mode", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "solarized");
    renderWithIntl(<ThemeControl />);

    await waitFor(() => {
      expect(screen.getByLabelText("Sistema")).toBeChecked();
    });
  });

  it("sets data-theme and persists when dark is chosen", async () => {
    renderWithIntl(<ThemeControl />);

    await userEvent.click(screen.getByLabelText("Oscuro"));

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("sets data-theme=light, which switches the media query off", async () => {
    renderWithIntl(<ThemeControl />);

    await userEvent.click(screen.getByLabelText("Claro"));

    // globals.css scopes the prefers-color-scheme block to
    // :root:not([data-theme="light"]), so this is what makes an explicit light
    // choice survive a system set to dark.
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("removes the attribute again when returning to system", async () => {
    renderWithIntl(<ThemeControl />);

    await userEvent.click(screen.getByLabelText("Oscuro"));
    await userEvent.click(screen.getByLabelText("Sistema"));

    // "Follow my system" has to remain reachable after the first click; a
    // two-state switch is what destroys it (DESIGN_AUDIT A1.1).
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
  });

  it("keeps two instances in separate native radio groups", () => {
    renderWithIntl(
      <>
        <ThemeControl />
        <ThemeControl />
      </>,
    );

    const names = new Set(
      screen.getAllByRole("radio").map((r) => (r as HTMLInputElement).name),
    );
    // A shared `name` would merge the nav's control and the page's into one
    // native group, so clicking on the page would fire a change on the nav.
    expect(names.size).toBe(2);
  });

  it("keeps two instances showing the same answer", async () => {
    renderWithIntl(
      <>
        <ThemeControl />
        <ThemeControl />
      </>,
    );

    const [first, second] = screen.getAllByLabelText("Oscuro");
    await userEvent.click(first as HTMLElement);

    // /settings renders the cluster while the nav above it renders another.
    // Holding the preference in component state left the second one claiming
    // "Sistema" while the app was already dark.
    await waitFor(() => {
      expect(second).toBeChecked();
    });
    expect(first).toBeChecked();
    expect(screen.getAllByLabelText("Sistema").every((r) => !(r as HTMLInputElement).checked)).toBe(true);
  });

  it("follows a change made in another tab", async () => {
    renderWithIntl(<ThemeControl />);

    // A `storage` event only fires in the tabs that did not write the value,
    // so this is the only signal the other tab gets.
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    window.dispatchEvent(
      new StorageEvent("storage", { key: THEME_STORAGE_KEY, newValue: "light" }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Claro")).toBeChecked();
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});
