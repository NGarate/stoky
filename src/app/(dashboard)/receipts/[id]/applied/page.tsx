"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { use } from "react";
import { Button } from "@/components/ui/button";
import { sectionHeading } from "@/components/ui/section";
import { PageHeader, PageShell } from "@/components/ui/page-header";
import { RouteState } from "@/components/household/RouteState";
import { api } from "@/lib/trpc/client";
import type { JSX } from "react";
import { useQuantityFormat } from "@/lib/inventory/quantity";
import { DEFAULT_CURRENCY, formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";

interface AppliedPageProps {
  params: Promise<{ id: string }>;
}

/**
 * The end of the receipt pipeline: OCR → parse → match → review → **apply**.
 *
 * `receipts/[id]/review` has always pushed here on a successful apply and this
 * route did not exist, so the last step of the longest journey in the product
 * landed on a 404 (DESIGN_AUDIT §0). What it owes the reader is a truthful
 * account of what the apply actually did, not a tick and a redirect.
 *
 * It reports only what `receipt.getAppliedSummary` genuinely returns: how many
 * stock entries and price records were written, which products they were written
 * against, the store, date and total from the receipt header, and how many
 * parsed lines produced nothing. Deliberately left out: the receipt image and
 * the raw OCR text, which are neither served over an authenticated route today
 * nor useful as a confirmation; the per-line match confidence, which is an
 * implementation detail of the matcher; and expiry dates, which `applyReceipt`
 * never sets.
 */
export default function ReceiptAppliedPage({
  params,
}: AppliedPageProps): JSX.Element {
  const { id } = use(params);
  const t = useTranslations("receipts.applied");
  const units = useQuantityFormat();
  const statusLabel = useTranslations("receipts.status");
  const tReceipts = useTranslations("receipts");
  const locale = useLocale();

  // `retry: false` because the likeliest failure is an id that is not in this
  // household, and the shared QueryClient retries three times by default — which
  // would hold the loading state for seconds before saying so.
  const query = api.receipt.getAppliedSummary.useQuery(
    { receiptId: id },
    { retry: false },
  );
  const summary = query.data;

  const back = { href: "/receipts", label: t("backToReceipts") };

  /**
   * Every state without a summary, through the one component that tells them
   * apart. `isPending` used to draw "Cargando…" — which a query paused
   * offline also is, so with no signal it said loading for ever (UI-8) — and
   * the server's English was matched to guess whether the household was
   * missing. The procedure answers NOT_FOUND for an id in another household
   * as for one that never existed, so the sentence cannot confirm either.
   */
  if (!summary) {
    return (
      <RouteState
        back={back}
        error={query.error}
        fetchStatus={query.fetchStatus}
        isLoading={query.isPending}
        notFound={{
          title: tReceipts("notFoundTitle"),
          body: tReceipts("notFoundBody"),
        }}
        onRetry={() => void query.refetch()}
        title={t("loadingTitle")}
        width="detail"
      />
    );
  }

  const { receipt } = summary;
  const isApplied = receipt.status === "APPLIED";
  const hasFailed = receipt.status === "FAILED";

  // Reached by guessing the URL, or with a receipt whose apply failed. It used
  // to be reachable a third way — finishing a review navigated here, and
  // `confirmAll` only sets CONFIRMED — which made this branch the ordinary
  // outcome of the review journey rather than the exception it is written as.
  // The review's one finish button now confirms *and* applies before it
  // comes here.
  //
  // Saying "applied" over a receipt that is not would be the worst thing this
  // page could do, so it says the opposite and points at what is outstanding.
  if (!isApplied) {
    return (
      <PageShell width="detail">
        <PageHeader back={back} title={t("pendingTitle")} />

        <div className="rounded border border-warn-foreground bg-warn p-4 text-warn-foreground">
          <p>
            {t("pendingStatus", {
              status: statusLabel(receipt.status.toLowerCase()),
            })}
          </p>
          <p className="mt-2">
            {hasFailed ? t("pendingFailed") : t("pendingIntro")}
          </p>
        </div>

        <ul className="mt-6 space-y-2">
          {hasFailed ? null : (
            <li>
              <Button asChild className="md:text-lg" variant="link">
                <Link href={`/receipts/${receipt.id}/review`}>
                  {" "}
                  {t("pendingReviewLink")}{" "}
                </Link>
              </Button>
            </li>
          )}
          <li>
            <Button asChild className="md:text-lg" variant="link">
              <Link href="/receipts/upload"> {t("nextUpload")} </Link>
            </Button>
          </li>
        </ul>
      </PageShell>
    );
  }

  return (
    <PageShell width="detail">
      <PageHeader
        back={back}
        className="mb-0"
        intro={t("intro")}
        title={t("title")}
      />

      <h2 className={`mt-8 ${sectionHeading()}`}>{t("summaryTitle")}</h2>
      {/* One column on a phone, three from `md`: three numbers side by side at
          390px leaves no room for the label that makes them mean anything. */}
      <dl className="mt-2 grid gap-3 md:grid-cols-3">
        <SummaryFigure
          label={t("summaryItemsAdded")}
          value={summary.itemsAdded}
        />
        <SummaryFigure
          label={t("summaryPricesRecorded")}
          value={summary.pricesRecorded}
        />
        <SummaryFigure
          hint={
            summary.linesNotApplied > 0
              ? t("summaryLinesNotAppliedHint")
              : undefined
          }
          label={t("summaryLinesNotApplied")}
          value={summary.linesNotApplied}
        />
      </dl>

      <h2 className={`mt-8 ${sectionHeading()}`}>{t("detailsTitle")}</h2>
      <dl className="mt-2 space-y-3">
        <div>
          <dt className="text-sm font-medium text-muted-foreground md:text-base">
            {t("storeLabel")}
          </dt>
          <dd className="text-foreground md:text-lg">
            {receipt.store?.name ?? t("storeUnknown")}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground md:text-base">
            {t("dateLabel")}
          </dt>
          <dd className="text-foreground md:text-lg">
            {receipt.purchaseDate
              ? formatDate(locale, receipt.purchaseDate, "long")
              : t("dateUnknown")}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground md:text-base">
            {t("totalLabel")}
          </dt>
          <dd className="text-foreground md:text-lg">
            {summary.totalAmount === null
              ? t("totalUnknown")
              : formatMoney(locale, summary.totalAmount, DEFAULT_CURRENCY)}
          </dd>
        </div>
      </dl>

      <h2 className={`mt-8 ${sectionHeading()}`}>{t("itemsTitle")}</h2>
      {summary.items.length === 0 ? (
        <p className="mt-2 text-muted-foreground md:text-lg">
          {t("itemsEmpty")}
        </p>
      ) : (
        <ul className="mt-2 space-y-3">
          {summary.items.map((item) => {
            // `||` rather than `??`: `rawText` is a non-null column that the
            // parser can still leave empty, and an empty card title is as
            // useless as a missing one.
            const name =
              item.matchedProduct?.name ||
              item.parsedName ||
              item.rawText ||
              t("itemFallbackName");
            const stock = item.stockEntry;
            const price = item.priceRecord;

            return (
              <li
                key={item.id}
                className="rounded border border-border bg-card p-4"
              >
                <p className="font-medium text-foreground md:text-xl">{name}</p>
                {stock ? (
                  <p className="mt-1 text-lg font-semibold text-heading md:text-2xl">
                    {units.quantity(stock.quantity, stock.unit)}
                  </p>
                ) : null}
                <p className="mt-1 text-sm text-muted-foreground md:text-base">
                  {price
                    ? t("itemPrice", {
                        price: formatMoney(locale, price.price, price.currency),
                      })
                    : t("itemPriceNone")}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-4 text-sm text-muted-foreground md:text-base">
        {t("noteLocation")}
      </p>
      {/* `applyReceipt` writes a price record only when the receipt carries a
          store, so a zero here has a cause worth naming rather than leaving as
          an unexplained blank. */}
      {receipt.storeId ? null : (
        <p className="mt-2 text-sm text-muted-foreground md:text-base">
          {t("noteNoStore")}
        </p>
      )}

      <h2 className={`mt-8 ${sectionHeading()}`}>{t("nextTitle")}</h2>
      <ul className="mt-2 space-y-2">
        <li>
          <Button asChild className="md:text-lg" variant="link">
            <Link href="/inventory"> {t("nextInventory")} </Link>
          </Button>
        </li>
        <li>
          <Button asChild className="md:text-lg" variant="link">
            <Link href="/prices"> {t("nextPrices")} </Link>
          </Button>
        </li>
        <li>
          <Button asChild className="md:text-lg" variant="link">
            <Link href={`/receipts/${receipt.id}/review`}>
              {" "}
              {t("nextReview")}{" "}
            </Link>
          </Button>
        </li>
        <li>
          <Button asChild className="md:text-lg" variant="link">
            <Link href="/receipts/upload"> {t("nextUpload")} </Link>
          </Button>
        </li>
      </ul>
    </PageShell>
  );
}

/**
 * One headline number with its label, and an explanation when the number is the
 * one that needs it.
 *
 * The label comes first in the DOM so a screen reader reads "stock entries
 * created, 5" rather than a bare number, and it is visually below the figure
 * with `flex-col-reverse` — reading order without duplicating the text.
 *
 * The wrapper is a single `div` between `dl` and its `dt`/`dd`, which is the
 * only nesting the HTML grouping rule allows; a second `div` inside it to carry
 * the layout would be invalid, so the layout class sits on the group itself and
 * the hint lives inside the `dt` it explains.
 */
function SummaryFigure({
  hint,
  label,
  value,
}: {
  hint?: string;
  label: string;
  value: number;
}): JSX.Element {
  return (
    // `justify-end` because the axis is reversed: the grid stretches all three
    // cards to the tallest, and without it the two short ones push their number
    // to the bottom of the card while the third starts at the top.
    <div className="flex flex-col-reverse justify-end rounded border border-border bg-card p-4">
      <dt className="mt-1 text-sm text-muted-foreground md:text-base">
        {label}
        {hint ? <span className="mt-2 block">{hint}</span> : null}
      </dt>
      <dd className="text-3xl font-bold text-heading md:text-4xl">{value}</dd>
    </div>
  );
}
