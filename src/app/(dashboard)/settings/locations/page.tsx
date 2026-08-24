"use client";

import { useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { TRPCClientError } from "@trpc/client";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ItemRow } from "@/components/ui/item-row";
import { Select } from "@/components/ui/select";
import { useSnackbar } from "@/components/ui/snackbar";
import { RouteState } from "@/components/household/RouteState";
import { api } from "@/lib/trpc/client";
// The shape the procedure declares, rather than a fourth hand-written copy of
// it. `TRPCProvider` imports `AppRouter` the same way: a type-only import,
// erased before anything reaches the browser.
import type { LocationTreeNode } from "@/server/trpc/routers/location";
import type { FormEvent, JSX } from "react";

/**
 * Where things are kept, and the screen that can finally change it.
 *
 * `locationRouter` has had `create`, `update` and `delete` since Phase 2 and
 * this route reached none of them: it drew the tree read-only and said, in a
 * hardcoded paragraph, that the locations "se pueden crear al añadir stock".
 * That was true and useless — the add-stock form only offers locations that
 * already exist, so the *first* one could not be made from anywhere in the
 * interface, and none could ever be renamed or removed. Three working
 * procedures with no caller is not a smaller defect than three missing ones.
 *
 * It is built as `/settings/stores` is, because it is the same screen with a
 * different noun: a list, an inline form that doubles as create and edit, and
 * per-row actions. What it does not share is the hierarchy, and that costs
 * three things this file has and that one does not:
 *
 * - a **parent select**, flattened from the tree with the depth spelled out in
 *   the option label rather than drawn with indentation, which a native
 *   `<select>` does not render;
 * - **the subtree of whatever is being edited removed from that select**,
 *   because `update` refuses a move into your own descendant — it would cut
 *   the branch off from the root — and offering the option is offering a
 *   refusal;
 * - **nested `<ul>`s**, so the tree a reader sees is the tree a screen reader
 *   announces.
 *
 * Every write is `adminProcedure`. The role gate here is courtesy, exactly as
 * it is on the shops screen — the server is the control — but a MEMBER shown
 * three buttons that all fail is worse off than one told once, plainly.
 */

/** A location and how deep it sits, in the order the tree reads. */
interface FlatLocation {
  id: string;
  name: string;
  depth: number;
}

/** Depth-first, each parent immediately before its own subtree. */
function flatten(nodes: LocationTreeNode[], depth = 0): FlatLocation[] {
  return nodes.flatMap((node) => [
    { id: node.id, name: node.name, depth },
    ...flatten(node.children, depth + 1),
  ]);
}

/** Every id under `id`, itself included: what `update` will not take as a parent. */
function subtreeIds(nodes: LocationTreeNode[], id: string): Set<string> {
  const found = new Set<string>();

  const collect = (node: LocationTreeNode): void => {
    found.add(node.id);
    for (const child of node.children) collect(child);
  };

  const find = (list: LocationTreeNode[]): boolean =>
    list.some((node) => {
      if (node.id === id) {
        collect(node);
        return true;
      }
      return find(node.children);
    });

  find(nodes);
  return found;
}

/** Every location's name by id, so a row can say which one holds it. */
function namesById(nodes: LocationTreeNode[]): Map<string, string> {
  return new Map(flatten(nodes).map((entry) => [entry.id, entry.name]));
}

function LocationTree({
  locations,
  names,
  onEdit,
  onDelete,
  canManage,
  deleting,
  depth = 0,
}: {
  locations: LocationTreeNode[];
  names: Map<string, string>;
  onEdit: (location: LocationTreeNode) => void;
  onDelete: (location: LocationTreeNode) => void;
  canManage: boolean;
  deleting: boolean;
  depth?: number;
}): JSX.Element | null {
  const t = useTranslations("locations");
  // The row's two actions are the same verbs the shops screen uses, from the
  // same place: "Editar" and "Eliminar" name what the button does. The
  // `locations.*` pair beside them name the *form*, "Editar ubicación", which
  // is a heading rather than a control.
  const tCommon = useTranslations("common");

  if (locations.length === 0) return null;

  return (
    <ul className={depth > 0 ? "mt-3 space-y-3 pl-4 md:pl-8" : "space-y-3"}>
      {locations.map((location) => {
        const stored = location._count.stockEntries;
        const parentName = location.parentId
          ? names.get(location.parentId)
          : undefined;

        // Only what is true of this row. A location holding nothing and
        // inside nothing gets no definition list at all, rather than three
        // rows of zeroes and dashes.
        const meta = [
          ...(stored > 0 ? [{ label: t("stored"), value: String(stored) }] : []),
          ...(location.children.length > 0
            ? [{ label: t("contains"), value: String(location.children.length) }]
            : []),
          ...(parentName ? [{ label: t("inside"), value: parentName }] : []),
        ];

        return (
          <li key={location.id}>
            {/* `as="div"` with the `<li>` written here instead: the subtree
                below belongs *inside* the item it hangs off, and `ItemRow`
                has no slot for it. The list semantics are unchanged and the
                row is still the one row this application draws. */}
            <ItemRow
              actions={
                canManage ? (
                  <>
                    <Button
                      onClick={() => onEdit(location)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {tCommon("edit")}
                      <span className="sr-only"> {location.name}</span>
                    </Button>
                    <Button
                      disabled={deleting}
                      onClick={() => onDelete(location)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <span className="text-destructive">
                        {tCommon("delete")}
                      </span>
                      <span className="sr-only"> {location.name}</span>
                    </Button>
                  </>
                ) : undefined
              }
              as="div"
              meta={meta.length > 0 ? meta : undefined}
              title={location.name}
            />

            <LocationTree
              canManage={canManage}
              deleting={deleting}
              depth={depth + 1}
              locations={location.children}
              names={names}
              onDelete={onDelete}
              onEdit={onEdit}
            />
          </li>
        );
      })}
    </ul>
  );
}

export default function LocationsPage(): JSX.Element {
  const t = useTranslations("locations");
  const tCommon = useTranslations("common");
  const fieldId = useId();
  const snackbar = useSnackbar();
  const utils = api.useUtils();

  const locationsQuery = api.location.getTree.useQuery();
  const me = api.auth.me.useQuery(undefined, { retry: false });
  const canManage = me.data?.role === "OWNER" || me.data?.role === "ADMIN";

  const [isEditing, setIsEditing] = useState(false);
  const [editing, setEditing] = useState<LocationTreeNode | null>(null);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");

  const tree = useMemo(() => locationsQuery.data ?? [], [locationsQuery.data]);
  const names = useMemo(() => namesById(tree), [tree]);

  /**
   * What the parent select may offer: everything, minus the subtree of
   * whatever is being edited.
   *
   * `update` refuses a move into your own descendant and refuses a location
   * as its own parent. Both refusals are right, and neither is worth
   * discovering by pressing Guardar.
   */
  const parentOptions = useMemo(() => {
    const forbidden = editing ? subtreeIds(tree, editing.id) : new Set<string>();
    return flatten(tree).filter((entry) => !forbidden.has(entry.id));
  }, [editing, tree]);

  function closeForm(): void {
    setIsEditing(false);
    setEditing(null);
    setName("");
    setParentId("");
  }

  function reportSaveFailure(): void {
    snackbar.show({
      kind: "confirm",
      tone: "danger",
      message: { key: "locations.saveFailed" },
    });
  }

  // Every mutation invalidates the tree it just changed. The shops screen
  // learned this the expensive way (`StoresPage.test.tsx`): without it a
  // created location does not appear until the route is left and re-entered,
  // and the form closing is the only sign anything happened at all.
  const createMutation = api.location.create.useMutation({
    onSuccess: async (location) => {
      closeForm();
      await utils.location.invalidate();
      snackbar.show({
        kind: "confirm",
        message: { key: "locations.created", values: { name: location.name } },
      });
    },
    // A failure left the form open with the data still in it and said nothing,
    // so a refused write looked like a form somebody had not finished.
    onError: () => reportSaveFailure(),
  });

  const updateMutation = api.location.update.useMutation({
    onSuccess: async (location) => {
      closeForm();
      await utils.location.invalidate();
      snackbar.show({
        kind: "confirm",
        message: { key: "locations.updated", values: { name: location.name } },
      });
    },
    onError: () => reportSaveFailure(),
  });

  // No `onSuccess`: the removed location's name survives in neither the input
  // nor the result, so the per-call form is the only place that still knows
  // which one it was.
  const deleteMutation = api.location.delete.useMutation();

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    const trimmed = name.trim();
    if (!trimmed) return;

    // `undefined` rather than `""`: the schema takes an optional id, and the
    // empty string is a location id that does not exist.
    const parent = parentId === "" ? undefined : parentId;

    if (editing) {
      updateMutation.mutate({ id: editing.id, name: trimmed, parentId: parent });
    } else {
      createMutation.mutate({ name: trimmed, parentId: parent });
    }
  }

  function handleEdit(location: LocationTreeNode): void {
    setEditing(location);
    setName(location.name);
    setParentId(location.parentId ?? "");
    setIsEditing(true);
  }

  function handleDelete(location: LocationTreeNode): void {
    deleteMutation.mutate(
      { id: location.id },
      {
        onSuccess: async () => {
          await utils.location.invalidate();
          snackbar.show({
            kind: "confirm",
            message: {
              key: "locations.deleted",
              values: { name: location.name },
            },
          });
        },
        // The specific sentence only for the specific failure. "Todavía tiene
        // algo dentro" is true of a CONFLICT and a guess about anything else,
        // so a refused permission or a dropped connection is not explained as
        // data that does not exist — the distinction the shops screen draws.
        onError: (error) =>
          snackbar.show({
            kind: "confirm",
            tone: "danger",
            message: {
              key:
                error instanceof TRPCClientError &&
                error.data?.code === "CONFLICT"
                  ? "locations.deleteFailed"
                  : "locations.deleteFailedUnknown",
              values: { name: location.name },
            },
          }),
      },
    );
  }

  // Three states, not two. `if (isLoading)` alone falls through on a failed
  // query and renders the empty state below, so someone with ten locations is
  // told they have none (ISSUES.md UI-9).
  if (!locationsQuery.data) {
    return (
      <RouteState
        error={locationsQuery.error}
        fetchStatus={locationsQuery.fetchStatus}
        isLoading={locationsQuery.isPending}
        onRetry={() => void locationsQuery.refetch()}
        title={t("title")}
      />
    );
  }

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="mx-auto max-w-2xl">
      <BackLink href="/settings">{t("backToSettings")}</BackLink>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-heading">{t("title")}</h1>
        {canManage && !isEditing ? (
          <Button onClick={() => setIsEditing(true)} type="button">
            {t("create")}
          </Button>
        ) : null}
      </div>

      <p className="mt-2 text-muted-foreground">{t("intro")}</p>

      {/* Said once, plainly, rather than left to be discovered by pressing
          something. A reader who cannot change the locations can still read
          them, which is the whole of what this screen is for them. */}
      {!canManage && me.data ? (
        <p className="mt-4 rounded border border-border bg-card p-4 text-muted-foreground">
          {t("readOnly")}
        </p>
      ) : null}

      {canManage && isEditing ? (
        <form
          className="mt-6 rounded-lg border border-border bg-card p-4"
          onSubmit={handleSubmit}
        >
          <h2 className="text-lg font-semibold text-heading">
            {editing ? t("edit") : t("create")}
          </h2>

          <div className="mt-4 space-y-4">
            <div>
              <label
                className="block text-sm font-medium text-foreground"
                htmlFor={`${fieldId}-name`}
              >
                {t("name")}
              </label>
              <Input
                autoComplete="off"
                className="mt-1"
                id={`${fieldId}-name`}
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </div>

            <div>
              <label
                className="block text-sm font-medium text-foreground"
                htmlFor={`${fieldId}-parent`}
              >
                {t("parent")}
              </label>
              <Select
                aria-describedby={`${fieldId}-parent-hint`}
                className="mt-1"
                id={`${fieldId}-parent`}
                onChange={(event) => setParentId(event.target.value)}
                value={parentId}
              >
                <option value="">{t("parentNone")}</option>
                {parentOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {/* Depth in the label rather than in the padding: the
                        native select is the right control here because a
                        phone opens the platform's own picker for it, and that
                        picker is also what will not honour indentation. */}
                    {`${"— ".repeat(option.depth)}${option.name}`}
                  </option>
                ))}
              </Select>
              <p
                className="mt-1 text-sm text-muted-foreground"
                id={`${fieldId}-parent-hint`}
              >
                {t("parentHint")}
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button disabled={saving} type="submit">
              {tCommon("save")}
            </Button>
            <Button onClick={closeForm} type="button" variant="outline">
              {tCommon("cancel")}
            </Button>
          </div>
        </form>
      ) : null}

      {tree.length === 0 ? (
        <div className="mt-6 rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
          <p>{t("noLocations")}</p>
          <p className="mt-2 text-sm">{t("addFirst")}</p>
        </div>
      ) : (
        <div className="mt-6">
          <LocationTree
            canManage={canManage}
            deleting={deleteMutation.isPending}
            locations={tree}
            names={names}
            onDelete={handleDelete}
            onEdit={handleEdit}
          />
        </div>
      )}
    </div>
  );
}
