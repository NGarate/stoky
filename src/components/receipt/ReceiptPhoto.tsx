"use client";

import { useTranslations } from "next-intl";
import { Disclosure } from "@/components/ui/disclosure";
import { api } from "@/lib/trpc/client";

/**
 * The paper the lines were read from, folded away until a line needs checking
 * against it: a misread price, a name OCR mangled, a line it skipped.
 *
 * Asked for only once `auth.me` says the account may review — `getImage` is
 * `writeProcedure`, and a kitchen tablet would only be refused. Nothing is
 * drawn until the photograph arrives, so a refusal or a missing file leaves
 * the review as it was rather than a broken image.
 */
export function ReceiptPhoto({
  receiptId,
  defaultOpen,
}: {
  receiptId: string;
  /** Unfolded, as on the upload screen, where it is the photo being read. */
  defaultOpen?: boolean;
}) {
  const t = useTranslations("receipts");
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
      <img
        alt={t("photoAlt")}
        className="w-full rounded-b bg-card object-contain"
        src={image.data}
      />
    </Disclosure>
  );
}
