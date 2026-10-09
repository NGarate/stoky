import "../setup/matchers";
import { describe, it, expect, afterEach, mock } from "bun:test";
import { cleanup, screen } from "@testing-library/react";
import { renderWithIntl } from "../utils/render";
import { minimumHeight } from "../setup/tailwind";

/**
 * The shop picker wears the `Select` primitive.
 *
 * It was a raw `<select>` with `bg-card`, no focus outline of its own and no
 * target floor, so both of its callers restated `min-h-[48px]`.
 */
mock.module("@/lib/trpc/client", () => ({
  api: {
    store: {
      list: {
        useQuery: () => ({
          data: [{ id: "s1", name: "Mercadona" }],
          isLoading: false,
        }),
      },
    },
  },
}));

const { StoreSelector } = await import("@/components/store/StoreSelector");

afterEach(cleanup);

describe("StoreSelector", () => {
  it("owns its own 48px floor, focus outline and field fill", async () => {
    renderWithIntl(<StoreSelector id="store" onChange={() => {}} />, {
      locale: "es",
    });

    const select = screen.getByRole("combobox");
    expect(await minimumHeight(select.className)).toBeGreaterThanOrEqual(48);
    expect(select.className).toContain("focus-visible:outline-ring");
    expect(select.className).toContain("bg-background");
    expect(select.className).not.toContain("bg-card");
    expect(screen.getByRole("option", { name: "Mercadona" })).toBeInTheDocument();
  });
});
