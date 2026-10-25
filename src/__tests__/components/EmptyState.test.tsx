import "../setup/matchers";
import { describe, it, expect, afterEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

afterEach(cleanup);

/** True when `a` comes before `b` in document order. */
function precedes(a: Node, b: Node): boolean {
  return Boolean(
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe("EmptyState", () => {
  it("says what is missing, how things get here, then what to do — in that order", () => {
    render(
      <EmptyState
        action={<Button type="button">Crear lista</Button>}
        body="Crea una para apuntar lo que hace falta."
        title="Todavía no tienes listas"
      />,
    );

    const title = screen.getByText("Todavía no tienes listas");
    const body = screen.getByText("Crea una para apuntar lo que hace falta.");
    const action = screen.getByRole("button", { name: "Crear lista" });

    expect(precedes(title, body)).toBe(true);
    expect(precedes(body, action)).toBe(true);
  });

  it("draws no heading, so it cannot break the outline of the screen around it", () => {
    const { container } = render(<EmptyState title="No hay tiendas" />);

    expect(container.querySelector("h1, h2, h3, h4, h5, h6")).toBeNull();
  });

  it("draws only what it was given", () => {
    const { container } = render(<EmptyState title="No hay tiendas" />);

    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelector("button")).toBeNull();
  });

  it("is left-aligned, where the first row would have been", () => {
    const { container } = render(<EmptyState title="No hay tiendas" />);

    expect(container.innerHTML).not.toContain("text-center");
  });

  it("is larger at the kitchen's distance", () => {
    render(
      <EmptyState
        body="Nada caduca esta semana."
        density="touch"
        title="Esta semana"
      />,
    );

    expect(screen.getByText("Esta semana").className).toContain("text-2xl");
    expect(screen.getByText("Nada caduca esta semana.").className).toContain(
      "text-xl",
    );
  });
});
