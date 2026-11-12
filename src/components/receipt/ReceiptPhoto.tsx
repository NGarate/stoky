"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Crop, ScanText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { useSnackbar } from "@/components/ui/snackbar";
import { FULL_FRAME, type Quad } from "@/lib/receipt-quad";
import { api } from "@/lib/trpc/client";
import { QuadPicker } from "./QuadPicker";

/**
 * The paper the lines were read from, folded away until a line needs checking
 * against it: a misread price, a name OCR mangled, a line it skipped.
 *
 * Asked for only once `auth.me` says the account may review — `getImage` is
 * `writeProcedure`, and a kitchen tablet would only be refused. Nothing is
 * drawn until the photograph arrives, so a refusal or a missing file leaves
 * the review as it was rather than a broken image.
 *
 * The photo is kept whole, so where the ticket is on it can be corrected
 * here when `reframable` (`TicketFrame`).
 */
export function ReceiptPhoto({
  receiptId,
  defaultOpen,
  ticketQuad = null,
  reframable = false,
}: {
  receiptId: string;
  /** Unfolded, as on the upload screen, where it is the photo being read. */
  defaultOpen?: boolean;
  /** Where the ticket was framed on the photo, if it was. */
  ticketQuad?: Quad | null;
  /** The frame may be corrected and the ticket read again. */
  reframable?: boolean;
}) {
  const t = useTranslations("receipts");
  const [reframing, setReframing] = useState(false);
  const me = api.auth.me.useQuery(undefined, { retry: false });
  const canReview = me.data !== undefined && me.data.role !== "KITCHEN";
  const image = api.receipt.getImage.useQuery(
    { receiptId },
    // A stored photograph never changes; refetching it on focus is megabytes
    // for nothing.
    { enabled: canReview, staleTime: Infinity },
  );

  if (!image.data) return null;

  return (
    <Disclosure className="mb-6" defaultOpen={defaultOpen} summary={t("photo")}>
      {reframing ? (
        <TicketFrame
          onCancel={() => setReframing(false)}
          receiptId={receiptId}
          src={image.data}
          ticketQuad={ticketQuad}
        />
      ) : (
        <>
          <img
            alt={t("photoAlt")}
            className="w-full rounded-b bg-card object-contain"
            src={image.data}
          />
          {reframable && (
            <div className="p-3">
              <Button
                onClick={() => setReframing(true)}
                type="button"
                variant="outline"
              >
                <Crop aria-hidden="true" className="mr-2 size-5" />
                {t("frame.correct")}
              </Button>
            </div>
          )}
        </>
      )}
    </Disclosure>
  );
}

/**
 * The frame put on the ticket again, from the one it has (or the whole photo
 * when it has none), and the ticket read again with it (`receipt.reframe`).
 * Reading again replaces the receipt's lines, which the hint says before the
 * button is pressed. The upload screen then follows the reading, as after an
 * upload, and opens the review once it is read.
 */
function TicketFrame({
  receiptId,
  src,
  ticketQuad,
  onCancel,
}: {
  receiptId: string;
  src: string;
  ticketQuad: Quad | null;
  onCancel: () => void;
}) {
  const t = useTranslations("receipts");
  const common = useTranslations("common");
  const router = useRouter();
  const snackbar = useSnackbar();
  const utils = api.useUtils();
  const [quad, setQuad] = useState<Quad>(ticketQuad ?? FULL_FRAME);
  const reframe = api.receipt.reframe.useMutation({
    onSuccess: () => {
      // The status the upload screen has cached says "read", and it would
      // open the review again at once instead of following this reading.
      utils.receipt.getStatus.setData(
        { receiptId },
        (old) => old && { ...old, status: "UPLOADING" },
      );
      void utils.receipt.getReceiptWithItems.invalidate({ receiptId });
      router.push(`/receipts/upload?receipt=${receiptId}`);
    },
    onError: () =>
      snackbar.show({
        kind: "confirm",
        tone: "danger",
        message: { key: "receipts.frame.reframeFailed" },
      }),
  });

  return (
    <div className="space-y-3 p-3">
      <QuadPicker
        alt={t("photoAlt")}
        hint={t("frame.reframeHint")}
        onChange={setQuad}
        quad={quad}
        src={src}
      />
      <div className="flex flex-wrap gap-2">
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
          disabled={reframe.isPending}
          onClick={() => reframe.mutate({ receiptId, quad })}
          type="button"
        >
          <ScanText aria-hidden="true" className="size-5" />
          {t("frame.readAgain")}
        </Button>
      </div>
    </div>
  );
}
