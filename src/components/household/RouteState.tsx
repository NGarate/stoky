"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { TRPCClientError } from "@trpc/client";
import { api } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FormEvent, JSX } from "react";

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
 * - **Loading** — the skeleton, as before.
 * - **No household** — a form to create one. The account is fine; it is
 *   missing a precondition it can supply itself, which is why the server says
 *   PRECONDITION_FAILED rather than FORBIDDEN.
 * - **Anything else** — what happened, and a button to try again.
 */

interface RouteStateProps {
  title: string;
  /** The failing query, so this component can retry it. */
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

/** True when the server said the caller has no household. */
export function isNoHouseholdError(error: unknown): boolean {
  return (
    error instanceof TRPCClientError &&
    error.data?.code === "PRECONDITION_FAILED"
  );
}

export function RouteState({
  title,
  isLoading,
  error,
  onRetry,
}: RouteStateProps): JSX.Element {
  const t = useTranslations("household");

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl">
        <h1 className="mb-6 text-2xl font-bold text-heading md:text-4xl">{title}</h1>
        <div className="space-y-4" aria-busy="true">
          {["skeleton-1", "skeleton-2", "skeleton-3", "skeleton-4", "skeleton-5"].map(
            (key) => (
              <div key={key} className="h-16 animate-pulse rounded bg-muted" />
            ),
          )}
        </div>
      </div>
    );
  }

  if (isNoHouseholdError(error)) {
    return <CreateHousehold title={title} />;
  }

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-6 text-2xl font-bold text-heading md:text-4xl">{title}</h1>
      <div className="rounded-xl border border-input bg-card p-6">
        <h2 className="text-lg font-semibold text-heading">{t("loadFailedTitle")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("loadFailedBody")}</p>
        <Button className="mt-4" onClick={onRetry} type="button">
          {t("retry")}
        </Button>
      </div>
    </div>
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
function CreateHousehold({ title }: { title: string }): JSX.Element {
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
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-6 text-2xl font-bold text-heading md:text-4xl">{title}</h1>
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

        {failed ? (
          <p
            aria-live="polite"
            className="mt-4 rounded-xl border border-danger-foreground bg-danger px-4 py-3 text-sm text-danger-foreground"
          >
            {t("createFailed")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
