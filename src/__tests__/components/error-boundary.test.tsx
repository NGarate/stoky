import "../setup/matchers";
import { describe, it, expect, afterAll, afterEach, mock } from "bun:test";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../utils/render";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import DashboardError from "@/app/(dashboard)/error";
import GlobalError from "@/app/global-error";

/**
 * What a screen shows when its render throws.
 *
 * There was no boundary anywhere in `src/app`. In development that means Next's
 * overlay, which is fine; in production it means "Application error: a
 * client-side exception has occurred" on a blank page — no navigation renders,
 * so there is nothing left to click. On a household's own server that is the
 * end of the session.
 *
 * The assertions are about what the page lets a person *do*, not about its
 * wording, because the wording is the part most likely to be improved later and
 * the least likely to be the thing that breaks.
 */

/** Boundaries are the one place a console.error is expected, not a smell. */
const errors: unknown[][] = [];
const realError = console.error;
console.error = (...args: unknown[]) => {
  errors.push(args);
};

afterEach(() => {
  errors.length = 0;
  cleanup();
});

// Restored here rather than on process exit: bun runs the suite in one process,
// so a `console.error` left replaced would silently mute every file that runs
// after this one (D50 is the same lesson about `mock.module`).
afterAll(() => {
  console.error = realError;
});

const FAILURE = Object.assign(new Error("boom"), { digest: "1975821282" });

describe("when a screen fails to render", () => {
  it("offers the retry React hands it", async () => {
    // `reset` is the only thing that can bring the segment back without a full
    // reload, and a boundary that does not wire it up is a dead end with
    // sympathetic wording.
    const reset = mock(() => {});
    renderWithIntl(<DashboardError error={FAILURE} reset={reset} />);

    await userEvent.click(screen.getByRole("button", { name: "Volver a intentarlo" }));

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("offers a way out that does not depend on this segment working", () => {
    // If `reset` throws again — the usual case, since the cause is rarely
    // transient — a link to a different route is the only escape.
    renderWithIntl(<DashboardError error={FAILURE} reset={() => {}} />);

    expect(
      screen.getByRole("link", { name: "Ir al inicio" }),
    ).toHaveAttribute("href", "/dashboard");
  });

  it("says nothing was lost, because nothing was", () => {
    // The first thought after a screen vanishes is "did I just lose that?", and
    // with the offline queue behind it the honest answer is no. Saying so is
    // the difference between an apology and an answer.
    const { container } = renderWithIntl(
      <DashboardError error={FAILURE} reset={() => {}} />,
    );

    expect(container.textContent).toContain("nada de lo que hayas apuntado se ha perdido");
  });

  it("shows the digest, which is the only thread back to the server log", () => {
    renderWithIntl(<DashboardError error={FAILURE} reset={() => {}} />);

    expect(screen.getByText(/1975821282/)).toBeInTheDocument();
  });

  it("says nothing about a reference it was not given", () => {
    // A client-side throw has no digest. "Fault reference: undefined" is worse
    // than no reference at all.
    const { container } = renderWithIntl(
      <DashboardError error={new Error("boom")} reset={() => {}} />,
    );

    expect(container.textContent).not.toContain("Referencia");
    expect(container.textContent).not.toContain("undefined");
  });

  it("logs the failure rather than swallowing it", () => {
    renderWithIntl(<DashboardError error={FAILURE} reset={() => {}} />);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((args) => args.includes(FAILURE))).toBe(true);
  });
});

describe("in English", () => {
  it("speaks the reader's language", () => {
    // The reason this boundary sits under `(dashboard)` rather than at the
    // root: the intl provider is in the root layout, and a boundary replaces
    // everything below the segment it lives in.
    renderWithIntl(<DashboardError error={FAILURE} reset={() => {}} />, {
      locale: "en",
    });

    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });
});

describe("the controls a thumb has to hit", () => {
  it("keeps the 48px floor, on the screen where it matters most", () => {
    // A person meeting this page on a phone is already having a bad time.
    renderWithIntl(<DashboardError error={FAILURE} reset={() => {}} />);

    for (const control of [
      screen.getByRole("button", { name: "Volver a intentarlo" }),
      screen.getByRole("link", { name: "Ir al inicio" }),
    ]) {
      expect(control.className).toContain("min-h-[48px]");
    }
  });
});

/**
 * The last resort, which replaces the root layout rather than rendering inside
 * it — so it has no intl provider, no theme and no stylesheet.
 *
 * Everything asserted here is a consequence of that. It is not a wording test:
 * it is a test that this file never grows a dependency on something that will
 * not be there when it is needed.
 */
describe("when even the layout failed", () => {
  it("says its piece in both languages, because it cannot know which to use", () => {
    const { container } = renderWithIntl(
      <GlobalError error={FAILURE} reset={() => {}} />,
    );

    expect(container.textContent).toContain("no ha podido arrancar");
    expect(container.textContent).toContain("could not start");
  });

  it("still offers the retry", async () => {
    const reset = mock(() => {});
    renderWithIntl(<GlobalError error={FAILURE} reset={reset} />);

    await userEvent.click(screen.getByRole("button"));

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("carries no translation call and no utility class", () => {
    // The two ways this page fails silently: `useTranslations` throws outside
    // the provider, and a Tailwind class has no rules behind it because the
    // stylesheet is loaded by the layout this is standing in for — the page
    // would render as unstyled text. Both are invisible in a test that only
    // renders it, so they are checked as source facts.
    const source = readFileSync(
      join(import.meta.dir, "../../app/global-error.tsx"),
      "utf8",
    );

    // The imports and the JSX, not the prose: the docblock names both of these
    // to explain why they are absent, and a substring check would read its own
    // explanation as the violation.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

    expect(code).not.toContain("next-intl");
    expect(code).not.toContain("className");
  });
});
