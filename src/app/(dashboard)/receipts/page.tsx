"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import { Plus, FileText } from "lucide-react";
import { api } from "@/lib/trpc/client";
import { RouteState } from "@/components/household/RouteState";
import { Button } from "@/components/ui/button";
import { ItemRow } from "@/components/ui/item-row";
import { ReceiptStatusBadge } from "@/components/receipt/ReceiptStatus";

import type { ReceiptStatus } from "@prisma/client";
import { DEFAULT_CURRENCY, formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";

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
  const query = api.receipt.list.useQuery({ limit: 50 });
  const data = query.data;
  const receipts: Receipt[] = data?.items ?? [];

  // Dates go through `lib/dates`, which takes the locale as an argument. The
  // `formatDate` that once lived in `lib/utils` had `es-ES` written into it
  // (ISSUES.md I18N-3); the shared helper is fine, the pinned locale was not.

  // `!data` rather than `isLoading`, which is false for a query that is
  // paused offline or has failed — so with no signal, or after a 500, this
  // fell straight through to the empty state and told somebody they had
  // nothing. RouteState says which of loading, offline or failed it is.
  if (!data) {
    return (
      <RouteState
        error={query.error}
        fetchStatus={query.fetchStatus}
        isLoading={query.isPending}
        onRetry={() => void query.refetch()}
        title={t("title")}
      />
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-heading md:text-4xl">{t("title")}</h1>
        {/* `asChild` so the anchor *is* the button: a `<Link>` wrapping a
            `<Button>` produced an `<a>` with no box of its own — 103×17, well
            under the target floor — around a button that had one, and an anchor
            containing a button is not valid HTML either (DESIGN_AUDIT A4.2). */}
        <Button asChild>
          <Link href="/receipts/upload">
            <Plus aria-hidden="true" className="mr-2 size-5" />
            {t("upload")}
          </Link>
        </Button>
      </div>

      {receipts.length === 0 ? (
        <div className="text-center py-12 rounded-lg border border-border bg-muted">
          <FileText aria-hidden="true" className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-foreground mb-2">{t("noReceipts")}</p>
          <p className="text-sm text-muted-foreground">{t("uploadFirst")}</p>
          <Button asChild variant="outline" className="mt-4">
            <Link href="/receipts/upload">{t("upload")}</Link>
          </Button>
        </div>
      ) : (
        <ul className="space-y-3">
          {receipts.map((receipt) => (
            <ItemRow
              href={receiptHref(receipt)}
              key={receipt.id}
              meta={[
                // The label follows the data: purchaseDate is optional at upload, and for
                // months this row showed createdAt under "Fecha de compra" — a receipt
                // scanned a week late lied about when the shopping happened.
                receipt.purchaseDate
                  ? {
                      label: t("purchaseDate"),
                      value: formatDate(locale, receipt.purchaseDate, "long"),
                    }
                  : {
                      label: t("uploadedAt"),
                      value: formatDate(locale, receipt.createdAt, "long"),
                    },
                ...(receipt.totalAmount
                  ? [
                      {
                        label: t("totalAmount"),
                        value: formatMoney(locale, receipt.totalAmount, DEFAULT_CURRENCY),
                      },
                    ]
                  : []),
                ...(receipt._count.items > 0
                  ? [
                      {
                        label: t("items"),
                        value: t("itemCount", { count: receipt._count.items }),
                      },
                    ]
                  : []),
              ]}
              status={<ReceiptStatusBadge status={receipt.status} />}
              title={receipt.store?.name || t("storeUnknown")}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
