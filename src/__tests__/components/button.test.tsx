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
    expect(button).toHaveClass("h-10");
    expect(button).toHaveClass("w-10");
  });

  it("merges a caller-supplied className with the variant classes", () => {
    render(<Button className="mt-4">Guardar</Button>);

    const button = screen.getByRole("button");
    expect(button).toHaveClass("mt-4");
    expect(button).toHaveClass("bg-primary");
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
    expect(screen.queryByRole("button")).toBeNull();
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
