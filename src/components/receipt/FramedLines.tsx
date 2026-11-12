"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ScanText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/trpc/client";
import { type Box, type Quad, boundsOf } from "@/lib/receipt-quad";
import { QuadPicker } from "./QuadPicker";
import type { ReceiptLine } from "./ReceiptLineForm";

/** A band across the middle of `view`, for a tap to carry to the lines. */
function band({ x, y, width, height }: Box): Quad {
  const top = y + height * 0.46;
  const bottom = y + height * 0.54;
  return [
    [x, top],
    [x + width, top],
    [x + width, bottom],
    [x, bottom],
  ];
}

/**
 * The receipt's photo, to frame the lines of one article on — its name, its
 * price, any discount under it — and have only those read again
 * (`receipt.readRegion`). What they read is handed to `onRead` for the
 * person to check and save; nothing is written here.
 *
 * Only the ticket's part of the photo is shown when it was framed
 * (`ticketQuad`), so its lines are drawn as large as the page allows; the
 * frame is still on the photo, which is kept whole.
 */
export function FramedLines({
  receiptId,
  ticketQuad,
  onRead,
  onCancel,
}: {
  receiptId: string;
  ticketQuad: Quad | null;
  onRead: (line: ReceiptLine) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("receipts");
  const common = useTranslations("common");
  const view = ticketQuad ? boundsOf(ticketQuad) : undefined;
  const [quad, setQuad] = useState<Quad>(() =>
    band(view ?? { x: 0, y: 0, width: 1, height: 1 }),
  );
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
          view={view}
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
