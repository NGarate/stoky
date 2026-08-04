"use client";

import { useState } from "react";

/**
 * Inline quantity stepper — the signature of this proposal.
 *
 * Adjusting stock happens on the card instead of on a separate page, which is
 * what the current dead "Añadir stock" link was reaching for. Targets are 48px
 * so it works with a thumb. The live region announces the new value, since a
 * sighted user sees the number change but a screen-reader user would not.
 */
export function Stepper({
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
    <div className="bo__stepper">
      <button
        type="button"
        className="bo__step"
        onClick={() => setValue((v) => round(Math.max(0, v - step)))}
        disabled={value <= 0}
        aria-label={`Quitar ${step} ${unit} de ${label}`}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </button>

      <p className="bo__value" aria-live="polite">
        <strong>{value}</strong>
        <span>{unit}</span>
      </p>

      <button
        type="button"
        className="bo__step"
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
