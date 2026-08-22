import "../setup/matchers";
import { describe, it, expect, afterEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import { Badge } from "@/components/ui/badge";
import { ItemRow } from "@/components/ui/item-row";
import { minimumHeight } from "../setup/tailwind";

/**
 * The one list row. Lifted from `/inventory`, which is the screen the owner
 * picked, and now the shape every list is required to take.
 *
 * What these pin is the grammar, not the pixels: a title that links to the
 * thing, a status opposite it, the details as a two-column definition list
 * underneath, and actions last. A screen that needs a different arrangement
 * needs a conversation, not a fourth `<li>` of its own.
 */
afterEach(cleanup);

const id = "p1";

const list = (children: React.ReactNode) => render(<ul>{children}</ul>);

describe("ItemRow", () => {
  it("links the title, not the row", () => {
    list(<ItemRow href={`/products/${id}`} title="Café molido" />);

    // A row that is entirely a link announces its whole contents as its name
    // — "Café molido, categoría café, 0 paquete, sin stock" — and leaves
    // nowhere to put an action.
    const link = screen.getByRole("link", { name: "Café molido" });
    expect(link.getAttribute("href")).toBe("/products/p1");
  });

  it("renders a title with no link when there is nowhere to go", () => {
    list(<ItemRow title="Café molido" />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Café molido")).toBeInTheDocument();
  });

  it("renders the details as a definition list, label paired with value", () => {
    const { container } = list(
      <ItemRow
        meta={[
          { label: "Stock total", value: "0 paquete" },
          { label: "Categoría", value: "Café" },
        ]}
        title="Café molido"
      />,
    );

    const terms = [...container.querySelectorAll("dt")].map((n) => n.textContent);
    const values = [...container.querySelectorAll("dd")].map((n) => n.textContent);
    expect(terms).toEqual(["Stock total", "Categoría"]);
    expect(values).toEqual(["0 paquete", "Café"]);
  });

  it("omits the definition list rather than rendering an empty one", () => {
    const { container } = list(<ItemRow meta={[]} title="Café molido" />);

    expect(container.querySelector("dl")).toBeNull();
  });

  it("carries the status and the actions it is given", () => {
    list(
      <ItemRow
        actions={<button type="button">Apuntar</button>}
        status={<Badge tone="danger">Sin stock</Badge>}
        title="Café molido"
      />,
    );

    expect(screen.getByText("Sin stock")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apuntar" })).toBeInTheDocument();
  });

  it("tints the row for a state, and never only tints it", () => {
    const { container } = list(
      <ItemRow
        status={<Badge tone="warn" variant="outline">Stock bajo</Badge>}
        title="Café molido"
        tone="warn"
      />,
    );

    expect(container.querySelector("li")?.className).toContain("bg-warn");
    // REDESIGN_PLAN §8: colour is never the only carrier. The word is there.
    expect(screen.getByText("Stock bajo")).toBeInTheDocument();
  });

  it("is an <li>, because every list here is a list", () => {
    const { container } = list(<ItemRow title="Café molido" />);

    expect(container.querySelector("ul > li")).not.toBeNull();
  });
});

describe("ItemRow densities", () => {
  it("gives the two screens read at arm's length a floor of their own", async () => {
    const { container } = list(<ItemRow density="touch" title="Café" />);
    const className = container.querySelector("li")!.className;

    // Screen A is used with a trolley in one hand and Screen B is read from a
    // metre away (REDESIGN_PLAN §3). One size for all three tiers would be
    // wrong on two of them, so `touch` declares a floor the other two do not.
    const height = await minimumHeight(className);
    expect(height, `resolved from: ${className}`).toBeGreaterThanOrEqual(64);
  });

  it("lets the desktop densities size to their content", async () => {
    for (const density of ["compact", "default"] as const) {
      cleanup();
      const { container } = list(<ItemRow density={density} title="Café" />);
      const className = container.querySelector("li")!.className;

      // No declared minimum: a row of one line should be one line tall. The
      // 48px obligation belongs to the things inside it you can press.
      expect(await minimumHeight(className)).toBeUndefined();
    }
  });

  for (const density of ["compact", "default", "touch"] as const) {
    it(`keeps the ${density} title above the 48px floor`, async () => {
      list(<ItemRow density={density} href={`/products/${id}`} title="Café" />);

      const className = screen.getByRole("link").className;
      const height = await minimumHeight(className);

      expect(
        height,
        `density="${density}" resolved to ${height}px from: ${className}`,
      ).toBeGreaterThanOrEqual(48);
    });
  }

  it("keeps a short title a target in both directions", async () => {
    list(<ItemRow href={`/products/${id}`} title="Pan" />);

    // A target is 48px wide as well as tall, and a short name is not: "Lidl"
    // measured 25×48 on the receipts list and the structural browser audit
    // failed it at every tier. Height alone is half a guarantee.
    const className = screen.getByRole("link").className;
    expect(className).toContain("min-w-[48px]");
    expect(await minimumHeight(className)).toBeGreaterThanOrEqual(48);
  });
});
