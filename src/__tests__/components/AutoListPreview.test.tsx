import "../setup/matchers";
import { describe, it, expect, afterEach, mock } from "bun:test";
import { cleanup, screen } from "@testing-library/react";
import { renderWithIntl } from "../utils/render";

/**
 * The automatic list's preview on `/shopping/lists`.
 *
 * Two defects, one each:
 * - It was a `bg-warn` panel with `text-warn-foreground` copy — the
 *   needs-attention tone, which CLAUDE.md reserves for state, spent on news
 *   that is merely useful. It is a call to action, not a warning.
 * - Its link said "Ver" — a link whose purpose came only from the heading
 *   beside it, which a screen reader's list of links does not read (WCAG
 *   2.4.9, the AAA link-purpose rule `e2e/a11y-aaa.spec.ts` enforces where it
 *   can see one).
 */
mock.module("@/lib/trpc/client", () => ({
  api: {
    shopping: {
      getAutoList: {
        useQuery: () => ({
          data: {
            id: "auto-1",
            items: [
              { id: "i1", isChecked: false },
              { id: "i2", isChecked: true },
            ],
          },
          isLoading: false,
        }),
      },
    },
  },
}));

const { AutoListPreview } = await import("@/components/shopping/AutoListPreview");

afterEach(cleanup);

describe("the automatic list's preview", () => {
  it("offers the drafted list without wearing a state's tone", () => {
    const { container } = renderWithIntl(<AutoListPreview />, { locale: "es" });

    expect(screen.getByRole("link")).toHaveAttribute("href", "/shopping/auto-1");
    for (const node of container.querySelectorAll("*")) {
      expect(node.getAttribute("class") ?? "").not.toMatch(
        /\b(?:text|bg|border)-(?:ok|warn|danger)(?:-foreground)?\b/,
      );
    }
  });

  it("names the list its link opens", () => {
    renderWithIntl(<AutoListPreview />, { locale: "es" });

    expect(
      screen.getByRole("link", { name: "Ver la lista automática" }),
    ).toHaveAttribute("href", "/shopping/auto-1");
  });
});
