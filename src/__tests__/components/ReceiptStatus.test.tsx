import "../setup/matchers";
import { describe, it, expect, afterEach } from "bun:test";
import { render, screen, cleanup, within } from "@testing-library/react";
import { ReceiptStatus } from "@prisma/client";
import {
  ReceiptStatusBadge,
  ReceiptStatusStep,
} from "@/components/receipt/ReceiptStatus";

afterEach(cleanup);

describe("ReceiptStatusBadge", () => {
  it("labels every status in the enum", () => {
    const expected: Record<ReceiptStatus, string> = {
      [ReceiptStatus.UPLOADING]: "Subiendo...",
      [ReceiptStatus.PROCESSING]: "Procesando OCR...",
      [ReceiptStatus.PARSED]: "Analizando...",
      [ReceiptStatus.NEEDS_REVIEW]: "Necesita revisión",
      [ReceiptStatus.CONFIRMED]: "Confirmado",
      [ReceiptStatus.APPLIED]: "Aplicado",
      [ReceiptStatus.FAILED]: "Error",
    };

    // Guards against a new ReceiptStatus member landing without a config entry,
    // which would crash the badge on `config.icon`.
    for (const status of Object.values(ReceiptStatus)) {
      const { unmount } = render(<ReceiptStatusBadge status={status} />);
      expect(screen.getByText(expected[status])).toBeInTheDocument();
      unmount();
    }
  });

  it("marks in-flight statuses with a spinning icon", () => {
    const { container } = render(
      <ReceiptStatusBadge status={ReceiptStatus.PROCESSING} />,
    );

    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("does not spin once the receipt is applied", () => {
    const { container } = render(
      <ReceiptStatusBadge status={ReceiptStatus.APPLIED} />,
    );

    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("shows the processed/total counter when progress is supplied", () => {
    render(
      <ReceiptStatusBadge
        status={ReceiptStatus.PROCESSING}
        progress={{ processed: 3, total: 8 }}
      />,
    );

    expect(screen.getByText("(3/8)")).toBeInTheDocument();
  });

  it("hides the counter once the receipt is applied", () => {
    render(
      <ReceiptStatusBadge
        status={ReceiptStatus.APPLIED}
        progress={{ processed: 8, total: 8 }}
      />,
    );

    expect(screen.queryByText("(8/8)")).toBeNull();
  });

  it("omits the counter entirely when no progress is supplied", () => {
    const { container } = render(
      <ReceiptStatusBadge status={ReceiptStatus.PROCESSING} />,
    );

    expect(container.textContent).toBe("Procesando OCR...");
  });
});

/**
 * One wrapper div per step carries the active/inactive text colour. Reading the
 * wrappers (rather than counting raw class occurrences) keeps the assertion
 * pinned to the steps themselves — the number circles reuse the same colours.
 */
function stepActivity(container: HTMLElement): boolean[] {
  return Array.from(container.querySelectorAll("div.flex.flex-col")).map(
    (step) => step.className.includes("text-primary"),
  );
}

describe("ReceiptStatusStep", () => {
  it("renders the six pipeline steps in order", () => {
    render(<ReceiptStatusStep status={ReceiptStatus.PARSED} />);

    const labels = ["Subida", "OCR", "Análisis", "Revisión", "Confirmado", "Aplicado"];
    for (const label of labels) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("highlights the current step and everything before it", () => {
    const { container } = render(
      <ReceiptStatusStep status={ReceiptStatus.PARSED} />,
    );

    // PARSED is index 2, so steps 1-3 are active and 4-6 are not.
    const activity = stepActivity(container);
    expect(activity).toEqual([true, true, true, false, false, false]);
  });

  it("gives the current step the filled marker", () => {
    const { container } = render(
      <ReceiptStatusStep status={ReceiptStatus.NEEDS_REVIEW} />,
    );

    const current = container.querySelector(".bg-primary.text-primary-foreground");
    expect(current).not.toBeNull();
    expect(within(current as HTMLElement).getByText("4")).toBeInTheDocument();
  });

  it("treats FAILED as no completed step, since it is not in the ladder", () => {
    const { container } = render(
      <ReceiptStatusStep status={ReceiptStatus.FAILED} />,
    );

    // findIndex returns -1, so nothing should read as active.
    expect(stepActivity(container)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});
