"use client";


import { useParams, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Check, Package } from "lucide-react";
import Link from "next/link";
import { useSnackbar } from "@/components/ui/snackbar";
import { api } from "@/lib/trpc/client";
import { invalidateAfterReceiptApplied } from "@/lib/trpc/stale";
import { RouteState } from "@/components/household/RouteState";
import { isItemReviewed } from "@/lib/receipts";
import { PageHeader, PageShell } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { ReviewCard } from "@/components/receipt/ReviewCard";
import { ReceiptStatusStep } from "@/components/receipt/ReceiptStatus";
import { formatDate } from "@/lib/dates";

export default function ReviewPage() {
  const t = useTranslations("receipts");
  const locale = useLocale();
  const params = useParams();
  const router = useRouter();
  const snackbar = useSnackbar();
  const receiptId = params.id as string;

  const utils = api.useUtils();
  const receiptQuery = api.receipt.getReceiptWithItems.useQuery({
    receiptId,
  });
  const receipt = receiptQuery.data;

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
    // A failure said nothing at all: the button re-enabled, the count did
    // not move, and no text was written anywhere in the document — so a
    // screen-reader user was told nothing had happened, and a sighted one
    // reasonably pressed it again (WCAG 3.3.1).
    onError: () =>
      snackbar.show({
        kind: "confirm",
        tone: "danger",
        message: { key: "receipts.confirmAllFailed" },
      }),
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
    // A failure said nothing at all: the button re-enabled, the count did
    // not move, and no text was written anywhere in the document — so a
    // screen-reader user was told nothing had happened, and a sighted one
    // reasonably pressed it again (WCAG 3.3.1).
    onError: () =>
      snackbar.show({
        kind: "confirm",
        tone: "danger",
        message: { key: "receipts.confirmItemFailed" },
      }),
  });
  const applyReceiptMutation = api.receipt.applyReceipt.useMutation({
    onSuccess: () => {
      // Applying moves stock and records prices; without this the inventory,
      // the product pages and the price history kept their pre-receipt
      // answers until something else happened to refetch them.
      void invalidateAfterReceiptApplied(utils);
      router.push(`/receipts/${receiptId}/applied`);
    },
    // A failure said nothing at all: the button re-enabled, the count did
    // not move, and no text was written anywhere in the document — so a
    // screen-reader user was told nothing had happened, and a sighted one
    // reasonably pressed it again (WCAG 3.3.1).
    onError: () =>
      snackbar.show({
        kind: "confirm",
        tone: "danger",
        message: { key: "receipts.applyFailed" },
      }),
  });


  // "Not found" only when the server said so. Gated on `isLoading`, a query
  // paused offline or refused with a 500 fell through to this branch and
  // told somebody their receipt did not exist.
  //
  // A receipt that really is gone says so as a page — a heading, why, and the
  // way back. It was a bare paragraph with no h1 and no link: a dead end.
  if (!receipt) {
    return (
      <RouteState
        back={{ href: "/receipts", label: t("backToList") }}
        error={receiptQuery.error}
        fetchStatus={receiptQuery.fetchStatus}
        isLoading={receiptQuery.isPending}
        notFound={{ title: t("notFoundTitle"), body: t("notFoundBody") }}
        onRetry={() => void receiptQuery.refetch()}
        title={t("review")}
        width="detail"
      />
    );
  }

  // Derived, not held. The `useState(0)` this replaces had no setter, so the
  // count never moved and "Confirmar todos" — disabled while anything is
  // pending — was disabled permanently, which is to say the bulk action could
  // never be used at all (ISSUES UI-7).
  const pendingItems = receipt.items.filter(
    (item) => !isItemReviewed(item.matchStatus),
  ).length;



  // `mutate` rather than `mutateAsync`. Both of these awaited the async form
  // and neither caught it, so a refusal became an unhandled promise
  // rejection — a failure the page could not have reported even if it had
  // wanted to. Nothing here needs the promise; the callbacks above do the
  // work.
  const handleConfirmAll = (): void => {
    // Built per action rather than as one object with optional fields: a
    // decision is a MATCH *with* a product or a SKIP without one, and the
    // server's schema is now a union that says so.
    const itemsToConfirm = receipt.items.map((item) =>
      item.matchedProductId
        ? {
            receiptItemId: item.id,
            action: "MATCH" as const,
            productId: item.matchedProductId,
          }
        : { receiptItemId: item.id, action: "SKIP" as const },
    );

    confirmAllMutation.mutate({ receiptId, items: itemsToConfirm });
  };

  const handleApply = (): void => {
    applyReceiptMutation.mutate({ receiptId });
  };

  return (
    // No padding of its own: the dashboard `main` already pads every route, and
    // a second `p-6` on top of it cost 48px of a 390px screen (ISSUES UI-5).
    <PageShell width="detail">
      {/* Was an icon-only link: a bare `<ArrowLeft/>` in a ghost button,
          named only by `aria-label`. That is enough for WCAG 2.4.4 and not for
          2.4.9, which asks that a link's purpose be clear from its link text —
          and this project is held to AAA elsewhere (`check:contrast`, the 48px
          floor). It was also the last way back in the application that was not
          a `BackLink`, so this screen alone spelled "back" as an icon while
          eleven others spelled it as an arrow and a sentence. */}
      <PageHeader
        back={{ href: "/receipts", label: t("backToList") }}
        intro={
          <>
            {receipt.store?.name || t("storeUnknown")}
            {receipt.purchaseDate &&
              ` • ${formatDate(locale, receipt.purchaseDate, "long")}`}
          </>
        }
        title={t("review")}
      />

      <div className="mb-6">
        <ReceiptStatusStep status={receipt.status} />
      </div>

      {receipt.status === "APPLIED" ? (
        <div className="text-center py-8 rounded-lg border border-ok-foreground bg-ok mb-6">
          <Package aria-hidden="true" className="w-12 h-12 text-ok-foreground mx-auto mb-4" />
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
                <Package aria-hidden="true" className="mr-2 size-5" />
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
                <Check aria-hidden="true" className="mr-2 size-5" />
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
                // One call per action, because each action carries different
                // fields. The guards mirror what ReviewCard already ensures —
                // it only emits MATCH from a selected candidate and CREATE
                // from a non-empty trimmed name — so they are a type narrowing
                // rather than a second opinion.
                onConfirm={(action, productId, customName) => {
                  if (action === "MATCH" && productId) {
                    confirmItemMutation.mutate({
                      receiptItemId: item.id,
                      action,
                      productId,
                    });
                  } else if (action === "CREATE" && customName) {
                    confirmItemMutation.mutate({
                      receiptItemId: item.id,
                      action,
                      customName,
                    });
                  } else if (action === "SKIP") {
                    confirmItemMutation.mutate({ receiptItemId: item.id, action });
                  } else if (process.env.NODE_ENV !== "production") {
                    // Unreachable while ReviewCard's guards hold. If they ever
                    // move, a decision silently dropped here would read as a
                    // button that does nothing — the shape of A11Y-2 — so in
                    // development it is noise instead.
                    throw new Error(
                      `ReviewCard emitted ${action} without its required field`,
                    );
                  }
                }}
              />
            ))}
          </div>
        </>
      )}
    </PageShell>
  );
}
