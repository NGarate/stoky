import "../setup/matchers";
import { describe, it, expect, afterEach, mock } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "@/components/ui/button";

afterEach(cleanup);

describe("Button", () => {
  it("renders its children inside a native button element", () => {
    render(<Button>Guardar</Button>);

    const button = screen.getByRole("button", { name: "Guardar" });
    expect(button.tagName).toBe("BUTTON");
  });

  it("fires onClick when activated with the mouse", async () => {
    const onClick = mock(() => {});
    render(<Button onClick={onClick}>Guardar</Button>);

    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is activatable from the keyboard", async () => {
    const onClick = mock(() => {});
    render(<Button onClick={onClick}>Guardar</Button>);

    screen.getByRole("button").focus();
    await userEvent.keyboard("{Enter}");

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClick while disabled", async () => {
    const onClick = mock(() => {});
    render(
      <Button disabled onClick={onClick}>
        Guardar
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Guardar" });
    expect(button).toBeDisabled();

    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("applies the destructive variant styling", () => {
    render(<Button variant="destructive">Eliminar</Button>);

    expect(screen.getByRole("button")).toHaveClass("bg-destructive");
  });

  it("applies the icon size styling", () => {
    render(<Button size="icon">X</Button>);

    const button = screen.getByRole("button");
    expect(button).toHaveClass("min-h-[48px]");
    expect(button).toHaveClass("min-w-[48px]");
  });

  it("gives every size a 48px target floor", () => {
    // WCAG 2.5.5 (AAA) asks for 44; the phone is the tier where a thumb is
    // expected, so the floor is 48 and it is unprefixed rather than added back
    // at a breakpoint (DESIGN_AUDIT A4.2). Nothing measures it in a browser
    // any more, and happy-dom has no layout engine, so this can only assert
    // the class that produces it.
    for (const size of ["default", "sm", "lg", "icon"] as const) {
      cleanup();
      render(<Button size={size}>Guardar</Button>);

      const height = screen
        .getByRole("button")
        .className.match(/min-h-\[(\d+)px\]/);
      expect(Number(height?.[1] ?? 0)).toBeGreaterThanOrEqual(48);
    }
  });

  it("merges a caller-supplied className with the variant classes", () => {
    render(<Button className="mt-4">Guardar</Button>);

    const button = screen.getByRole("button");
    expect(button).toHaveClass("mt-4");
    expect(button).toHaveClass("bg-primary");
  });

  it("keeps a visible focus indicator instead of removing the outline", () => {
    // The previous version paired `outline-none` with a ring built from tokens
    // that did not exist, so keyboard focus was invisible (ISSUES UI-3.5).
    render(<Button>Guardar</Button>);

    const button = screen.getByRole("button");
    expect(button.className).not.toContain("outline-none");
    expect(button).toHaveClass("focus-visible:outline-2");
    expect(button).toHaveClass("focus-visible:outline-offset-2");
    expect(button).toHaveClass("focus-visible:outline-ring");
  });

  it("renders as the child element when asChild is set", () => {
    render(
      <Button asChild>
        <a href="/inventory">Inventario</a>
      </Button>,
    );

    const link = screen.getByRole("link", { name: "Inventario" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/inventory");
    // The variant classes are forwarded onto the anchor, not a wrapper button.
    expect(link).toHaveClass("bg-primary");
    expect(screen.queryByRole("button")).toBeAbsent();
  });

  it("forwards a ref to the underlying button", () => {
    let captured: HTMLButtonElement | null = null;
    render(
      <Button
        ref={(node) => {
          captured = node;
        }}
      >
        Guardar
      </Button>,
    );

    expect(captured).not.toBeNull();
    expect((captured as unknown as HTMLButtonElement).tagName).toBe("BUTTON");
  });

  it("forwards arbitrary button attributes such as type", () => {
    render(<Button type="submit">Enviar</Button>);

    expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
  });
});

describe("the destructive-ghost variant", () => {
  it("writes the destructive word in ink, with no fill of its own", () => {
    render(<Button variant="destructive-ghost">Eliminar</Button>);

    // A row's delete trigger. The screens wrapped a `<span className=
    // "text-destructive">` inside a ghost button to get this, and the red
    // fill is kept for the button that confirms.
    const classes = screen
      .getByRole("button", { name: "Eliminar" })
      .className.split(/\s+/);
    expect(classes).toContain("text-destructive");
    expect(classes).not.toContain("bg-destructive");
  });
});

describe("the link variant", () => {
  it("does not indent its text by a button's padding", () => {
    render(<Button variant="link">Volver al inventario</Button>);

    // Every size carries `px-4`, which is right for a button — it is a target
    // with a surface. A link has no surface, so the padding only pushed the
    // words 16px right of the column they belong to.
    const button = screen.getByRole("button", { name: "Volver al inventario" });
    expect(button.className).toContain("px-0");
  });

  it("keeps the 48px floor, which is a height rather than a width", () => {
    render(<Button variant="link">Volver al inventario</Button>);

    // Removing the horizontal padding must not be read as licence to shrink
    // the target: the floor is `min-h`, and a text link's target is its text.
    expect(
      screen.getByRole("button", { name: "Volver al inventario" }).className,
    ).toContain("min-h-[48px]");
  });

  it("is underlined at rest, not only under the pointer", () => {
    render(<Button variant="link">Volver al inventario</Button>);

    // Colour was the only thing telling these apart from the sentence around
    // them, and `primary` against body ink measured 1.78:1 light and 1.36:1
    // dark — under the 3:1 that 1.4.1 asks of a colour-only cue. A touch
    // screen has no hover, so `hover:underline` was no cue at all. The rule
    // now matches `ItemRow`'s title and `BackLink`: a link is underlined.
    const className = screen
      .getByRole("button", {
        name: "Volver al inventario",
      })
      .className.split(/\s+/);
    expect(className).toContain("underline");
    expect(className).not.toContain("hover:underline");
  });

  it("leaves every other variant padded", () => {
    render(<Button variant="outline">Cancelar</Button>);

    expect(
      screen.getByRole("button", { name: "Cancelar" }).className,
    ).toContain("px-4");
  });
});
