"use client";

import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { TRPCClientError } from "@trpc/client";
import { useSnackbar } from "@/components/ui/snackbar";
import { Badge } from "@/components/ui/badge";
import { RadioOption } from "@/components/ui/radio-option";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, PageShell } from "@/components/ui/page-header";
import { ItemRow } from "@/components/ui/item-row";
import { api } from "@/lib/trpc/client";
import { MIN_PASSWORD_LENGTH } from "@/lib/validations/password";
import { RouteState } from "@/components/household/RouteState";
import {
  addRefusalOf,
  type AddMemberRefusal,
} from "@/components/household/add-member-refusal";
import { ResetMemberPasswordDialog } from "@/components/household/ResetMemberPasswordDialog";
import { MemberSessionsDialog } from "@/components/household/MemberSessionsDialog";
import { EndHouseholdSessions } from "@/components/household/EndHouseholdSessions";
import { Section } from "@/components/ui/section";
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
 * exist. For the same reason the admin is also the way back from a forgotten
 * password: "Cambiar su contraseña" sets a new one and ends every session the
 * person had (`household.resetMemberPassword`).
 *
 * "Ver sus sesiones" lists where a member is signed in and ends one or every
 * one (`household.memberSessions`, `household.endMemberSessions`, D145): the
 * answer to a lost kitchen tablet that does not also sign the member out of
 * the phone in their pocket.
 *
 * Last, for owners only, "Cerrar todas las sesiones del hogar"
 * (`household.endHouseholdSessions`, D147): every member signed out of every
 * device, the owner too, after the owner's password. Below everything else
 * because it is the widest act on the screen, and absent rather than
 * disabled for an admin, because nothing an admin can do here would enable
 * it.
 */
export default function PeoplePage(): JSX.Element {
  const t = useTranslations("household");
  const snackbar = useSnackbar();
  const fieldId = useId();
  const utils = api.useUtils();

  const members = api.household.members.useQuery();
  // To know which row is the caller's own, which gets no reset — your own
  // password changes from Settings, with your current one — and whether the
  // caller is an owner, who alone is offered the household-wide ending.
  const me = api.auth.me.useQuery(undefined, { retry: false });

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"MEMBER" | "KITCHEN">("KITCHEN");
  const [failure, setFailure] = useState<AddMemberRefusal | null>(null);

  const failureMessage = {
    taken: t("addEmailTaken"),
    identity: t("addPasswordIdentity"),
    tooEasy: t("addPasswordTooEasy"),
    tooMany: t("addTooMany"),
    other: t("addFailed"),
  } as const satisfies Record<AddMemberRefusal, string>;

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
    onError: (error) => setFailure(addRefusalOf(error)),
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
  const [rowFailure, setRowFailure] = useState<{ id: string; message: string } | null>(
    null,
  );
  const [resetting, setResetting] = useState<{ id: string; name: string } | null>(null);
  // The button that opened the dialog, where focus goes back to. One ref for
  // every row, set on the click: only one dialog is open at a time.
  const resetOpener = useRef<HTMLButtonElement | null>(null);
  const [viewing, setViewing] = useState<{ id: string; name: string } | null>(null);
  const sessionsOpener = useRef<HTMLButtonElement | null>(null);

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

  /**
   * The member whose sessions are open, read only while their dialog is.
   * `viewing` is never the caller: the button is not on their own row.
   *
   * `gcTime: 0`: closing the dialog drops the list, so opening it again reads
   * it again. Kept, it would come back inside the client's 30-second
   * `staleTime` and show the admin the sessions "Cerrar todas" had just ended
   * (measured in `e2e/session-revocation.spec.ts`).
   */
  const memberSessions = api.household.memberSessions.useQuery(
    { userId: viewing?.id ?? "" },
    { enabled: viewing !== null, gcTime: 0 },
  );
  const endMemberSessions = api.household.endMemberSessions.useMutation({
    // `always`, for `DeviceList`'s reason: offline, an `online` mutation
    // pauses, its promise never settles, and the dialog would sit with every
    // button disabled and nothing saying why.
    networkMode: "always",
  });

  async function endOne(session: { id: string; name: string }): Promise<void> {
    if (viewing === null) return;
    const member = viewing;
    await endMemberSessions
      .mutateAsync({ userId: member.id, sessionId: session.id })
      .catch(async (error: unknown) => {
        // Gone already: the list the admin chose from is out of date.
        await memberSessions.refetch();
        throw error;
      });
    snackbar.show({
      kind: "confirm",
      message: {
        key: "household.memberSessionsEndedOne",
        values: { name: member.name, device: session.name },
      },
    });
    await memberSessions.refetch();
  }

  async function endAll(): Promise<void> {
    if (viewing === null) return;
    const member = viewing;
    await endMemberSessions.mutateAsync({ userId: member.id });
    snackbar.show({
      kind: "confirm",
      message: { key: "household.revokeDone", values: { name: member.name } },
    });
    setViewing(null);
  }

  const resetPassword = api.household.resetMemberPassword.useMutation({
    // `always`, for `DeviceList`'s reason: offline, an `online`
    // mutation pauses, its promise never settles, and the dialog would sit on
    // "Cambiando…" with nothing saying why.
    networkMode: "always",
    onSuccess: (_result, variables) => {
      const target = members.data?.find((candidate) => candidate.id === variables.userId);
      // What to do next, not only what happened: the person cannot sign in
      // until they are given the password, and should not keep one somebody
      // else chose.
      snackbar.show({
        kind: "confirm",
        message: {
          key: "household.resetDone",
          values: { name: target?.name ?? "" },
        },
      });
      setResetting(null);
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
    if (!name.trim() || !email.trim() || password.length < MIN_PASSWORD_LENGTH) return;
    addMember.mutate({ name: name.trim(), email: email.trim(), password, role });
  }

  if (!members.data) {
    return (
      <RouteState
        back={{ href: "/settings", label: t("backToSettings") }}
        error={members.error}
        fetchStatus={members.fetchStatus}
        isLoading={members.isPending}
        onRetry={() => void members.refetch()}
        title={t("peopleTitle")}
        width="form"
      />
    );
  }

  return (
    <PageShell width="form">
      <PageHeader
        back={{ href: "/settings", label: t("backToSettings") }}
        intro={t("peopleIntro")}
        title={t("peopleTitle")}
      />

      <ul className="space-y-3">
        {members.data.map((member) => (
          <ItemRow
            key={member.id}
            meta={[{ label: t("addEmail"), value: member.email }]}
            /* The role in words. Never a colour or a letter. */
            status={<Badge tone="neutral">{t(`role${member.role}`)}</Badge>}
            title={member.name}
            actions={
              <div className="w-full">
                {confirmingRemoval === member.id ? (
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

                  {/* Not on the caller's own row: the server refuses it, and
                      the way to change your own is Settings, which asks for
                      the current one. Hidden until `me` says whose row is
                      whose, rather than offered and then refused. */}
                  {me.data && me.data.id !== member.id ? (
                    <Button
                      onClick={(event) => {
                        resetOpener.current = event.currentTarget;
                        setResetting({ id: member.id, name: member.name });
                        setRowFailure(null);
                      }}
                      type="button"
                      variant="ghost"
                    >
                      {t("resetButton")}
                    </Button>
                  ) : null}

                  {/* Two different problems, two different acts. "They left"
                      is a removal; "their phone was stolen" is this, and
                      offering only the first would make a household delete
                      somebody to answer the second. Not on the caller's own
                      row: your own sessions are in Seguridad y acceso, and
                      ending them there asks for your password. */}
                  {me.data && me.data.id !== member.id ? (
                    <Button
                      onClick={(event) => {
                        sessionsOpener.current = event.currentTarget;
                        setViewing({ id: member.id, name: member.name });
                        setRowFailure(null);
                      }}
                      type="button"
                      variant="outline"
                    >
                      {t("memberSessionsButton")}
                    </Button>
                  ) : null}

                  <Button
                    onClick={() => {
                      setConfirmingRemoval(member.id);
                      setRowFailure(null);
                    }}
                    type="button"
                    variant="destructive-ghost"
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

      <ResetMemberPasswordDialog
        member={resetting}
        onClose={() => setResetting(null)}
        onSubmit={(newPassword) =>
          resetting
            ? resetPassword.mutateAsync({ userId: resetting.id, newPassword })
            : Promise.resolve()
        }
        returnFocus={resetOpener}
      />

      <MemberSessionsDialog
        loadError={memberSessions.error}
        member={viewing}
        onClose={() => setViewing(null)}
        onEndAll={endAll}
        onEndOne={endOne}
        returnFocus={sessionsOpener}
        sessions={viewing ? memberSessions.data : undefined}
      />

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
              minLength={MIN_PASSWORD_LENGTH}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
            <p
              className="mt-1 text-sm text-muted-foreground"
              id={`${fieldId}-password-hint`}
            >
              {t("addPasswordHint", { min: MIN_PASSWORD_LENGTH })}
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
            {failure ? failureMessage[failure] : ""}
          </p>

          <Button disabled={addMember.isPending} type="submit">
            {addMember.isPending ? t("addWorking") : t("addSubmit")}
          </Button>
        </form>
      </section>

      {me.data?.role === "OWNER" ? (
        <Section className="mt-8" title={t("endAllHouseholdTitle")}>
          <EndHouseholdSessions />
        </Section>
      ) : null}
    </PageShell>
  );
}
