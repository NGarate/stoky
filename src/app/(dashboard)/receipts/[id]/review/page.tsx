"use client";

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Check, ArrowLeft, Package } from "lucide-react";
import Link from "next/link";
import { useSnackbar } from "@/components/ui/snackbar";
import { api } from "@/lib/trpc/client";
import { isItemReviewed } from "@/lib/receipts";
import { Button } from "@/components/ui/button";
import { ReviewCard } from "@/components/receipt/ReviewCard";
import { ReceiptStatusStep } from "@/components/receipt/ReceiptStatus";

export default function ReviewPage() {
  const t = useTranslations("receipts");
  const locale = useLocale();
  const params = useParams();
  const router = useRouter();
  const snackbar = useSnackbar();
  const receiptId = params.id as string;

  const utils = api.useUtils();
  const { data: receipt, isLoading } = api.receipt.getReceiptWithItems.useQuery({
    receiptId,
  });

  /**
   * Confirming every line does not apply the receipt.
   *
   * `confirmAll` sets the receipt to CONFIRMED; only `applyReceipt` sets
   * APPLIED. So navigating to /applied landed on a page whose first job is to
   * refuse to say "applied" over a receipt that is not — it rendered
   * "todavía no se ha aplicado" and pointed at the outstanding step, which is
   * the "Aplicar al inventario" button back on the page it had just left.
   *
   * It stays here, where the next step is, and refetches so the lines show
   * as confirmed.
   */
  const confirmAllMutation = api.receipt.confirmAll.useMutation({
    onSuccess: async () => {
      await utils.receipt.getReceiptWithItems.invalidate({ receiptId });
      snackbar.show({
        kind: "confirm",
        message: { key: "receipts.confirmedAll" },
      });
    },
  });

  // Without the invalidation the write landed and the page did not move: the
  // card kept its Confirmar button, the count kept its number, nothing was
  // announced. The reasonable response to a button that does nothing is to
  // press it again, so the defect cost a second write every time (ISSUES
  // A11Y-2). Its two neighbours above already refetch by navigating away.
  const confirmItemMutation = api.receipt.confirmItem.useMutation({
    onSuccess: () => {
      utils.receipt.getReceiptWithItems.invalidate({ receiptId });
    },
  });
  const applyReceiptMutation = api.receipt.applyReceipt.useMutation({
    onSuccess: () => {
      router.push(`/receipts/${receiptId}/applied`);
    },
  });

  const dateFormat = useMemo(() => new Intl.DateTimeFormat(locale), [locale]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl">
        <p>{t("loadingReceipt")}</p>
      </div>
    );
  }

  if (!receipt) {
    return (
      <div className="mx-auto max-w-4xl">
        <p>{t("notFound")}</p>
      </div>
    );
  }

  // Derived, not held. The `useState(0)` this replaces had no setter, so the
  // count never moved and "Confirmar todos" — disabled while anything is
  // pending — was disabled permanently, which is to say the bulk action could
  // never be used at all (ISSUES UI-7).
  const pendingItems = receipt.items.filter(
    (item) => !isItemReviewed(item.matchStatus),
  ).length;



  const handleConfirmAll = async () => {
    const itemsToConfirm = receipt.items.map((item) => ({
      receiptItemId: item.id,
      action: (item.matchedProductId ? "MATCH" : "SKIP") as "MATCH" | "CREATE" | "SKIP",
      productId: item.matchedProductId || undefined,
    }));

    await confirmAllMutation.mutateAsync({
      receiptId,
      items: itemsToConfirm,
    });
  };

  const handleApply = async () => {
    await applyReceiptMutation.mutateAsync({ receiptId });
  };

  return (
    // No padding of its own: the dashboard `main` already pads every route, and
    // a second `p-6` on top of it cost 48px of a 390px screen (ISSUES UI-5).
    <div className="mx-auto max-w-4xl">
      <div className="flex items-center gap-4 mb-6">
        {/* `asChild` so the anchor is the button rather than a boxless wrapper
            around one — an `<a>` containing a `<button>` is neither valid HTML
            nor a target of its own (DESIGN_AUDIT A4.2). */}
        <Button asChild variant="ghost" size="icon">
          <Link aria-label={t("backToList")} href="/receipts">
            <ArrowLeft aria-hidden="true" className="w-5 h-5" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-heading">{t("review")}</h1>
          <p className="text-muted-foreground">
            {receipt.store?.name || t("storeUnknown")}
            {receipt.purchaseDate &&
              ` • ${dateFormat.format(new Date(receipt.purchaseDate))}`}
          </p>
        </div>
      </div>

      <div className="mb-6">
        <ReceiptStatusStep status={receipt.status} />
      </div>

      {receipt.status === "APPLIED" ? (
        <div className="text-center py-8 rounded-lg border border-ok-foreground bg-ok mb-6">
          <Package className="w-12 h-12 text-ok-foreground mx-auto mb-4" />
          <p className="text-ok-foreground font-medium">{t("alreadyApplied")}</p>
          {/* The summary is what the apply redirects to; coming back to the
              review afterwards should be able to reach it too, rather than
              dead-ending on the fact that it happened. */}
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <Button asChild>
              <Link href={`/receipts/${receiptId}/applied`}>
                {t("viewApplied")}
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/inventory">{t("viewInventory")}</Link>
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Wraps: at 390px the sentence and the action do not fit on one line,
              and the action is what pushed the row past the viewport. */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            {/* A live region because this sentence is the only feedback a
                confirmation produces. It is one region on the element that
                already states the outcome, rather than an announcement bolted
                onto every route: the number changing is the confirmation. */}
            <p aria-live="polite" className="text-muted-foreground" role="status">
              {pendingItems === 0
                ? t("allReviewed")
                : t("pendingItems", { count: pendingItems })}
            </p>

            {receipt.status === "CONFIRMED" ? (
              <Button
                type="button"
                onClick={handleApply}
                disabled={applyReceiptMutation.isPending}
              >
                <Package className="w-4 h-4 mr-2" />
                {applyReceiptMutation.isPending
                  ? t("applying")
                  : t("applyToInventory")}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleConfirmAll}
                disabled={pendingItems > 0 || confirmAllMutation.isPending}
              >
                <Check className="w-4 h-4 mr-2" />
                {t("confirmAll")}
              </Button>
            )}
          </div>

          <div className="space-y-4">
            {receipt.items.map((item) => (
              <ReviewCard
                key={item.id}
                item={{
                  ...item,
                  candidates: item.candidates || [],
                }}
                onConfirm={(action, productId, customName) => {
                  confirmItemMutation.mutate({
                    receiptItemId: item.id,
                    action,
                    productId,
                    customName,
                  });
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
