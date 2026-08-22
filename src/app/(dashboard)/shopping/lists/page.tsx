"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useSnackbar } from "@/components/ui/snackbar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-heading">
            {t("shopping.title")}
          </h1>
          {/* Back to the screen this used to be. Filing is not shopping. */}
          <Link
            className="mt-1 inline-flex min-h-[48px] items-center text-primary underline"
            href="/shopping"
          >
            {t("shopping.shopTitle")}
          </Link>
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
          <Button
            type="button"
            onClick={() => {
              setIsCreating(false);
              setNewListName("");
            }}
          >
            {t("common.cancel")}
          </Button>
        </form>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {lists.length === 0 ? (
          <div className="col-span-full rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
            <p>{t("shopping.noLists")}</p>
            <p className="mt-2 text-sm">{t("shopping.createFirst")}</p>
          </div>
        ) : (
          lists.map((list) => {
            const totalItems = list.items.length;
            const checkedItems = list.items.filter((item) => item.isChecked).length;
            const progress = totalItems > 0 ? (checkedItems / totalItems) * 100 : 0;

            return (
              <Link
                key={list.id}
                href={`/shopping/${list.id}`}
                className="rounded-lg border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="mb-2 flex items-start justify-between">
                  <h2 className="font-semibold text-heading">{list.name}</h2>
                  {list.isAutoGenerated && (
                    <span className="rounded bg-warn px-2 py-0.5 text-xs text-warn-foreground">
                      {t("shopping.autoGenerated")}
                    </span>
                  )}
                </div>

                <p className="mb-3 text-sm text-muted-foreground">
                  {t("shopping.itemsCount", { count: totalItems })}
                </p>

                {totalItems > 0 && (
                  <div>
                    <div className="mb-1 flex justify-between text-xs">
                      <span>{t("shopping.progress")}</span>
                      <span>
                        {checkedItems}/{totalItems}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-gauge-track">
                      <div
                        className="h-2 rounded-full bg-gauge transition-all"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                )}
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
