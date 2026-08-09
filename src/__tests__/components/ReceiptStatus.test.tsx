import "../setup/matchers";
import { describe, it, expect, afterEach } from "bun:test";
import { screen, cleanup, within } from "@testing-library/react";
import { ReceiptStatus } from "@prisma/client";
import { renderWithIntl } from "../utils/render";
import {
  ReceiptStatusBadge,
  ReceiptStatusStep,
} from "@/components/receipt/ReceiptStatus";

afterEach(cleanup);

describe("ReceiptStatusBadge", () => {
  it("labels every status from the shared catalogue", () => {
    // The literal values of `receipts.status.*` in messages/es.json, which the
    // applied summary reads too — a rename there has to fail here.
    const expected: Record<ReceiptStatus, string> = {
      [ReceiptStatus.UPLOADING]: "Subiendo",
      [ReceiptStatus.PROCESSING]: "Procesando",
      [ReceiptStatus.PARSED]: "Procesado",
      [ReceiptStatus.NEEDS_REVIEW]: "Necesita revisión",
      [ReceiptStatus.CONFIRMED]: "Confirmado",
      [ReceiptStatus.APPLIED]: "Aplicado",
      [ReceiptStatus.FAILED]: "Error",
    };

    // Guards against a new ReceiptStatus member landing without a config entry,
    // which would crash the badge on `config.icon`.
    for (const status of Object.values(ReceiptStatus)) {
      const { unmount } = renderWithIntl(<ReceiptStatusBadge status={status} />);
      expect(screen.getByText(expected[status])).toBeInTheDocument();
      unmount();
    }
  });

  it("marks in-flight statuses with a spinning icon", () => {
    const { container } = renderWithIntl(
      <ReceiptStatusBadge status={ReceiptStatus.PROCESSING} />,
    );

    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("does not spin once the receipt is applied", () => {
    const { container } = renderWithIntl(
      <ReceiptStatusBadge status={ReceiptStatus.APPLIED} />,
    );

    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("shows the processed/total counter when progress is supplied", () => {
    renderWithIntl(
      <ReceiptStatusBadge
        status={ReceiptStatus.PROCESSING}
        progress={{ processed: 3, total: 8 }}
      />,
    );

    expect(screen.getByText("(3/8)")).toBeInTheDocument();
  });

  it("hides the counter once the receipt is applied", () => {
    renderWithIntl(
      <ReceiptStatusBadge
        status={ReceiptStatus.APPLIED}
        progress={{ processed: 8, total: 8 }}
      />,
    );

    expect(screen.queryByText("(8/8)")).toBeNull();
  });

  it("omits the counter entirely when no progress is supplied", () => {
    const { container } = renderWithIntl(
      <ReceiptStatusBadge status={ReceiptStatus.PROCESSING} />,
    );

    expect(container.textContent).toBe("Procesando");
  });
});

/** The six-circle ladder, shown from `md` up. */
function ladder(container: HTMLElement): HTMLElement {
  const el = container.querySelector("div.hidden");
  if (!el) throw new Error("ReceiptStatusStep rendered no full stepper");
  return el as HTMLElement;
}

/** The one-line summary that replaces the ladder below `md`. */
function compact(container: HTMLElement): HTMLElement {
  const el = container.querySelector("div.md\\:hidden");
  if (!el) throw new Error("ReceiptStatusStep rendered no compact summary");
  return el as HTMLElement;
}

/**
 * One wrapper div per step carries the active/inactive text colour. Reading the
 * wrappers (rather than counting raw class occurrences) keeps the assertion
 * pinned to the steps themselves — the number circles reuse the same colours.
 */
function stepActivity(container: HTMLElement): boolean[] {
  return Array.from(ladder(container).querySelectorAll("div.flex.flex-col")).map(
    (step) => step.className.includes("text-primary"),
  );
}

describe("ReceiptStatusStep", () => {
  it("renders the six pipeline steps in order", () => {
    const { container } = renderWithIntl(
      <ReceiptStatusStep status={ReceiptStatus.PARSED} />,
    );

    const labels = ["Subida", "OCR", "Análisis", "Revisión", "Confirmado", "Aplicado"];
    for (const label of labels) {
      expect(within(ladder(container)).getByText(label)).toBeInTheDocument();
    }
  });

  it("highlights the current step and everything before it", () => {
    const { container } = renderWithIntl(
      <ReceiptStatusStep status={ReceiptStatus.PARSED} />,
    );

    // PARSED is index 2, so steps 1-3 are active and 4-6 are not.
    const activity = stepActivity(container);
    expect(activity).toEqual([true, true, true, false, false, false]);
  });

  it("gives the current step the filled marker", () => {
    const { container } = renderWithIntl(
      <ReceiptStatusStep status={ReceiptStatus.NEEDS_REVIEW} />,
    );

    const current = ladder(container).querySelector(
      ".bg-primary.text-primary-foreground",
    );
    expect(current).not.toBeNull();
    expect(within(current as HTMLElement).getByText("4")).toBeInTheDocument();
  });

  it("treats FAILED as no completed step, since it is not in the ladder", () => {
    const { container } = renderWithIntl(
      <ReceiptStatusStep status={ReceiptStatus.FAILED} />,
    );

    // indexOf returns -1, so nothing should read as active.
    expect(stepActivity(container)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  // The phone rendering is the whole point of the fix: the ladder needs ~505px
  // and pushed the last step off a 390px screen, so below `md` the current step
  // has to be named on its own (ISSUES UI-5).
  it("names the current step in the compact summary", () => {
    const { container } = renderWithIntl(
      <ReceiptStatusStep status={ReceiptStatus.CONFIRMED} />,
    );

    expect(compact(container).textContent).toContain("Paso 5 de 6");
    expect(compact(container).textContent).toContain("Confirmado");
  });

  it("moves the compact summary with the status", () => {
    const { container } = renderWithIntl(
      <ReceiptStatusStep status={ReceiptStatus.APPLIED} />,
    );

    expect(compact(container).textContent).toContain("Paso 6 de 6");
    expect(compact(container).textContent).toContain("Aplicado");
  });

  it("says so plainly when the receipt never reached a step", () => {
    const { container } = renderWithIntl(
      <ReceiptStatusStep status={ReceiptStatus.FAILED} />,
    );

    expect(compact(container).textContent).toBe(
      "El procesamiento no llegó a completarse",
    );
  });
});
