"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { Plus, FileText } from "lucide-react";
import { api } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { ReceiptStatusBadge } from "@/components/receipt/ReceiptStatus";

import type { ReceiptStatus } from "@prisma/client";

interface Receipt {
  id: string;
  status: ReceiptStatus;
  store: { name: string } | null;
  createdAt: Date;
  purchaseDate: Date | null;
  totalAmount: number | null;
  _count: { items: number };
}

/**
 * Where a row in the list goes, by the phase the receipt is in.
 *
 * An applied receipt used to send you to `/receipts/upload`, which is neither
 * about that receipt nor anywhere near it in the pipeline. It now goes to its
 * own summary — which also stops that route being reachable only by a redirect
 * that fires once and is never seen again.
 */
function receiptHref(receipt: Receipt): string {
  if (receipt.status === "NEEDS_REVIEW" || receipt.status === "CONFIRMED") {
    return `/receipts/${receipt.id}/review`;
  }

  if (receipt.status === "APPLIED") {
    return `/receipts/${receipt.id}/applied`;
  }

  return "/receipts/upload";
}

export default function ReceiptsPage() {
  const t = useTranslations("receipts");
  const locale = useLocale();
  const { data, isLoading } = api.receipt.list.useQuery({ limit: 50 });
  const receipts: Receipt[] = data?.items ?? [];

  // Formatted here rather than by a shared helper, because a shared one has to
  // be told the locale and the only thing that knows it is a component. There
  // used to be a `formatDate` in `lib/utils` with `es-ES` written into it
  // (ISSUES.md I18N-3); it is gone rather than parameterised, because nothing
  // called it and a locale-pinning helper on the shelf is a trap for whoever
  // reaches for it next.
  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    [locale],
  );
  const moneyFormat = useMemo(
    () => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }),
    [locale],
  );

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-heading">{t("title")}</h1>
        </div>
        <div className="text-center py-12">
          <p className="text-muted-foreground">{t("loadingList")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-heading">{t("title")}</h1>
        {/* `asChild` so the anchor *is* the button: a `<Link>` wrapping a
            `<Button>` produced an `<a>` with no box of its own — 103×17, well
            under the target floor — around a button that had one, and an anchor
            containing a button is not valid HTML either (DESIGN_AUDIT A4.2). */}
        <Button asChild>
          <Link href="/receipts/upload">
            <Plus className="w-4 h-4 mr-2" />
            {t("upload")}
          </Link>
        </Button>
      </div>

      {receipts.length === 0 ? (
        <div className="text-center py-12 rounded-lg border border-border bg-muted">
          <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-foreground mb-2">{t("noReceipts")}</p>
          <p className="text-sm text-muted-foreground">{t("uploadFirst")}</p>
          <Button asChild variant="outline" className="mt-4">
            <Link href="/receipts/upload">{t("upload")}</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {receipts.map((receipt) => (
          <Link
            key={receipt.id}
            href={receiptHref(receipt)}
              className="block p-4 rounded-lg border border-border bg-card hover:bg-muted transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">
                    {receipt.store?.name || t("storeUnknown")}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {dateFormat.format(receipt.createdAt)}
                    {receipt.totalAmount && ` • ${moneyFormat.format(receipt.totalAmount)}`}
                    {receipt._count.items > 0 &&
                      ` • ${t("itemCount", { count: receipt._count.items })}`}
                  </p>
                </div>
                <ReceiptStatusBadge status={receipt.status} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
