import "../setup/matchers";
import { describe, it, expect, afterEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import { BackLink } from "@/components/ui/back-link";

afterEach(cleanup);

// Written as the pages write it. `check-links.ts` scans the test tree too and
// collapses `${expr}` to the same placeholder as `[id]`, so a bare
// "/products/p1" reads to it as a route that does not exist.
const id = "p1";

describe("BackLink", () => {
  it("stays a link, because it goes somewhere", () => {
    render(<BackLink href={`/products/${id}`}>Volver al producto</BackLink>);

    const link = screen.getByRole("link", { name: "Volver al producto" });
    expect(link.getAttribute("href")).toBe("/products/p1");
  });

  it("draws an arrow, which is what was missing", () => {
    const { container } = render(
      <BackLink href={`/products/${id}`}>Volver al producto</BackLink>,
    );

    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("keeps the arrow out of the accessible name", () => {
    render(<BackLink href={`/products/${id}`}>Volver al producto</BackLink>);

    // WCAG 2.4.9 wants the purpose from the text alone, and "flecha
    // izquierda volver al producto" is noise read aloud. `name` here is the
    // *computed* accessible name and the match is exact, so anything the
    // icon contributes — a title, an aria-label, a stray label — fails this.
    expect(
      screen.getByRole("link", { name: "Volver al producto" }),
    ).toBeInTheDocument();
  });

  it("clears the 48px target floor without the page restating it", () => {
    render(<BackLink href={`/products/${id}`}>Volver al producto</BackLink>);

    expect(
      screen.getByRole("link", { name: "Volver al producto" }).className,
    ).toContain("min-h-[48px]");
  });
});
