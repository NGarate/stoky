import "../setup/matchers";
import { describe, it, expect, afterEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import { Badge } from "@/components/ui/badge";

/**
 * The pill that says what state something is in.
 *
 * Seven of these existed separately — three on the price screens, one per
 * list, one per dashboard section — in four sizes and two roundings. What
 * these tests pin is the part that made that a bug rather than untidiness:
 * every tone keeps the foreground `check-contrast.ts` measured for it, so no
 * badge can invent a colour pair nothing audits.
 */
afterEach(cleanup);

const AUDITED: Array<[Parameters<typeof Badge>[0]["tone"], string, string]> = [
  ["ok", "bg-ok", "text-ok-foreground"],
  ["warn", "bg-warn", "text-warn-foreground"],
  ["danger", "bg-danger", "text-danger-foreground"],
  ["neutral", "bg-muted", "text-muted-foreground"],
];

describe("Badge", () => {
  it("always carries the word, because colour is never the message", () => {
    render(<Badge tone="danger">Sin stock</Badge>);

    expect(screen.getByText("Sin stock")).toBeInTheDocument();
  });

  for (const [tone, surface, ink] of AUDITED) {
    it(`pairs ${tone} with the foreground the audit measured for it`, () => {
      render(<Badge tone={tone}>Estado</Badge>);

      const className = screen.getByText("Estado").className;
      expect(className).toContain(surface);
      expect(className).toContain(ink);
    });
  }

  it("drops the fill when outlined, so it survives a row of its own tone", () => {
    render(
      <Badge tone="warn" variant="outline">
        Stock bajo
      </Badge>,
    );

    const className = screen.getByText("Stock bajo").className;
    // The inventory card that produced this rule is already `bg-warn`; a
    // filled warn pill on it is not there.
    expect(className).not.toContain("bg-warn");
    expect(className).toContain("border-warn-foreground");
    expect(className).toContain("text-warn-foreground");
  });

  it("keeps one size and one rounding across every tone", () => {
    const classNames = AUDITED.map(([tone]) => {
      cleanup();
      render(<Badge tone={tone}>Estado</Badge>);
      return screen.getByText("Estado").className;
    });

    for (const className of classNames) {
      expect(className).toContain("rounded");
      expect(className).toContain("px-2 py-1");
      expect(className).toContain("text-sm");
    }
  });
});
