"use client";

import { useEffect, useState } from "react";

type Mode = "auto" | "light" | "dark";

const STORAGE_KEY = "stoky-design-theme";
const OPTIONS: Array<{ value: Mode; label: string }> = [
  { value: "auto", label: "Sistema" },
  { value: "light", label: "Claro" },
  { value: "dark", label: "Oscuro" },
];

function apply(mode: Mode): void {
  const root = document.documentElement;
  if (mode === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
}

/**
 * Light/dark selector.
 *
 * A radiogroup rather than a two-state switch, so "follow the system" stays
 * reachable after the first click instead of being lost. The choice is stored
 * and re-applied before paint by the inline script in the layout.
 */
export function ThemeControl() {
  const [mode, setMode] = useState<Mode>("auto");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) as Mode | null;
    if (stored === "light" || stored === "dark" || stored === "auto") {
      setMode(stored);
    }
  }, []);

  function choose(next: Mode): void {
    setMode(next);
    apply(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }

  return (
    <fieldset className="themeControl">
      <legend className="themeControl__legend">Tema</legend>
      <div className="themeControl__options">
        {OPTIONS.map((option) => (
          <label key={option.value} className="themeControl__option">
            <input
              type="radio"
              name="stoky-theme"
              value={option.value}
              checked={mode === option.value}
              onChange={() => choose(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
