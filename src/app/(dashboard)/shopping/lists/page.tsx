"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useSnackbar } from "@/components/ui/snackbar";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ItemRow } from "@/components/ui/item-row";
import { PageHeader, PageShell } from "@/components/ui/page-header";
import { api } from "@/lib/trpc/client";
import { RouteState } from "@/components/household/RouteState";
import { AutoListPreview } from "@/components/shopping/AutoListPreview";

export default function ShoppingListsPage() {
  const t = useTranslations();
  const [isCreating, setIsCreating] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [nameMissing, setNameMissing] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const nameId = useId();

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
    // A refusal used to say nothing: the form stayed open with the name in
    // it, which is exactly what an unpressed button looks like. It says so
    // now — and the form is left exactly as it was, name included, so trying
    // again is one press rather than retyping.
    onError: () =>
      snackbar.show({
        kind: "confirm",
        tone: "danger",
        message: { key: "shopping.createFailed" },
      }),
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
    onError: () =>
      snackbar.show({
        kind: "confirm",
        tone: "danger",
        message: { key: "shopping.generateFailed" },
      }),
  });

  // An empty name was silently ignored, so "Crear lista" on an empty field
  // did nothing and said nothing. It now says what is missing, beside the
  // field, and puts the cursor where the answer goes.
  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newListName.trim();
    if (!name) {
      setNameMissing(true);
      nameRef.current?.focus();
      return;
    }
    setNameMissing(false);
    createMutation.mutate({ name });
  };

  // Back to the screen this used to be. Filing is not shopping.
  const back = { href: "/shopping", label: t("shopping.backToShop") };

  // One primary. Both used to be filled, so the screen offered two equal
  // answers to "what do I do here" — and at 390px the pair beside the title
  // pushed the page to 399px wide (WCAG 1.4.10). Creating a list is the
  // thing this screen is for; generating one is the shortcut beside it.
  const actions = (
    <>
      {/* Gone while the form is open, as on the shops screen: the form's
          own submit is called the same, and two of them is a guess. */}
      {isCreating ? null : (
        <Button onClick={() => setIsCreating(true)} type="button">
          {t("shopping.create")}
        </Button>
      )}
      <Button
        disabled={generateMutation.isPending}
        onClick={() => generateMutation.mutate()}
        type="button"
        variant="outline"
      >
        {t("shopping.generateFromLowStock")}
      </Button>
    </>
  );

  // Three states, not two. `if (isLoading)` alone falls through on a failed
  // query and renders the empty state below, so someone with four lists is
  // told they have none and the only tell is that creating one appears to do
  // nothing (ISSUES.md UI-9).
  if (!lists) {
    return (
      <RouteState
        back={back}
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
    <PageShell width="index">
      <PageHeader actions={actions} back={back} title={t("shopping.title")} />
      <div className="space-y-6">
      <AutoListPreview />

      {isCreating && (
        <form
          noValidate
          onSubmit={handleCreate}
          className="rounded-lg border border-border bg-card p-4"
        >
          {/* A label, not a placeholder: a placeholder is the field's name
              only until somebody types in it. */}
          <label
            className="mb-1 block text-sm font-medium text-foreground"
            htmlFor={nameId}
          >
            {t("shopping.listName")}
          </label>
          <Input
            aria-describedby={
              nameMissing ? `${nameId}-hint ${nameId}-error` : `${nameId}-hint`
            }
            aria-invalid={nameMissing ? true : undefined}
            autoComplete="off"
            id={nameId}
            onChange={(e) => {
              setNewListName(e.target.value);
              if (e.target.value.trim()) setNameMissing(false);
            }}
            ref={nameRef}
            type="text"
            value={newListName}
          />
          <p className="mt-1 text-sm text-muted-foreground" id={`${nameId}-hint`}>
            {t("shopping.listNameHint")}
          </p>
          {nameMissing ? (
            <p
              className="mt-1 text-sm font-medium text-danger-foreground"
              id={`${nameId}-error`}
            >
              {t("shopping.listNameRequired")}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="submit"
            disabled={createMutation.isPending}
          >
            {t("shopping.create")}
          </Button>
          {/* Steps aside; it does not compete. Drawn as the filled primary
              it was indistinguishable from "Crear", which is the one action
              on this form that does something. */}
          <Button
            onClick={() => {
              setIsCreating(false);
              setNewListName("");
              setNameMissing(false);
            }}
            type="button"
            variant="outline"
          >
            {t("common.cancel")}
          </Button>
          </div>
        </form>
      )}

      {lists.length === 0 ? (
        <EmptyState
          action={
            isCreating ? undefined : (
              <Button onClick={() => setIsCreating(true)} type="button" variant="outline">
                {t("shopping.create")}
              </Button>
            )
          }
          body={t("shopping.createFirst")}
          title={t("shopping.noLists")}
        />
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
    </PageShell>
  );
}
