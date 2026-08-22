import "../setup/matchers";
import { describe, it, expect, afterEach } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { FormErrorSummary } from "@/components/ui/form-error-summary";

/**
 * The summary that stays.
 *
 * Rendered with plain `render` and no intl provider, which is itself an
 * assertion: it takes already-translated strings. A key prop would slip past
 * both scanners in `message-usage.test.ts` — `t("…")` calls and `key:` data
 * literals — and silently unguard five catalogue entries.
 */
afterEach(cleanup);

function Harness(): React.JSX.Element {
  const [signal, setSignal] = useState(0);
  const [extra, setExtra] = useState(0);
  return (
    <>
      <button onClick={() => setSignal((n) => n + 1)} type="button">
        refuse
      </button>
      <button onClick={() => setExtra((n) => n + 1)} type="button">
        rerender
      </button>
      <span>{extra}</span>
      <FormErrorSummary
        focusSignal={signal}
        messages={["Elige un producto.", "Escribe una cantidad."]}
        title="No se ha podido guardar"
      />
    </>
  );
}

describe("FormErrorSummary", () => {
  it("renders nothing when there is nothing to say", () => {
    render(
      <FormErrorSummary focusSignal={0} messages={[]} title="No se ha podido guardar" />,
    );

    expect(screen.queryByRole("alert")).toBeAbsent();
  });

  it("lists every reason, in the order given", () => {
    render(
      <FormErrorSummary
        focusSignal={0}
        messages={["Elige un producto.", "Escribe una cantidad."]}
        title="No se ha podido guardar"
      />,
    );

    const items = screen.getAllByRole("listitem").map((n) => n.textContent);
    expect(items).toEqual(["Elige un producto.", "Escribe una cantidad."]);
  });

  it("is focusable, which a plain div is not", () => {
    render(
      <FormErrorSummary
        focusSignal={0}
        messages={["Elige un producto."]}
        title="No se ha podido guardar"
      />,
    );

    // The attribute, not the focus: happy-dom will focus a div without one,
    // so an assertion about `activeElement` stays green after `tabIndex` is
    // deleted — while a real browser refuses.
    expect(screen.getByRole("alert").getAttribute("tabindex")).toBe("-1");
  });

  it("can be named without getByRole('alert')", () => {
    render(
      <FormErrorSummary
        focusSignal={0}
        messages={["Elige un producto."]}
        title="No se ha podido guardar"
      />,
    );

    // Next's route announcer is also a role=alert, so a browser test asking
    // by role gets two elements and a strict-mode violation.
    expect(screen.getByTestId("form-error-summary")).toBeInTheDocument();
  });

  it("does not steal focus on mount, having refused nothing yet", () => {
    render(<Harness />);

    expect(screen.getByRole("alert")).not.toHaveFocus();
  });

  it("takes focus when the form refuses", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "refuse" }));

    expect(screen.getByRole("alert")).toHaveFocus();
  });

  it("takes it again on an identical second refusal", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "refuse" }));
    (document.activeElement as HTMLElement).blur();
    expect(screen.getByRole("alert")).not.toHaveFocus();

    // Submit, read nothing, submit again — the common case, and the reason
    // the signal is a counter rather than the messages themselves. Keyed on
    // `messages` this would never fire: same contents, same list.
    fireEvent.click(screen.getByRole("button", { name: "refuse" }));

    expect(screen.getByRole("alert")).toHaveFocus();
  });

  it("does not re-take focus on an unrelated rerender", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "refuse" }));
    (document.activeElement as HTMLElement).blur();

    fireEvent.click(screen.getByRole("button", { name: "rerender" }));

    // Keyed on the array's identity this would fire on every render, and the
    // page would steal focus on each keystroke.
    expect(screen.getByRole("alert")).not.toHaveFocus();
  });
});
