import "../setup/matchers";
import { describe, it, expect, afterAll, afterEach, mock } from "bun:test";
import { cleanup, screen, within } from "@testing-library/react";
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
  it("offers the retry Next hands it", async () => {
    // `retry` is the only thing that can bring the segment back without a full
    // reload, and a boundary that does not wire it up is a dead end with
    // sympathetic wording.
    const retry = mock(() => {});
    renderWithIntl(<DashboardError error={FAILURE} retry={retry} />);

    await userEvent.click(screen.getByRole("button", { name: "Volver a intentarlo" }));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("retries by fetching again, not by re-rendering what failed", async () => {
    // In this Next `reset` re-renders without re-fetching, so a screen that
    // failed because the server did failed the same way again. Both props
    // are handed to the boundary; only `retry` can recover.
    const retry = mock(() => {});
    const reset = mock(() => {});
    renderWithIntl(
      <DashboardError error={FAILURE} {...({ reset } as object)} retry={retry} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Volver a intentarlo" }));

    expect(retry).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });

  it("offers a way out that does not depend on this segment working", () => {
    // If `reset` throws again — the usual case, since the cause is rarely
    // transient — a link to a different route is the only escape.
    renderWithIntl(<DashboardError error={FAILURE} retry={() => {}} />);

    expect(
      screen.getByRole("link", { name: "Ir al inicio" }),
    ).toHaveAttribute("href", "/dashboard");
  });

  it("says nothing was lost, because nothing was", () => {
    // The first thought after a screen vanishes is "did I just lose that?", and
    // with the offline queue behind it the honest answer is no. Saying so is
    // the difference between an apology and an answer.
    const { container } = renderWithIntl(
      <DashboardError error={FAILURE} retry={() => {}} />,
    );

    expect(container.textContent).toContain("nada de lo que hayas apuntado se ha perdido");
  });

  it("shows the digest, which is the only thread back to the server log", () => {
    renderWithIntl(<DashboardError error={FAILURE} retry={() => {}} />);

    expect(screen.getByText(/1975821282/)).toBeInTheDocument();
  });

  it("says nothing about a reference it was not given", () => {
    // A client-side throw has no digest. "Fault reference: undefined" is worse
    // than no reference at all.
    const { container } = renderWithIntl(
      <DashboardError error={new Error("boom")} retry={() => {}} />,
    );

    expect(container.textContent).not.toContain("Referencia");
    expect(container.textContent).not.toContain("undefined");
  });

  it("logs the failure rather than swallowing it", () => {
    renderWithIntl(<DashboardError error={FAILURE} retry={() => {}} />);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((args) => args.includes(FAILURE))).toBe(true);
  });
});

describe("in English", () => {
  it("speaks the reader's language", () => {
    // The reason this boundary sits under `(dashboard)` rather than at the
    // root: the intl provider is in the root layout, and a boundary replaces
    // everything below the segment it lives in.
    renderWithIntl(<DashboardError error={FAILURE} retry={() => {}} />, {
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
    renderWithIntl(<DashboardError error={FAILURE} retry={() => {}} />);

    for (const control of [
      screen.getByRole("button", { name: "Volver a intentarlo" }),
      screen.getByRole("link", { name: "Ir al inicio" }),
    ]) {
      expect(control.className).toContain("min-h-[48px]");
    }
  });
});

/**
 * Rendering the global boundary, into a container of its own that is **not in
 * the document**.
 *
 * `GlobalError` supplies its own `<html>` and `<body>` — that is the whole
 * point of it, since it stands in for the root layout. Testing Library's
 * default container is a `<div>` appended to `document.body`, so the default
 * render grafts a second `<html>` *inside* the live one, and every query,
 * every event dispatch and every accessibility computation afterwards is
 * walking a document that cannot exist in a browser.
 *
 * That is not a tidiness point. Clicking inside that nested document wedges
 * the runner: the tests all pass, and then the process spins at 100% of a
 * core and never exits, so the run dies on the ten-minute budget with no
 * output at all. It took a bisection to find, because the symptom appears in
 * whatever *other* file happens to push the run past the threshold — the
 * suite was green until an unrelated screen grew a twelfth test, and the
 * failure it then reported was "the component suite is stuck", pointing at
 * nothing.
 *
 * It is the same family as the trap `setup/matchers.ts` documents: a happy-dom
 * node graph that something walks, in a walk with no useful bound. The fix is
 * the same shape too — do not hand it the graph. A detached container keeps
 * the nested document out of the live one, and the assertions are unchanged.
 */
function renderGlobalError(retry: () => void = () => {}): HTMLElement {
  const { container } = renderWithIntl(
    <GlobalError error={FAILURE} retry={retry} />,
    // Deliberately never appended: see above.
    { container: document.createElement("div") },
  );
  return container;
}

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
    const container = renderGlobalError();

    expect(container.textContent).toContain("no ha podido arrancar");
    expect(container.textContent).toContain("could not start");
  });

  it("still offers the retry, the one that fetches again", async () => {
    const retry = mock(() => {});
    const reset = mock(() => {});
    // `within(container)` rather than `screen`, which reads `document.body` —
    // and the container is deliberately not in it.
    const { container } = renderWithIntl(
      <GlobalError error={FAILURE} {...({ reset } as object)} retry={retry} />,
      { container: document.createElement("div") },
    );

    await userEvent.click(within(container).getByRole("button"));

    expect(retry).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
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
