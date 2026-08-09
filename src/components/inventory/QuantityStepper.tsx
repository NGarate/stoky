"use client";

import { useState } from "react";
import "./quantity-stepper.css";

/**
 * Inline quantity stepper.
 *
 * The one piece kept from the Bolsillo proposal, which was otherwise rejected
 * as a screen (see docs/DESIGN_PROPOSALS.md). It is the phone screen's way of
 * changing stock in Phase 4 of docs/REDESIGN_PLAN.md, so it is retained here
 * deliberately rather than being rediscovered later.
 *
 * Adjusting stock happens on the card instead of on a separate page, which is
 * what the current dead "Añadir stock" link was reaching for. Targets are 48px
 * so it works with a thumb. The live region announces the new value, since a
 * sighted user sees the number change but a screen-reader user would not.
 */
export function QuantityStepper({
  label,
  unit,
  initial,
  step = 1,
}: {
  label: string;
  unit: string;
  initial: number;
  step?: number;
}) {
  const [value, setValue] = useState(initial);
  const round = (n: number) => Math.round(n * 100) / 100;

  return (
    <div className="stepper__stepper">
      <button
        type="button"
        className="stepper__step"
        onClick={() => setValue((v) => round(Math.max(0, v - step)))}
        disabled={value <= 0}
        aria-label={`Quitar ${step} ${unit} de ${label}`}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </button>

      <p className="stepper__value" aria-live="polite">
        <strong>{value}</strong>
        <span>{unit}</span>
      </p>

      <button
        type="button"
        className="stepper__step"
        onClick={() => setValue((v) => round(v + step))}
        aria-label={`Añadir ${step} ${unit} a ${label}`}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M12 5v14M5 12h14"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
