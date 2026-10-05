import "../setup/matchers";
import { describe, it, expect, afterEach, mock } from "bun:test";
import { cleanup, screen } from "@testing-library/react";
import { renderWithIntl } from "../utils/render";

/**
 * The drafted-list panel is a call to action, not a warning.
 *
 * It was a `bg-warn` panel with `text-warn-foreground` copy — the
 * needs-attention tone, which CLAUDE.md reserves for state, spent on news
 * that is merely useful.
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
              { id: "i2", isChecked: false },
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

describe("AutoListPreview", () => {
  it("offers the drafted list without wearing a state's tone", () => {
    const { container } = renderWithIntl(<AutoListPreview />, { locale: "es" });

    expect(screen.getByRole("link")).toHaveAttribute("href", "/shopping/auto-1");
    for (const node of container.querySelectorAll("*")) {
      expect(node.getAttribute("class") ?? "").not.toMatch(
        /\b(?:text|bg|border)-(?:ok|warn|danger)(?:-foreground)?\b/,
      );
    }
  });
});
