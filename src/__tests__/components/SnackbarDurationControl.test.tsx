import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { act, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../utils/render";

/**
 * How long a confirmation stays is an account setting, not a device one.
 *
 * WCAG 2.2.1 asks that a time limit be adjustable, and the adjustment is about
 * the person: somebody who needs longer to read a message needs longer on the
 * phone in the shop as well as on the kitchen tablet. It lived in
 * `localStorage`, so it was a property of the browser and went with the
 * browser's storage.
 *
 * Two properties, and they pull in opposite directions, which is why both are
 * asserted here rather than one being assumed from the other:
 *
 * - the choice takes effect **immediately and unconditionally**, because a
 *   preference that waits for a round trip is a preference with a spinner;
 * - the choice is **also sent to the account**, because otherwise it is the
 *   device setting this stopped being.
 */
const written: unknown[] = [];

mock.module("@/lib/trpc/client", () => ({
  api: {
    auth: {
      setSnackbarDuration: {
        useMutation: () => ({
          mutate: (input: unknown) => void written.push(input),
          isPending: false,
        }),
      },
    },
  },
}));

const {
  DEFAULT_SNACKBAR_DURATION,
  SNACKBAR_DURATION_STORAGE_KEY,
  getSnackbarDurationSnapshot,
  hydrateSnackbarDuration,
} = await import("@/lib/snackbar-duration");

const { SnackbarDurationControl } = await import(
  "@/components/ui/SnackbarDurationControl"
);

beforeEach(() => {
  written.length = 0;
  window.localStorage.clear();
  hydrateSnackbarDuration(DEFAULT_SNACKBAR_DURATION);
});

afterEach(cleanup);

describe("SnackbarDurationControl", () => {
  it("offers the three the snackbar can honour, and names the group", () => {
    renderWithIntl(<SnackbarDurationControl />);

    expect(
      screen.getAllByRole("radio").map((o) => (o as HTMLInputElement).value),
    ).toEqual(["default", "long", "forever"]);
    expect(
      screen.getByRole("group", { name: "Duración de los avisos" }),
    ).toBeInTheDocument();
  });

  it("says it also sets how long there is to undo", () => {
    // The undo window follows this choice (`undoHoldMs`), which nobody could
    // know from three words on three buttons. Said where the choice is made,
    // and attached to the group so a screen reader hears it with the name.
    renderWithIntl(<SnackbarDurationControl />);

    const group = screen.getByRole("group", { name: "Duración de los avisos" });
    const describedBy = group.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(describedBy)?.textContent).toBe(
      "También es el tiempo para deshacer: 10, 30 o 60 segundos.",
    );
  });

  it("records the choice against the account", async () => {
    renderWithIntl(<SnackbarDurationControl />);

    await userEvent.click(screen.getByLabelText("Hasta descartar"));

    expect(written).toEqual([{ snackbarDuration: "forever" }]);
  });

  it("applies the choice before the server has answered", async () => {
    renderWithIntl(<SnackbarDurationControl />);

    await userEvent.click(screen.getByLabelText("Larga"));

    // The mutation mock never resolves anything; the store has moved anyway.
    // A preference that waits for a round trip is a preference with a spinner.
    expect(getSnackbarDurationSnapshot()).toBe("long");
    await waitFor(() => {
      expect(screen.getByLabelText("Larga")).toBeChecked();
    });
  });

  it("keeps a copy on the device, so the first paint is right", async () => {
    renderWithIntl(<SnackbarDurationControl />);

    await userEvent.click(screen.getByLabelText("Larga"));

    // A cache for the render before the account's answer arrives — not a
    // second source of truth, which is what `hydrateSnackbarDuration` exists
    // to guarantee.
    expect(window.localStorage.getItem(SNACKBAR_DURATION_STORAGE_KEY)).toBe(
      "long",
    );
  });

  it("shows the account's answer, not the device's, once it arrives", async () => {
    window.localStorage.setItem(SNACKBAR_DURATION_STORAGE_KEY, "long");
    renderWithIntl(<SnackbarDurationControl />);

    // What `PreferencesSync` does with the value the shell read on the server.
    // In `act`, because it is an external store telling a mounted component
    // its snapshot moved — the same thing the effect does in production.
    act(() => hydrateSnackbarDuration("forever"));

    await waitFor(() => {
      expect(screen.getByLabelText("Hasta descartar")).toBeChecked();
    });
    // And the device cache has followed it, rather than staying to disagree
    // on the next load.
    expect(window.localStorage.getItem(SNACKBAR_DURATION_STORAGE_KEY)).toBe(
      "forever",
    );
  });

  it("does not write back what the account just told it", () => {
    renderWithIntl(<SnackbarDurationControl />);

    act(() => hydrateSnackbarDuration("forever"));

    // Hydration is the server talking to the client. Sending it straight back
    // would be a mutation on every page load.
    expect(written).toEqual([]);
  });

  it("falls back to the default when the account holds something unusable", () => {
    renderWithIntl(<SnackbarDurationControl />);

    // The column is TEXT. A row edited by hand must not leave the snackbar
    // with a duration it cannot honour.
    act(() => hydrateSnackbarDuration("eternity"));

    expect(getSnackbarDurationSnapshot()).toBe(DEFAULT_SNACKBAR_DURATION);
  });
});
