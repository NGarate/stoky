"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ScanLine } from "lucide-react";
import { BarcodeScanner } from "@/components/barcode/Scanner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { JSX } from "react";

/**
 * The camera beside a barcode field, for filling the field rather than
 * choosing a product (that is `ScanProductDialog`). The code read is handed
 * back as a typed one would be; the field stays the way to type one the
 * camera cannot read.
 */
export function ScanCodeButton({
  onScan,
}: {
  onScan: (code: string) => void;
}): JSX.Element {
  const t = useTranslations("products.scan");
  const tScan = useTranslations("products.scanPick");
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        className="shrink-0 gap-2"
        onClick={() => setOpen(true)}
        type="button"
        variant="outline"
      >
        <ScanLine aria-hidden="true" className="size-5" />
        {tScan("open")}
      </Button>
      {/* Mounted only while open, so the camera is let go on close. */}
      {open ? (
        <Dialog onClose={() => setOpen(false)} open title={t("title")}>
          <BarcodeScanner
            onScan={(code) => {
              onScan(code.trim());
              setOpen(false);
            }}
          />
        </Dialog>
      ) : null}
    </>
  );
}
