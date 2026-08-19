"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { RouteState } from "@/components/household/RouteState";
import { useWriteQueue } from "@/components/offline/queue-context";
import { projectShoppingItems } from "@/lib/offline/project";
import type { JSX } from "react";

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
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold text-heading md:text-4xl">
        {t("shopTitle")}
      </h1>

      {/* The primary action, always on top and always the same size. */}
      <Link
        className="mt-4 flex min-h-[64px] w-full items-center justify-center gap-3 rounded-xl bg-primary px-4 py-4 text-lg font-semibold text-primary-foreground hover:bg-primary/90"
        href="/products/scan"
      >
        <svg
          aria-hidden="true"
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2M7 12h10"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {t("scan")}
      </Link>

      <section aria-labelledby="to-buy" className="mt-8">
        <h2
          className="flex items-baseline justify-between text-sm font-semibold uppercase tracking-wide text-muted-foreground"
          id="to-buy"
        >
          {t("toBuy")}
          <span className="text-base font-bold text-foreground">
            {toBuy.length}
          </span>
        </h2>

        {toBuy.length === 0 ? (
          <div className="mt-3 rounded-xl border border-border bg-card p-6">
            <p className="text-foreground">{t("nothingToBuy")}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("nothingToBuyHint")}
            </p>
            <Link
              className="mt-4 inline-flex min-h-[48px] items-center text-primary underline"
              href="/shopping/lists"
            >
              {t("manageLists")}
            </Link>
          </div>
        ) : (
          <ul className="mt-3 space-y-2">
            {toBuy.map((item) => (
              <li key={item.id}>
                <ShopRow item={item} onToggle={() => setChecked(item, true)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="trolley" className="mt-8">
        {/* Folded away, because what is already in the trolley is not the
            question being asked in the aisle — but folded *visibly*. As a
            bare uppercase label this read as a heading, and nobody taps
            headings, so nobody found their ticked items again. It now wears
            the same card language as the rows (in bg-muted, the colour
            ticked rows already wear), keeps its count in words inside the
            control, and carries a chevron. The chevron is aria-hidden:
            aria-expanded already tells a screen reader what a sighted thumb
            learns from the arrow. */}
        <h2 id="trolley">
          <button
            aria-expanded={trolleyOpen}
            className="flex min-h-[64px] w-full items-center gap-3 rounded-xl border border-border bg-muted p-4 text-left hover:bg-accent"
            onClick={() => setTrolleyOpen((open) => !open)}
            type="button"
          >
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-foreground">
                {t("inTrolley")}
              </span>
              <span className="block text-sm text-muted-foreground">
                {t("trolleyCount", { count: trolley.length })}
              </span>
            </span>
            <svg
              aria-hidden="true"
              className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${
                trolleyOpen ? "rotate-180" : ""
              }`}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </h2>

        {trolleyOpen && trolley.length > 0 && (
          <ul className="mt-2 space-y-2">
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

      <Link
        className="mt-8 inline-flex min-h-[48px] items-center text-primary underline"
        href="/shopping/lists"
      >
        {t("manageLists")}
      </Link>
    </div>
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
}

/**
 * One thing to buy.
 *
 * The whole row is the control — a checkbox next to a label means two targets
 * and one of them is 13px. It is a `button` with `aria-pressed` rather than a
 * checkbox because "ticked off" is a state being toggled, and because the
 * accessible name can then say what the tap will do.
 */
function ShopRow({
  item,
  onToggle,
}: {
  item: Row;
  onToggle: () => void;
}): JSX.Element {
  const t = useTranslations("shopping");

  const hasNotch = item.stock !== null && item.minStock !== null;
  const filled =
    hasNotch && (item.minStock as number) > 0
      ? Math.min(100, ((item.stock as number) / (item.minStock as number)) * 100)
      : 0;

  return (
    <button
      aria-pressed={item.isChecked}
      className={`flex min-h-[64px] w-full items-center gap-3 rounded-xl border p-4 text-left ${
        item.isChecked
          ? "border-border bg-muted"
          : "border-border bg-card hover:bg-accent"
      }`}
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
          {item.stock === null || item.minStock === null
            ? item.stock === 0
              ? t("stockNone")
              : t("stockUnknown")
            : item.stock <= 0
              ? t("stockNone")
              : t("stockOf", {
                  stock: item.stock,
                  minimum: item.minStock,
                  unit: item.unit ?? "",
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
