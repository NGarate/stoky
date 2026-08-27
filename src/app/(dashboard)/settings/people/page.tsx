"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { TRPCClientError } from "@trpc/client";
import { useSnackbar } from "@/components/ui/snackbar";
import { Badge } from "@/components/ui/badge";
import { RadioOption } from "@/components/ui/radio-option";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BackLink } from "@/components/ui/back-link";
import { ItemRow } from "@/components/ui/item-row";
import { api } from "@/lib/trpc/client";
import { RouteState } from "@/components/household/RouteState";
import type { HouseholdRole } from "@prisma/client";
import type { FormEvent, JSX } from "react";

/**
 * Who is in the household, and how a kitchen account comes to exist.
 *
 * The `KITCHEN` role has been enforced on the server since Phase 3 and
 * unprovisionable ever since — the value was in the enum and in the middleware,
 * and the only way to get one was a database write. This is the interface that
 * makes it real, and without it the kitchen screen cannot be tested honestly:
 * a week-long run on a tablet under an owner's account proves nothing about
 * what a kitchen account can reach.
 *
 * There is no email in this application, so the admin sets the first password
 * and hands the device over. That is the honest shape for a self-hosted
 * household rather than a placeholder for an invitation flow that does not
 * exist.
 */
export default function PeoplePage(): JSX.Element {
  const t = useTranslations("household");
  const snackbar = useSnackbar();
  const fieldId = useId();
  const utils = api.useUtils();

  const members = api.household.members.useQuery();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"MEMBER" | "KITCHEN">("KITCHEN");
  const [failure, setFailure] = useState<"taken" | "other" | null>(null);

  const addMember = api.household.addMember.useMutation({
    onSuccess: (member) => {
      snackbar.show({
        kind: "confirm",
        message: { key: "household.addDone", values: { name: member.name } },
      });
      setFailure(null);
      setName("");
      setEmail("");
      setPassword("");
      void utils.household.members.invalidate();
    },
    onError: (error) => {
      // The database's own unique constraint, translated. Checking first and
      // then inserting would race with itself.
      const conflict =
        error instanceof TRPCClientError && error.data?.code === "CONFLICT";
      setFailure(conflict ? "taken" : "other");
    },
  });

  /**
   * The row being changed, and the row being removed — one at a time.
   *
   * Keyed by member id rather than held per row, because a row is a `map`
   * callback and cannot hold state of its own. `null` means "nobody", which is
   * the resting state for both.
   */
  const [pendingRole, setPendingRole] = useState<Record<string, HouseholdRole>>({});
  const [confirmingRemoval, setConfirmingRemoval] = useState<string | null>(null);
  const [confirmingRevoke, setConfirmingRevoke] = useState<string | null>(null);
  const [rowFailure, setRowFailure] = useState<{ id: string; message: string } | null>(
    null,
  );

  /**
   * The server's refusal, in words this household can act on.
   *
   * The two that matter are not errors in the usual sense — they are the
   * invariants doing their job, and each has something the reader can *do*.
   * `CONFLICT` is the last owner and the answer is to promote somebody first;
   * `FORBIDDEN` is an admin reaching for ownership, and the answer is to ask an
   * owner. Falling back to a generic sentence for anything else, because a
   * message invented for an unknown failure is worse than one that admits it.
   */
  function refusalMessage(error: unknown, kind: "role" | "remove"): string {
    const code =
      error instanceof TRPCClientError ? (error.data?.code as string | undefined) : undefined;

    if (code === "CONFLICT") {
      return kind === "role" ? t("roleFailedLastOwner") : t("removeFailedLastOwner");
    }
    if (code === "FORBIDDEN") {
      return kind === "role" ? t("roleFailedNotOwner") : t("removeFailedNotOwner");
    }
    return kind === "role" ? t("roleFailed") : t("removeFailed");
  }

  const updateRole = api.household.updateRole.useMutation({
    onSuccess: (member) => {
      snackbar.show({
        kind: "confirm",
        message: {
          key: "household.roleDone",
          values: { name: member.name, role: t(`role${member.role}`) },
        },
      });
      setRowFailure(null);
      setPendingRole((current) => {
        const next = { ...current };
        delete next[member.id];
        return next;
      });
      void utils.household.members.invalidate();
    },
    onError: (error, variables) => {
      setRowFailure({ id: variables.userId, message: refusalMessage(error, "role") });
    },
  });

  const revokeSessions = api.household.revokeMemberSessions.useMutation({
    onSuccess: (_result, variables) => {
      const target = members.data?.find((candidate) => candidate.id === variables.userId);
      snackbar.show({
        kind: "confirm",
        message: {
          key: "household.revokeDone",
          values: { name: target?.name ?? "" },
        },
      });
      setRowFailure(null);
      setConfirmingRevoke(null);
    },
    onError: (error, variables) => {
      const code =
        error instanceof TRPCClientError ? (error.data?.code as string | undefined) : undefined;
      setRowFailure({
        id: variables.userId,
        message: code === "FORBIDDEN" ? t("revokeFailedNotOwner") : t("revokeFailed"),
      });
    },
  });

  const removeMember = api.household.removeMember.useMutation({
    onSuccess: (_result, variables) => {
      const removed = members.data?.find((candidate) => candidate.id === variables.userId);
      snackbar.show({
        kind: "confirm",
        message: {
          key: "household.removeDone",
          values: { name: removed?.name ?? "" },
        },
      });
      setRowFailure(null);
      setConfirmingRemoval(null);
      void utils.household.members.invalidate();
    },
    onError: (error, variables) => {
      setRowFailure({ id: variables.userId, message: refusalMessage(error, "remove") });
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!name.trim() || !email.trim() || password.length < 8) return;
    addMember.mutate({ name: name.trim(), email: email.trim(), password, role });
  }

  if (!members.data) {
    return (
      <RouteState
        error={members.error}
        fetchStatus={members.fetchStatus}
        isLoading={members.isPending}
        onRetry={() => void members.refetch()}
        title={t("peopleTitle")}
      />
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-heading md:text-4xl">
          {t("peopleTitle")}
        </h1>
        <BackLink href="/settings">{t("backToSettings")}</BackLink>
      </div>

      <p className="text-muted-foreground">{t("peopleIntro")}</p>

      <ul className="mt-6 space-y-3">
        {members.data.map((member) => (
          <ItemRow
            key={member.id}
            meta={[{ label: t("addEmail"), value: member.email }]}
            /* The role in words. Never a colour or a letter. */
            status={<Badge tone="neutral">{t(`role${member.role}`)}</Badge>}
            title={member.name}
            actions={
              <div className="w-full">
                {confirmingRevoke === member.id ? (
                  /* Asked twice like a removal, and for the same reason: it
                     cannot be undone from here. Not `destructive` though —
                     nothing is destroyed, and the copy says so. Somebody who
                     has lost a device should not be made to feel they are
                     deleting the person. */
                  <div
                    role="group"
                    aria-label={t("revokeConfirmTitle", { name: member.name })}
                    className="rounded border border-border bg-muted p-3"
                  >
                    <p className="font-semibold text-foreground">
                      {t("revokeConfirmTitle", { name: member.name })}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t("revokeConfirmBody")}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-3">
                      <Button
                        disabled={revokeSessions.isPending}
                        onClick={() => revokeSessions.mutate({ userId: member.id })}
                        type="button"
                      >
                        {t("revokeConfirm")}
                      </Button>
                      <Button
                        onClick={() => {
                          setConfirmingRevoke(null);
                          setRowFailure(null);
                        }}
                        type="button"
                        variant="outline"
                      >
                        {t("revokeCancel")}
                      </Button>
                    </div>
                  </div>
                ) : confirmingRemoval === member.id ? (
                /* The same shape `product.delete` uses: asked twice, in the
                   audited danger pair, as a group a screen reader can announce
                   whole. A removal is not undoable from this screen. */
                <div
                  role="group"
                  aria-label={t("removeConfirmTitle", { name: member.name })}
                  className="rounded border border-danger-foreground bg-danger p-3"
                >
                  <p className="font-semibold text-danger-foreground">
                    {t("removeConfirmTitle", { name: member.name })}
                  </p>
                  <p className="mt-1 text-sm text-danger-foreground">
                    {t("removeConfirmBody")}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <Button
                      disabled={removeMember.isPending}
                      onClick={() => removeMember.mutate({ userId: member.id })}
                      type="button"
                      variant="destructive"
                    >
                      {t("removeConfirm")}
                    </Button>
                    <Button
                      onClick={() => {
                        setConfirmingRemoval(null);
                        setRowFailure(null);
                      }}
                      type="button"
                      variant="outline"
                    >
                      {t("removeCancel")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-end gap-3">
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const chosen = pendingRole[member.id];
                      if (!chosen || chosen === member.role) return;
                      updateRole.mutate({ userId: member.id, role: chosen });
                    }}
                  >
                    <div>
                      {/* Labelled with the member's name, because four rows of
                          "Rol" tell a screen reader which control it is and not
                          whose. */}
                      <label
                        className="block text-sm font-medium text-foreground"
                        htmlFor={`${fieldId}-role-${member.id}`}
                      >
                        {t("roleFor", { name: member.name })}
                      </label>
                      {/* The primitive, not a hand-styled `select`. It already
                          clears the 48px floor, and restating that here is what
                          `unit/target-floor.test.ts` exists to refuse — it
                          caught this exact line. */}
                      <Select
                        className="mt-1"
                        id={`${fieldId}-role-${member.id}`}
                        onChange={(event) =>
                          setPendingRole((current) => ({
                            ...current,
                            [member.id]: event.target.value as HouseholdRole,
                          }))
                        }
                        value={pendingRole[member.id] ?? member.role}
                      >
                        {(["OWNER", "ADMIN", "MEMBER", "KITCHEN"] as const).map(
                          (option) => (
                            <option key={option} value={option}>
                              {t(`role${option}`)}
                            </option>
                          ),
                        )}
                      </Select>
                    </div>
                    {/* Nothing is applied by touching the select. A role change
                        can lock a household out of itself, so it takes a
                        deliberate second act. */}
                    <Button
                      disabled={
                        updateRole.isPending ||
                        (pendingRole[member.id] ?? member.role) === member.role
                      }
                      type="submit"
                    >
                      {updateRole.isPending ? t("roleSaving") : t("roleSave")}
                    </Button>
                  </form>

                  {/* Two different problems, two different acts. "They left"
                      is a removal; "their phone was stolen" is this, and
                      offering only the first would make a household delete
                      somebody to answer the second. */}
                  <Button
                    onClick={() => {
                      setConfirmingRevoke(member.id);
                      setRowFailure(null);
                    }}
                    type="button"
                    variant="outline"
                  >
                    {t("revokeButton")}
                  </Button>

                  <Button
                    onClick={() => {
                      setConfirmingRemoval(member.id);
                      setRowFailure(null);
                    }}
                    type="button"
                    variant="outline"
                  >
                    {t("removeButton")}
                  </Button>
                  </div>
                )}

                {/* Always rendered, `sr-only` when empty: a live region created
                    at the moment it speaks is the case a screen reader may skip
                    (WCAG 4.1.3), which the login form learned the hard way. */}
                <p
                  aria-live="polite"
                  className={
                    rowFailure?.id === member.id
                      ? "mt-2 rounded-xl border border-danger-foreground bg-danger px-4 py-3 text-sm text-danger-foreground"
                      : "sr-only"
                  }
                  role="status"
                >
                  {rowFailure?.id === member.id ? rowFailure.message : ""}
                </p>
              </div>
            }
          />
        ))}
      </ul>

      <section className="mt-8 rounded-lg border border-border bg-card p-4">
        <h2 className="text-lg font-semibold text-heading">{t("addTitle")}</h2>

        <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label
              className="block text-sm font-medium text-foreground"
              htmlFor={`${fieldId}-name`}
            >
              {t("addName")}
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
              htmlFor={`${fieldId}-email`}
            >
              {t("addEmail")}
            </label>
            <Input
              autoComplete="off"
              className="mt-1"
              id={`${fieldId}-email`}
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium text-foreground"
              htmlFor={`${fieldId}-password`}
            >
              {t("addPassword")}
            </label>
            <Input
              aria-describedby={`${fieldId}-password-hint`}
              autoComplete="new-password"
              className="mt-1"
              id={`${fieldId}-password`}
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
            <p
              className="mt-1 text-sm text-muted-foreground"
              id={`${fieldId}-password-hint`}
            >
              {t("addPasswordHint")}
            </p>
          </div>

          <fieldset>
            <legend className="text-sm font-medium text-foreground">
              {t("addRole")}
            </legend>
            {/* Radios rather than a select: two options, both needing a
                sentence of explanation, and a select hides the one not chosen.

                The input is stretched over the whole row and made invisible,
                with the dot drawn separately — a bare radio is about 13px, and
                the target that has to meet the 48px floor is the *input*, not
                the label around it (DESIGN_AUDIT A4.2, same technique as
                `ThemeControl`). */}
            {(["KITCHEN", "MEMBER"] as const).map((option) => (
              <RadioOption
                checked={role === option}
                className="mt-2"
                key={option}
                name={`${fieldId}-role`}
                onSelect={() => setRole(option)}
                value={option}
                variant="card"
              >
                <span className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className={`mt-1 h-5 w-5 shrink-0 rounded-full border-2 ${
                      role === option
                        ? "border-primary bg-primary"
                        : "border-input bg-card"
                    }`}
                  />
                  <span>
                    <span className="block font-medium text-foreground">
                      {t(`role${option}`)}
                    </span>
                    <span className="block text-muted-foreground text-sm">
                      {option === "KITCHEN"
                        ? t("roleKitchenHint")
                        : t("roleMemberHint")}
                    </span>
                  </span>
                </span>
              </RadioOption>
            ))}
          </fieldset>

          {/* Always mounted, empty when there is nothing to say. A region
              created at the moment it has something to say is one some
              readers never announce (SyncStatus.tsx:64-65).

              The failure stays here rather than becoming a snackbar: the form
              that produced it is on screen and is where you would retry, so
              the reason has to still be there when you look back at the
              fields. The success is an event and has gone to the snackbar. */}
          <p
            aria-live="polite"
            className={
              failure
                ? "rounded-md border border-danger-foreground bg-danger px-3 py-2 text-sm text-danger-foreground"
                : "sr-only"
            }
            role="status"
          >
            {failure ? (failure === "taken" ? t("addEmailTaken") : t("addFailed")) : ""}
          </p>

          <Button disabled={addMember.isPending} type="submit">
            {addMember.isPending ? t("addWorking") : t("addSubmit")}
          </Button>
        </form>
      </section>
    </div>
  );
}
