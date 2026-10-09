"use client";

import { Button } from "@/components/ui/button";
import { Minus, Plus } from "lucide-react";
import type { JSX } from "react";

/**
 * Inline quantity stepper — §3 flow 3: "Add to stock — the ± stepper. No form."
 *
 * The one piece kept from the Bolsillo proposal, which was otherwise rejected
 * as a screen (see docs/DESIGN_PROPOSALS.md). It sat here unmounted from
 * Phase 0 until Journey 4 put it on the product detail.
 *
 * Controlled on purpose: the value shown is the caller's projection of the
 * server total with unsent changes folded on (`projectStockTotals`), never a
 * count this component keeps for itself. A local count and a queued one are
 * two copies of the same intention, and the copy is the one that drifts.
 *
 * The buttons are the `Button` primitive, so the 48px floor is the primitive's
 * guarantee rather than a restated measurement — the exact drift the design
 * system section of CLAUDE.md exists to prevent. Labels come in as props: the
 * caller knows the product's name and unit, and a label minted here would be a
 * string landing in a component (§5.6).
 */
export function QuantityStepper({
  value,
  unit,
  addLabel,
  removeLabel,
  onAdd,
  onRemove,
  removeDisabled = false,
}: {
  /** What the screen should show: the projected total, not the server's. */
  value: number;
  unit: string;
  /** Full accessible name for +, naming the product — "más" alone names nothing. */
  addLabel: string;
  /** Full accessible name for −. */
  removeLabel: string;
  onAdd: () => void;
  onRemove: () => void;
  /** True at a projected zero: taking from nothing is the server's refusal to keep. */
  removeDisabled?: boolean;
}): JSX.Element {
  return (
    <div className="inline-flex items-center gap-3 rounded-lg border border-border bg-card p-2">
      <Button
        onClick={onRemove}
        disabled={removeDisabled}
        size="icon"
        type="button"
        variant="outline"
      >
        <Minus aria-hidden="true" className="size-5" />
        <span className="sr-only">{removeLabel}</span>
      </Button>

      {/* Not a live region: the snackbar already announces each change as a
          sentence with its undo, and two regions saying the same thing is the
          same thing said twice. Sighted users see the number move. */}
      <p
        className="min-w-16 text-center text-2xl font-bold tabular-nums text-heading"
        data-testid="stepper-value"
      >
        {value}{" "}
        <span className="text-sm font-normal text-muted-foreground">{unit}</span>
      </p>

      <Button onClick={onAdd} size="icon" type="button" variant="outline">
        <Plus aria-hidden="true" className="size-5" />
        <span className="sr-only">{addLabel}</span>
      </Button>
    </div>
  );
}
