"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useSnackbar } from "@/components/ui/snackbar";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ItemRow } from "@/components/ui/item-row";
import { api } from "@/lib/trpc/client";
import { RouteState } from "@/components/household/RouteState";
import { AutoListPreview } from "@/components/shopping/AutoListPreview";

export default function ShoppingListsPage() {
  const t = useTranslations();
  const [isCreating, setIsCreating] = useState(false);
  const [newListName, setNewListName] = useState("");

  const listsQuery = api.shopping.list.useQuery({
    includeCompleted: false,
  });
  const lists = listsQuery.data;

  const snackbar = useSnackbar();
  const utils = api.useUtils();

  // Both of these add a list, and neither refreshed the list they added it to.
  // Combined with the filter that hid an empty list, "Crear lista" looked like
  // it did nothing at all — twice over.
  const createMutation = api.shopping.create.useMutation({
    onSuccess: (list) => {
      setIsCreating(false);
      setNewListName("");
      void utils.shopping.list.invalidate();
      snackbar.show({
        kind: "confirm",
        message: { key: "shopping.listCreated", values: { name: list.name } },
      });
    },
  });

  const generateMutation = api.shopping.generateFromLowStock.useMutation({
    onSuccess: () => {
      void utils.shopping.list.invalidate();
      void utils.shopping.getAutoList.invalidate();
      // Deliberately says what was *done*, not what was found. The procedure
      // adds nothing when everything is above its minimum, and a button that
      // reports "0 productos añadidos" reads as a failure rather than as good
      // news about the cupboard.
      snackbar.show({
        kind: "confirm",
        message: { key: "shopping.autoListUpToDate" },
      });
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (newListName.trim()) {
      createMutation.mutate({ name: newListName.trim() });
    }
  };

  // Three states, not two. `if (isLoading)` alone falls through on a failed
  // query and renders the empty state below, so someone with four lists is
  // told they have none and the only tell is that creating one appears to do
  // nothing (ISSUES.md UI-9).
  if (!lists) {
    return (
      <RouteState
        error={listsQuery.error}
        fetchStatus={listsQuery.fetchStatus}
        isLoading={listsQuery.isPending}
        onRetry={() => void listsQuery.refetch()}
        title={t("shopping.title")}
      />
    );
  }

  return (
    // Bounded like every other index. Unbounded, it ran the full width of the
    // layout's 7xl while `/inventory` and `/products` beside it stopped at
    // 6xl — the same list, two line lengths, depending which one you opened.
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-heading">
            {t("shopping.title")}
          </h1>
          {/* Back to the screen this used to be. Filing is not shopping. */}
          <Button asChild className="mt-1" variant="link">
            <Link href="/shopping" > {t("shopping.shopTitle")} </Link>
          </Button>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
          >
            {t("shopping.generateFromLowStock")}
          </Button>
          <Button
            type="button"
            onClick={() => setIsCreating(true)}
          >
            {t("shopping.create")}
          </Button>
        </div>
      </div>

      <AutoListPreview />

      {isCreating && (
        <form
          onSubmit={handleCreate}
          className="flex gap-2 rounded-lg border border-border bg-card p-4"
        >
          <Input
            type="text"
            placeholder={t("shopping.listName")}
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
          />
          <Button
            type="submit"
            disabled={createMutation.isPending}
          >
            {t("common.create")}
          </Button>
          {/* Steps aside; it does not compete. Drawn as the filled primary
              it was indistinguishable from "Crear", which is the one action
              on this form that does something. */}
          <Button
            onClick={() => {
              setIsCreating(false);
              setNewListName("");
            }}
            type="button"
            variant="outline"
          >
            {t("common.cancel")}
          </Button>
        </form>
      )}

      {lists.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
          <p>{t("shopping.noLists")}</p>
          <p className="mt-2 text-sm">{t("shopping.createFirst")}</p>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {lists.map((list) => {
            const totalItems = list.items.length;
            const checkedItems = list.items.filter((item) => item.isChecked).length;
            const progress = totalItems > 0 ? (checkedItems / totalItems) * 100 : 0;

            return (
              /* `ItemRow`, and the title is what links.
                 The whole card used to be one `<Link>`, so its accessible
                 name was everything inside it read as a single run —
                 "Compra del sábado auto-generada 7 artículos Progreso 3/7" —
                 which is the arrangement `ItemRow`'s contract exists to
                 prevent. The pill was hand-written too, and `bg-warn`:
                 "auto-generada" is not a state of health, so it is neutral,
                 which is the rule `Badge`'s own docblock states. */
              <ItemRow
                href={`/shopping/${list.id}`}
                key={list.id}
                meta={[
                  {
                    label: t("shopping.itemsLabel"),
                    value: t("shopping.itemsCount", { count: totalItems }),
                  },
                  ...(totalItems > 0
                    ? [
                        {
                          label: t("shopping.progress"),
                          value: (
                            <>
                              <span className="tabular-nums">
                                {checkedItems}/{totalItems}
                              </span>
                              <span
                                aria-hidden="true"
                                className="mt-1 block h-2 rounded-full bg-gauge-track"
                              >
                                <span
                                  className="block h-2 rounded-full bg-gauge transition-all"
                                  style={{ width: `${progress}%` }}
                                />
                              </span>
                            </>
                          ),
                        },
                      ]
                    : []),
                ]}
                status={
                  list.isAutoGenerated ? (
                    <Badge tone="neutral">{t("shopping.autoGenerated")}</Badge>
                  ) : undefined
                }
                title={list.name}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}
