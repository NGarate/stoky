"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ScanText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/trpc/client";
import type { Quad } from "@/lib/receipt-quad";
import { QuadPicker } from "./QuadPicker";
import type { ReceiptLine } from "./ReceiptLineForm";

/** A band across the middle of the ticket, for a tap to carry to the lines. */
const BAND: Quad = [
  [0, 0.46],
  [1, 0.46],
  [1, 0.54],
  [0, 0.54],
];

/**
 * The receipt's photo, to frame the lines of one article on — its name, its
 * price, any discount under it — and have only those read again
 * (`receipt.readRegion`). What they read is handed to `onRead` for the
 * person to check and save; nothing is written here.
 */
export function FramedLines({
  receiptId,
  onRead,
  onCancel,
}: {
  receiptId: string;
  onRead: (line: ReceiptLine) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("receipts");
  const common = useTranslations("common");
  const [quad, setQuad] = useState<Quad>(BAND);
  const [said, setSaid] = useState("");
  // Shared with `ReceiptPhoto`, which has usually fetched it already.
  const image = api.receipt.getImage.useQuery(
    { receiptId },
    { staleTime: Infinity },
  );
  const read = api.receipt.readRegion.useMutation({
    onSuccess: ({ line }) => {
      if (line) onRead(line);
      else setSaid(t("frame.nothingRead"));
    },
    onError: () => setSaid(t("frame.readFailed")),
  });

  return (
    <div className="space-y-3">
      {image.data && (
        <QuadPicker
          alt={t("photoAlt")}
          fit="width"
          hint={t("frame.linesHint")}
          onChange={setQuad}
          quad={quad}
          src={image.data}
        />
      )}
      {/* Mounted empty, so what it says later is announced. */}
      <p aria-live="polite" className="text-sm text-foreground" role="status">
        {said}
      </p>
      <div className="flex gap-2">
        <Button
          className="flex-1"
          onClick={onCancel}
          type="button"
          variant="outline"
        >
          {common("cancel")}
        </Button>
        <Button
          className="flex-1 gap-2"
          disabled={!image.data || read.isPending}
          onClick={() => {
            setSaid("");
            read.mutate({ receiptId, quad });
          }}
          type="button"
        >
          <ScanText aria-hidden="true" className="size-5" />
          {read.isPending ? t("frame.reading") : t("frame.readLines")}
        </Button>
      </div>
    </div>
  );
}
