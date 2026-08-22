"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { TRPCClientError } from "@trpc/client";
import { useSnackbar } from "@/components/ui/snackbar";
import { Badge } from "@/components/ui/badge";
import { RadioOption } from "@/components/ui/radio-option";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BackLink } from "@/components/ui/back-link";
import { ItemRow } from "@/components/ui/item-row";
import { api } from "@/lib/trpc/client";
import { RouteState } from "@/components/household/RouteState";
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
