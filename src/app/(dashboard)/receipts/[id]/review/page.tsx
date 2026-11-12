"use client";

import { useParams, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Package, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useSnackbar } from "@/components/ui/snackbar";
import { api } from "@/lib/trpc/client";
import { invalidateAfterReceiptApplied } from "@/lib/trpc/stale";
import { RouteState } from "@/components/household/RouteState";
import { isItemReviewed } from "@/lib/receipts";
import { PageHeader, PageShell } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { ReceiptDetailsForm } from "@/components/receipt/ReceiptDetailsForm";
import { ReceiptLineForm } from "@/components/receipt/ReceiptLineForm";
import { ReceiptPhoto } from "@/components/receipt/ReceiptPhoto";
import { ReviewCard } from "@/components/receipt/ReviewCard";
import { ReceiptStatusStep } from "@/components/receipt/ReceiptStatus";
import { formatDate } from "@/lib/dates";
import { DEFAULT_CURRENCY, formatMoney } from "@/lib/money";

export default function ReviewPage() {
  const t = useTranslations("receipts");
  const locale = useLocale();
  const params = useParams();
  const router = useRouter();
  const snackbar = useSnackbar();
  const receiptId = params.id as string;

  const utils = api.useUtils();
  const [addingLine, setAddingLine] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
  const receiptQuery = api.receipt.getReceiptWithItems.useQuery({
    receiptId,
  });
  const receipt = receiptQuery.data;

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

  /**
   * The first half of finishing: the NEEDS_REVIEW → CONFIRMED edge.
   *
   * `confirmAll` sets the receipt to CONFIRMED; only `applyReceipt` sets
   * APPLIED. The page used to stop between the two — "Terminar revisión",
   * a snackbar saying the receipt could now be applied, then "Aplicar al
   * inventario" in the same place — two presses where, every line already
   * being reviewed, the first decided nothing a person could see. So the one
   * finish button runs both, in order, and only applies what was confirmed.
   */
  const confirmAllMutation = api.receipt.confirmAll.useMutation({
    onSuccess: () => {
      // Refetched as well, so that if the apply below is refused the page
      // shows what is true — confirmed, with only the apply left to do.
      void utils.receipt.getReceiptWithItems.invalidate({ receiptId });
      applyReceiptMutation.mutate({ receiptId });
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

  // A correction and an added line refetch like a settled one, and a refusal
  // says so, for the same reasons as `confirmItem` above.
  const updateItemMutation = api.receipt.updateItem.useMutation({
    onSuccess: () => {
      void utils.receipt.getReceiptWithItems.invalidate({ receiptId });
    },
    onError: () =>
      snackbar.show({
        kind: "confirm",
        tone: "danger",
        message: { key: "receipts.line.saveFailed" },
      }),
  });

  const addItemMutation = api.receipt.addItem.useMutation({
    onSuccess: () => {
      setAddingLine(false);
      void utils.receipt.getReceiptWithItems.invalidate({ receiptId });
    },
    onError: () =>
      snackbar.show({
        kind: "confirm",
        tone: "danger",
        message: { key: "receipts.line.addFailed" },
      }),
  });

  // A line taken out says so, with a way to put it back: the line is added
  // again as it read, though its decision on a product is not.
  const removeItemMutation = api.receipt.removeItem.useMutation({
    onSuccess: () => {
      void utils.receipt.getReceiptWithItems.invalidate({ receiptId });
    },
    onError: () =>
      snackbar.show({
        kind: "confirm",
        tone: "danger",
        message: { key: "receipts.line.removeFailed" },
      }),
  });

  const updateDetailsMutation = api.receipt.updateDetails.useMutation({
    onSuccess: () => {
      setEditingDetails(false);
      void utils.receipt.getReceiptWithItems.invalidate({ receiptId });
      // A shop typed by name may be a new one.
      void utils.store.list.invalidate();
    },
    onError: () =>
      snackbar.show({
        kind: "confirm",
        tone: "danger",
        message: { key: "receipts.details.saveFailed" },
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
        back="/receipts"
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

  /** Confirm what is not yet confirmed, then apply — or just apply. */
  const handleFinish = (): void => {
    if (receipt.status === "CONFIRMED") {
      applyReceiptMutation.mutate({ receiptId });
    } else {
      handleConfirmAll();
    }
  };

  const finishing =
    confirmAllMutation.isPending || applyReceiptMutation.isPending;
  // Ready once nothing waits for a decision. A CONFIRMED receipt is ready
  // whatever its lines say: `confirmAll` accepts a subset, and applying is
  // the step left.
  //
  // And only a receipt open for review: a FAILED one with no lines has
  // nothing pending either, and finishing it would be refused.
  const failed = receipt.status === "FAILED";
  const canFinish =
    (pendingItems === 0 && receipt.status === "NEEDS_REVIEW") ||
    receipt.status === "CONFIRMED";

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
        back="/receipts"
        intro={
          <>
            {receipt.store?.name || t("storeUnknown")}
            {receipt.purchaseDate &&
              ` • ${formatDate(locale, receipt.purchaseDate, "long")}`}
            {receipt.totalAmount !== null &&
              ` • ${formatMoney(locale, receipt.totalAmount, DEFAULT_CURRENCY)}`}
          </>
        }
        title={t("review")}
      />

      <div className="mb-6">
        <ReceiptStatusStep status={receipt.status} />
      </div>

      {/* Applied is final: the frame can no longer be read again. */}
      <ReceiptPhoto
        reframable={receipt.status !== "APPLIED"}
        receiptId={receiptId}
        ticketQuad={receipt.ticketQuad}
      />

      {receipt.status === "APPLIED" ? (
        <div className="text-center py-8 rounded-lg border border-ok-foreground bg-ok mb-6">
          <Package
            aria-hidden="true"
            className="w-12 h-12 text-ok-foreground mx-auto mb-4"
          />
          <p className="text-ok-foreground font-medium">
            {t("alreadyApplied")}
          </p>
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
          {/* The shop, date and total in the heading, as the receipt says
              them — the shop most, since without one no price is kept. */}
          <div className="mb-6">
            {editingDetails ? (
              <div className="rounded-lg border border-border bg-card p-4">
                <ReceiptDetailsForm
                  defaults={{
                    storeName: receipt.store?.name ?? "",
                    date:
                      receipt.purchaseDate?.toISOString().slice(0, 10) ?? "",
                    total: receipt.totalAmount?.toString() ?? "",
                  }}
                  onCancel={() => setEditingDetails(false)}
                  onSubmit={(details) =>
                    updateDetailsMutation.mutate({ receiptId, ...details })
                  }
                />
              </div>
            ) : (
              <Button
                onClick={() => setEditingDetails(true)}
                type="button"
                variant="outline"
              >
                <Pencil aria-hidden="true" className="mr-2 size-5" />
                {t("details.edit")}
              </Button>
            )}
          </div>

          {/* Wraps: at 390px the sentence and the action do not fit on one line,
              and the action is what pushed the row past the viewport. */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            {/* A live region because this sentence is the only feedback a
                confirmation produces. It is one region on the element that
                already states the outcome, rather than an announcement bolted
                onto every route: the number changing is the confirmation. */}
            <p
              aria-live="polite"
              className="text-muted-foreground"
              role="status"
            >
              {failed
                ? t("line.failedIntro")
                : pendingItems === 0
                  ? t("allReviewed")
                  : t("pendingItems", { count: pendingItems })}
            </p>

            {/* One button, offered once there is nothing left to decide.
                Before that the sentence beside it says what is left; a
                disabled button would only be one a keyboard cannot reach to
                ask why. */}
            {canFinish ? (
              <Button type="button" onClick={handleFinish} disabled={finishing}>
                <Package aria-hidden="true" className="mr-2 size-5" />
                {finishing ? t("applying") : t("applyToInventory")}
              </Button>
            ) : null}
          </div>

          <div className="space-y-4">
            {receipt.items.map((item) => (
              <ReviewCard
                key={item.id}
                receiptId={receiptId}
                ticketQuad={receipt.ticketQuad}
                onRemove={() =>
                  removeItemMutation.mutate(
                    { receiptItemId: item.id },
                    {
                      onSuccess: () =>
                        snackbar.show({
                          kind: "undo-inverse",
                          message: { key: "receipts.line.removed" },
                          undo: () =>
                            addItemMutation.mutate({
                              receiptId,
                              name: item.parsedName || item.rawText,
                              price: item.parsedPrice
                                ? Number(item.parsedPrice)
                                : undefined,
                              quantity: item.parsedQuantity
                                ? Number(item.parsedQuantity)
                                : 1,
                            }),
                        }),
                    },
                  )
                }
                item={{
                  ...item,
                  candidates: item.candidates || [],
                }}
                // One call per action, because each action carries different
                // fields. The guards mirror what ReviewCard already ensures —
                // it only emits MATCH from a selected candidate and CREATE
                // from a non-empty trimmed name — so they are a type narrowing
                // rather than a second opinion.
                onCorrect={(line) =>
                  updateItemMutation.mutate({ receiptItemId: item.id, ...line })
                }
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
                    confirmItemMutation.mutate({
                      receiptItemId: item.id,
                      action,
                    });
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

          {/* A line OCR missed, or on a receipt it could not read at all,
              every line: typed from the photograph above. */}
          <div className="mt-4">
            {addingLine ? (
              <div className="rounded-lg border border-border bg-card p-4">
                <ReceiptLineForm
                  onCancel={() => setAddingLine(false)}
                  onSubmit={(line) =>
                    addItemMutation.mutate({ receiptId, ...line })
                  }
                  submitLabel={t("line.add")}
                />
              </div>
            ) : (
              <Button
                onClick={() => setAddingLine(true)}
                type="button"
                variant="outline"
              >
                <Plus aria-hidden="true" className="mr-2 size-5" />
                {t("line.add")}
              </Button>
            )}
          </div>
        </>
      )}
    </PageShell>
  );
}
