"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { TRPCClientError } from "@trpc/client";
import { api } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PageHeader,
  PageShell,
  type PageBack,
  type PageWidth,
} from "@/components/ui/page-header";
import type { FormEvent, JSX, ReactNode } from "react";

/**
 * The same three states for one section of a screen rather than a whole one.
 *
 * Some screens are several questions, and one of them failing is not the
 * screen failing: the dashboard's restock list is still true when its expiry
 * question could not be asked. Those sections used to treat "no answer" as
 * "an empty answer" — `data ?? []` — so a failed or paused expiry query said
 * "nothing is about to go off", which is the one failure that reads as good
 * news.
 *
 * No title and no household form: the route around it owns both. A section
 * is told what its query is doing and says so, in the same polite region
 * shape `RouteState` uses and for the same reason.
 */
export function SectionState({
  error,
  fetchStatus,
  onRetry,
}: Pick<RouteStateProps, "error" | "fetchStatus" | "onRetry">): JSX.Element {
  const t = useTranslations("household");
  const offline = useTranslations("offline");
  const paused = fetchStatus === "paused";
  const failed = !paused && error !== null && error !== undefined;

  return (
    <div aria-live="polite" className="mt-2" role="status">
      {paused || failed ? (
        <>
          <p className="text-muted-foreground">
            {paused ? offline("nothingSavedTitle") : t("loadFailedTitle")}
          </p>
          <Button className="mt-2" onClick={onRetry} size="sm" type="button" variant="outline">
            {paused ? offline("refresh") : t("retry")}
          </Button>
        </>
      ) : (
        <div aria-busy="true" className="space-y-2">
          <p className="sr-only">{t("loading")}</p>
          {["skeleton-1", "skeleton-2"].map((key) => (
            <div key={key} className="h-12 animate-pulse rounded bg-muted" />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * What a data route shows when it has no data yet.
 *
 * Three states, and telling them apart is the whole point. Every dashboard
 * route used to render `if (isLoading || !result)`, so a query that failed —
 * for any reason — left the loading skeleton on screen for ever, with no
 * message, no retry and no way forward (ISSUES.md UI-8). One of those reasons
 * was structural rather than transient: an account with no household, which
 * every household-scoped procedure refuses and no amount of waiting fixes
 * (HOUSE-1).
 *
 * - **Nothing saved** — offline, with nothing cached for this screen. TanStack
 *   Query calls this `fetchStatus: "paused"`, and it is not a failure: no
 *   request was made, so there is nothing to retry until there is signal.
 * - **Loading** — the skeleton, as before.
 * - **No household** — a form to create one. The account is fine; it is
 *   missing a precondition it can supply itself, which is why the server says
 *   PRECONDITION_FAILED rather than FORBIDDEN.
 * - **Anything else** — what happened, and a button to try again.
 *
 * The paused branch comes first because a paused query is *also* `isPending`,
 * so a skeleton would win and someone with no signal would watch it for ever —
 * which is UI-8 again, arrived at from the other direction.
 *
 * - **Not found** — when the route says what that means. The server said the
 *   thing does not exist, so retrying is pointless; the honest screen is a
 *   title saying so, a sentence saying why it might be, and the way back.
 *   Two routes drew this as a bare "No encontrado" with no heading and no way
 *   out — a dead end, reached from a link that used to work.
 *
 * `fetchStatus` is required rather than defaulted. A default would silently
 * give every existing caller the old behaviour, which is the bug; the compiler
 * is what makes each route decide.
 *
 * **What sits above the data is drawn while there is no data.** The title,
 * the way back and the primary action come through `PageHeader` exactly as
 * the loaded screen draws them, so loading does not move them, and a person
 * who already knows where they are going can go there — "Nuevo producto"
 * does not need the catalogue to have arrived.
 */

interface RouteStateProps {
  title: string;
  /** The way back, as the loaded screen draws it. */
  back?: PageBack;
  /** The screen's actions, when they do not depend on the data. */
  actions?: ReactNode;
  /** The loaded screen's width. Defaults to an index's. */
  width?: PageWidth;
  density?: "default" | "touch";
  /**
   * What to say when the server answers NOT_FOUND. Without it, a NOT_FOUND
   * is treated as any other failure and offered a retry.
   */
  notFound?: { title: string; body: string; back?: PageBack };
  /** The failing query, so this component can retry it. */
  isLoading: boolean;
  error: unknown;
  /** `query.fetchStatus` — `"paused"` means offline with no request in flight. */
  fetchStatus: "fetching" | "paused" | "idle";
  onRetry: () => void;
}

/** True when the server said the caller has no household. */
export function isNoHouseholdError(error: unknown): boolean {
  return (
    error instanceof TRPCClientError &&
    error.data?.code === "PRECONDITION_FAILED"
  );
}

/** True when the server said the thing being asked for does not exist. */
export function isNotFoundError(error: unknown): boolean {
  return (
    error instanceof TRPCClientError && error.data?.code === "NOT_FOUND"
  );
}

export function RouteState({
  title,
  back,
  actions,
  width = "index",
  density,
  notFound,
  isLoading,
  error,
  fetchStatus,
  onRetry,
}: RouteStateProps): JSX.Element {
  const t = useTranslations("household");
  const offline = useTranslations("offline");

  // The no-household branch is a form rather than a message, so it leaves
  // before the live region below — a `role="status"` wrapped around a form
  // announces the whole form. No actions: every one of them would be refused
  // for the same missing household.
  if (isNoHouseholdError(error)) {
    return (
      <PageShell width={width}>
        <PageHeader back={back} density={density} title={title} />
        <CreateHousehold />
      </PageShell>
    );
  }

  const paused = fetchStatus === "paused";
  const missing = !paused && notFound !== undefined && isNotFoundError(error);

  /**
   * One region, present from the first render, whose *contents* change.
   *
   * The three branches used to be three separate returns, each a plain
   * `<div>`. So nothing here was a live region at all: the skeleton said
   * nothing — `aria-busy` on a container that is not live is not announced —
   * and when the query failed, React swapped the skeleton for a failure panel
   * in silence. On the seven routes that render this, a screen-reader user
   * reading elsewhere on the page was never told the screen had given up
   * (WCAG 4.1.3).
   *
   * It has to be one element rather than one per branch. A region created at
   * the moment it gains text is the case readers may skip, so the wrapper
   * lives at a fixed position in the tree and React keeps the same DOM node
   * across every state change — only what is inside it moves.
   *
   * Polite, never `alert`: `SyncStatus` owns the one assertive region in this
   * shell and a second would make `getByRole("alert")` ambiguous everywhere.
   */
  return (
    <PageShell width={width}>
      {/* At the same place in the tree in every branch, so the live region
          below stays the same DOM node when the title changes to say the
          thing is gone. The actions leave with it: nothing is left for them
          to act on. */}
      <PageHeader
        actions={missing ? undefined : actions}
        back={missing ? (notFound.back ?? back) : back}
        density={density}
        title={missing ? notFound.title : title}
      />
      <div aria-live="polite" role="status">
        {missing ? (
          <p className="text-muted-foreground">{notFound.body}</p>
        ) : isLoading && !paused ? (
          <div className="space-y-4" aria-busy="true">
            <p className="sr-only">{t("loading")}</p>
            {["skeleton-1", "skeleton-2", "skeleton-3", "skeleton-4", "skeleton-5"].map(
              (key) => (
                <div key={key} className="h-16 animate-pulse rounded bg-muted" />
              ),
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-input bg-card p-6">
            <h2 className="text-lg font-semibold text-heading">
              {paused ? offline("nothingSavedTitle") : t("loadFailedTitle")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {paused ? offline("nothingSavedBody") : t("loadFailedBody")}
            </p>
            <Button className="mt-4" onClick={onRetry} type="button">
              {paused ? offline("refresh") : t("retry")}
            </Button>
          </div>
        )}
      </div>
    </PageShell>
  );
}

/**
 * The way out of the no-household state.
 *
 * Of the three fixes HOUSE-1 suggests — require a household at registration,
 * create one implicitly, or detect the state and offer a way out — this is the
 * third. The first would break the invitation flow that Phase 3's neighbours
 * need (someone joining an existing household must be able to register without
 * making a second one), and the second silently creates a household named after
 * nothing, which is worse than asking.
 */
function CreateHousehold(): JSX.Element {
  const t = useTranslations("household");
  const utils = api.useUtils();
  const [name, setName] = useState("");
  const [failed, setFailed] = useState(false);

  const create = api.household.create.useMutation({
    onSuccess: async () => {
      setFailed(false);
      // Everything on this route was refused for want of a household, so the
      // whole cache is stale rather than one query of it.
      await utils.invalidate();
    },
    onError: () => setFailed(true),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    create.mutate({ name: trimmed });
  }

  return (
    <div>
      <div className="rounded-xl border border-input bg-card p-6">
        <h2 className="text-lg font-semibold text-heading">{t("noHouseholdTitle")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("noHouseholdBody")}</p>

        <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={handleSubmit}>
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium" htmlFor="household-name">
              {t("nameLabel")}
            </label>
            <Input
              aria-describedby="household-name-hint"
              autoComplete="off"
              id="household-name"
              name="householdName"
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
            <p className="mt-1 text-sm text-muted-foreground" id="household-name-hint">
              {t("nameHint")}
            </p>
          </div>
          <Button
            className="sm:mt-7 sm:w-auto"
            disabled={create.isPending || name.trim().length === 0}
            type="submit"
          >
            {create.isPending ? t("creating") : t("createHousehold")}
          </Button>
        </form>

        {/* Always mounted, empty when there is nothing to say: a region
            created at the moment it has something to say is one some readers
            never announce (SyncStatus.tsx:64-65). It stays here rather than
            becoming a snackbar because the form you would retry from is on
            screen, and the reason has to still be there when you look back
            at it. */}
        <p
          aria-live="polite"
          className={
            failed
              ? "mt-4 rounded-xl border border-danger-foreground bg-danger px-4 py-3 text-sm text-danger-foreground"
              : "sr-only"
          }
          role="status"
        >
          {failed ? t("createFailed") : ""}
        </p>
      </div>
    </div>
  );
}
