import "../setup/matchers";
import { describe, it, expect, afterEach, mock } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input } from "@/components/ui/input";

afterEach(cleanup);

describe("Input", () => {
  it("renders an input associated with its label", () => {
    render(
      <>
        <label htmlFor="email">Correo</label>
        <Input id="email" />
      </>,
    );

    expect(screen.getByLabelText("Correo")).toBeInTheDocument();
  });

  it("accepts typed text", async () => {
    render(<Input placeholder="Nombre" />);

    const input = screen.getByPlaceholderText("Nombre");
    await userEvent.type(input, "Leche entera");

    expect(input).toHaveValue("Leche entera");
  });

  it("calls onChange for each keystroke", async () => {
    const onChange = mock(() => {});
    render(<Input placeholder="Nombre" onChange={onChange} />);

    await userEvent.type(screen.getByPlaceholderText("Nombre"), "abc");

    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("forwards the type attribute", () => {
    render(<Input type="password" placeholder="Contraseña" />);

    expect(screen.getByPlaceholderText("Contraseña")).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("rejects input while disabled", async () => {
    render(<Input disabled placeholder="Nombre" />);

    const input = screen.getByPlaceholderText("Nombre");
    expect(input).toBeDisabled();

    await userEvent.type(input, "algo");
    expect(input).toHaveValue("");
  });

  it("supports required and name for native form semantics", () => {
    render(<Input name="email" required placeholder="Correo" />);

    const input = screen.getByPlaceholderText("Correo");
    expect(input).toBeRequired();
    expect(input).toHaveAttribute("name", "email");
  });

  it("merges a caller-supplied className with the base classes", () => {
    render(<Input className="mt-2" placeholder="Nombre" />);

    const input = screen.getByPlaceholderText("Nombre");
    expect(input).toHaveClass("mt-2");
    expect(input).toHaveClass("rounded-md");
  });

  it("forwards a ref to the underlying input", () => {
    let captured: HTMLInputElement | null = null;
    render(
      <Input
        ref={(node) => {
          captured = node;
        }}
      />,
    );

    expect(captured).not.toBeNull();
    expect((captured as unknown as HTMLInputElement).tagName).toBe("INPUT");
  });
});
