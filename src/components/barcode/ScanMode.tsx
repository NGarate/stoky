"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import type { JSX } from "react";

/**
 * Grocy's "scan mode", for a stock screen: each product scanned is saved at
 * once, and the camera opens again for the next. Putting a bag of shopping
 * away is a run of scans, and confirming each one by hand is most of the
 * work.
 *
 * On or off per screen and per device, as a convenience: losing it costs a
 * tick. The state starts off on the server and is read after mount, so the
 * first render agrees with the server's.
 */
export function useScanMode(screen: "add" | "consume"): {
  on: boolean;
  setOn: (on: boolean) => void;
  /** Bumped to ask the picker for the next scan. */
  scanRequest: number;
  next: () => void;
} {
  const key = `stoky.scan-mode.${screen}`;
  const [on, setOnState] = useState(false);
  const [scanRequest, setScanRequest] = useState(0);

  useEffect(() => {
    try {
      setOnState(localStorage.getItem(key) === "on");
    } catch {
      // Storage blocked: off, which is the default anyway.
    }
  }, [key]);

  function setOn(next: boolean): void {
    setOnState(next);
    try {
      if (next) localStorage.setItem(key, "on");
      else localStorage.removeItem(key);
    } catch {
      // The choice holds for this visit.
    }
  }

  return {
    on,
    setOn,
    scanRequest,
    next: () => setScanRequest((request) => request + 1),
  };
}

/** The switch, and — always mounted, so it is announced — the last save. */
export function ScanModeToggle({
  on,
  onChange,
  hint,
  saved,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  /** What a scan does on this screen, already translated. */
  hint: string;
  /** The last save made in scan mode, or "". */
  saved: string;
}): JSX.Element {
  const t = useTranslations("products.scanPick");

  return (
    <div>
      <Checkbox
        checked={on}
        hint={hint}
        label={t("scanMode")}
        onCheckedChange={onChange}
      />
      <p aria-live="polite" className="mt-2 font-medium" role="status">
        {saved}
      </p>
    </div>
  );
}
