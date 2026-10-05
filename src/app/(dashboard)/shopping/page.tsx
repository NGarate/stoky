"use client";

import Link from "next/link";
import { ChevronDown, ScanLine } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Section, sectionHeading } from "@/components/ui/section";
import { PageHeader, PageShell } from "@/components/ui/page-header";
import { api } from "@/lib/trpc/client";
import { RouteState } from "@/components/household/RouteState";
import { useWriteQueue } from "@/lib/offline/queue-context";
import { projectShoppingItems } from "@/lib/offline/project";
import type { JSX } from "react";
import { useQuantityFormat } from "@/lib/inventory/quantity";

/**
 * Screen A — the phone, "day to day" (`REDESIGN_PLAN.md` §3).
 *
 * One person in a supermarket. Standing, one hand, in a hurry, possibly poor
 * signal. It answers one question: *what do I need to buy?*
 *
 * The rules it is built to (§7), and where each shows:
 *
 * - **One task per screen.** Scanning is the single primary action and sits on
 *   top. Managing lists moved to `/shopping/lists`, because "which list does
 *   this belong to" is filing and filing is not shopping.
 * - **No system vocabulary.** "No queda nada en casa", not "stock 0".
 * - **State in words, never colour alone.** Every row says how much is at home
 *   in a sentence; the bar beside it is decoration and is `aria-hidden`.
 * - **Undo instead of confirm.** A tap ticks an item off with no dialogue, and
 *   the trolley below unticks it. That is deliberately *not* a ten-second
 *   toast: a toast that expires is an undo you can miss while reaching for
 *   the next shelf, and the trolley is an undo that is still there at the
 *   till.
 * - **Everything works with a thumb.** 48px targets, the whole row tappable,
 *   nothing behind a menu.
 *
 * Every write goes through the queue, so the screen works with no signal at
 * all — which is the point of the phase before this one.
 */
export default function ShopPage(): JSX.Element {
  const t = useTranslations("shopping");
  const { state: queue, enqueue } = useWriteQueue();
  const [trolleyOpen, setTrolleyOpen] = useState(false);

  const query = api.shopping.getBuyList.useQuery();

  if (!query.data) {
    return (
      <RouteState
        error={query.error}
        fetchStatus={query.fetchStatus}
        isLoading={query.isPending}
        onRetry={() => void query.refetch()}
        title={t("shopTitle")}
        width="form"
      />
    );
  }

  // The queue folded on top, so a tap shows as done before it is sent.
  const items = projectShoppingItems(query.data, queue.pending);
  const toBuy = items.filter((item) => !item.isChecked);
  const trolley = items.filter((item) => item.isChecked);

  function setChecked(
    item: (typeof items)[number],
    isChecked: boolean,
  ): void {
    enqueue({
      path: "shopping.updateItem",
      input: { id: item.id, isChecked },
      label: {
        key: isChecked ? "offline.tickedOff" : "offline.untickedOff",
        values: { name: item.name },
      },
    });
  }

  return (
    <PageShell width="form">
      <PageHeader className="mb-0" title={t("shopTitle")} />

      {/* The primary action, always on top and always the same size.
          Its colour, hover and focus ring come from `Button` rather than
          being written out beside it — they were, and a hand-written
          `bg-primary` is a copy of the primitive that stops matching it the
          moment the primitive changes. What stays local is the geometry:
          64px and full width is Screen A's own decision, a row read with a
          trolley in one hand, and no size in the primitive means that. */}
      <Button
        asChild
        className="mt-4 min-h-[64px] w-full gap-3 rounded-xl py-4 text-lg font-semibold"
      >
        <Link href="/products/scan">
          <ScanLine aria-hidden="true" className="size-5 shrink-0" />
          {t("scan")}
        </Link>
      </Button>

      {/* Sentence case, in the one section size. "PARA COMPRAR" in small
          tracked grey capitals was a label rather than a heading, and the
          count is said in words beside it rather than as a bare number. */}
      <Section
        aside={
          <span className="text-muted-foreground">
            {t("itemsCount", { count: toBuy.length })}
          </span>
        }
        className="mt-8"
        title={t("toBuy")}
      >
        {toBuy.length === 0 ? (
          <div>
            <p className="text-foreground">{t("nothingToBuy")}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("nothingToBuyHint")}
            </p>
            <Button asChild className="mt-4" variant="link">
              <Link href="/shopping/lists" > {t("manageLists")} </Link>
            </Button>
          </div>
        ) : (
          // Rows, not cards: a border and a background around every item of a
          // list is visual overhead (Noel's review, 2026-08-19). A divider is
          // all the separation a list needs.
          <ul className="divide-y divide-border">
            {toBuy.map((item) => (
              <li key={item.id}>
                <ShopRow item={item} onToggle={() => setChecked(item, true)} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <section aria-labelledby="trolley" className="mt-8">
        {/* Folded away, because what is already in the trolley is not the
            question being asked in the aisle — but folded *visibly*. As a
            bare uppercase label this read as a heading, and nobody taps
            headings, so nobody found their ticked items again. It is set in
            the same header type as "Para comprar" above it — one screen, one
            header language — and what says "this one opens" is the chevron
            and the count kept in words inside the control, not a box around
            it (Noel's second pass, 2026-08-19: the card dress went). The
            chevron is aria-hidden: aria-expanded already tells a screen
            reader what a sighted thumb learns from the arrow. */}
        <h2 id="trolley">
          <button
            aria-expanded={trolleyOpen}
            className={`flex min-h-[48px] w-full items-center justify-between gap-3 text-left ${sectionHeading()}`}
            onClick={() => setTrolleyOpen((open) => !open)}
            type="button"
          >
            {t("inTrolley")}
            <span className="flex items-center gap-2 text-base text-muted-foreground">
              <span className="font-normal">
                {t("trolleyCount", { count: trolley.length })}
              </span>
              <ChevronDown
                aria-hidden="true"
                className={`size-5 shrink-0 transition-transform motion-reduce:transition-none ${
                  trolleyOpen ? "rotate-180" : ""
                }`}
              />
            </span>
          </button>
        </h2>

        {trolleyOpen && trolley.length > 0 && (
          <ul className="mt-1 divide-y divide-border">
            {trolley.map((item) => (
              <li key={item.id}>
                <ShopRow
                  item={item}
                  onToggle={() => setChecked(item, false)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <Button asChild className="mt-8" variant="link">
        <Link href="/shopping/lists" > {t("manageLists")} </Link>
      </Button>
    </PageShell>
  );
}

interface Row {
  id: string;
  name: string;
  quantity: number;
  unit: string | null;
  isChecked: boolean;
  stock: number | null;
  minStock: number | null;
  listName: string;
  pending: boolean;
  /** An addition not sent yet, whose id is the queued change's. */
  queued: boolean;
}

/**
 * One thing to buy.
 *
 * The whole row is the control — a checkbox next to a label means two targets
 * and one of them is 13px. It is a `button` with `aria-pressed` rather than a
 * checkbox because "ticked off" is a state being toggled, and because the
 * accessible name can then say what the tap will do.
 *
 * **An addition that has not been sent cannot be ticked yet.** Its id is the
 * queued change's, so a tick sent with it was refused as a row that does not
 * exist and the tap was lost. The row says so in words and the control waits.
 */
function ShopRow({
  item,
  onToggle,
}: {
  item: Row;
  onToggle: () => void;
}): JSX.Element {
  const t = useTranslations("shopping");
  const units = useQuantityFormat();

  // `== null`, not `=== null`: a row composed offline is spread from the
  // queued `addItem` input, which has no stock figures at all — `undefined`
  // slipped past a strict check, drew a bar `NaN%` wide, and with no queued
  // branch above would have reached `stockOf` with nothing to fill it.
  const hasNotch = item.stock != null && item.minStock != null;
  const filled =
    hasNotch && (item.minStock as number) > 0
      ? Math.min(100, ((item.stock as number) / (item.minStock as number)) * 100)
      : 0;

  return (
    // A row, not a card: the tick circle, the words and the list's dividers
    // carry the state, so the box that used to wrap each item is gone
    // (Noel's review, 2026-08-19).
    <button
      aria-pressed={item.isChecked}
      className="flex min-h-[64px] w-full items-center gap-3 py-3 text-left hover:bg-accent disabled:hover:bg-transparent"
      disabled={item.queued}
      onClick={onToggle}
      type="button"
    >
      <span
        aria-hidden="true"
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
          item.isChecked
            ? "border-primary bg-primary text-primary-foreground"
            : "border-input"
        }`}
      >
        {item.isChecked ? "✓" : null}
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={`block font-medium ${
            item.isChecked ? "text-muted-foreground line-through" : "text-foreground"
          }`}
        >
          {item.name}
        </span>

        {/* In words. The bar below is decoration and says nothing on its own. */}
        <span className="block text-sm text-muted-foreground">
          {item.queued
            ? t("notSentYet")
            : item.stock == null || item.minStock == null
            ? item.stock === 0
              ? t("stockNone")
              : t("stockUnknown")
            : item.stock <= 0
              ? t("stockNone")
              : t("stockOf", {
                  stock: item.stock,
                  minimum: item.minStock,
                  unit: units.unit(item.unit, item.minStock),
                })}
        </span>

        {hasNotch ? (
          <span
            aria-hidden="true"
            className="mt-2 block h-2 w-full overflow-hidden rounded-full bg-gauge-track"
          >
            <span
              className="block h-2 rounded-full bg-gauge"
              style={{ width: `${filled}%` }}
            />
          </span>
        ) : null}
      </span>

      <span className="sr-only">
        {item.isChecked
          ? t("untick", { name: item.name })
          : t("tickOff", { name: item.name })}
      </span>
    </button>
  );
}
